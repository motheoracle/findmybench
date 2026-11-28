import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { PHOTO_EXIF_MATCH_RADIUS_M } from '../config/community';
import type { LngLat, PhotoTag } from '../types';
import { haversineMeters } from './routing';

export type ScreeningDecision = 'allowed' | 'flagged' | 'blocked';

export interface PhotoScreeningResult {
  decision: ScreeningDecision;
  /** Clear explanation shown to the user or recorded for moderation. */
  reason: string;
  /** True if the image has EXIF GPS within the allowed radius of the bench. */
  exifVerified: boolean | null;
}

export interface FaceBlurResult {
  dataUrl: string;
  facesDetected: number;
  appliedBlur: boolean;
  statusMessage: string;
}

const HARD_BLOCK_PATTERNS = [
  /\b(nsfw|porn|xxx|nude|nudes|nudity|explicit|boob|boobs|tits|dick|cock|pussy|sex|gore|self-harm|suicide|kill yourself|rape|csam)\b/i,
  /\b(nazi|swastika|white power|kkk|terrorist|bombing|doxx|ssn|social security)\b/i,
];

const OFF_TOPIC_TEXT_PATTERNS = [
  /\b(meme|memes|receipt|receipts|invoice|screenshot|screen shot|car parked|asda|tesco)\b/i,
  /https?:\/\/|www\./i,
];

const STOCK_OR_THIRD_PARTY_PATTERNS = [
  /(getty|ge[tf]{2}y\s*[i1l]mages|gettyimages|shutterstock|shutterst|istock|1stock|istockphoto|dreamstime|dreamst[i1l]me|alamy|123rf|depositphotos|adobe[\s_-]*stock|stock[\s_-]*photo|watermark|cred[i1l]t\s*[:;])/i,
];

type DetectedFaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
};

let mediaPipeDetectorPromise: Promise<FaceDetector> | null = null;
let ocrWorkerPromise: Promise<Worker> | null = null;

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not load image for processing.'));
    el.src = dataUrl;
  });
}

async function getMediaPipeFaceDetector(): Promise<FaceDetector> {
  if (!mediaPipeDetectorPromise) {
    mediaPipeDetectorPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
      );
      return FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
        },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.48,
        minSuppressionThreshold: 0.3,
      });
    })().catch((err) => {
      mediaPipeDetectorPromise = null;
      throw err;
    });
  }
  return mediaPipeDetectorPromise;
}

async function getOcrWorker(): Promise<Worker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const worker = await createWorker('eng');
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      });
      return worker;
    })().catch((err) => {
      ocrWorkerPromise = null;
      throw err;
    });
  }
  return ocrWorkerPromise;
}

function buildOcrPassCanvas(
  img: HTMLImageElement,
  mode: 'white-text' | 'inverted-gray' | 'normal-gray',
): HTMLCanvasElement {
  const scale = img.naturalWidth < 900 ? Math.min(2, 1280 / Math.max(1, img.naturalWidth)) : 1;
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    let out = lum;
    if (mode === 'white-text') {
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      // Turn bright white/light-grey watermark text into crisp black text on white background
      out = lum > 155 && sat < 55 ? 0 : 255;
    } else if (mode === 'inverted-gray') {
      out = 255 - lum;
    }

    d[i] = out;
    d[i + 1] = out;
    d[i + 2] = out;
    d[i + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function detectWatermarkTextInImage(dataUrl: string): Promise<string | null> {
  try {
    const [worker, img] = await Promise.all([getOcrWorker(), loadImageElement(dataUrl)]);
    const passes: Array<'white-text' | 'inverted-gray' | 'normal-gray'> = [
      'white-text',
      'inverted-gray',
      'normal-gray',
    ];

    for (const mode of passes) {
      const canvas = buildOcrPassCanvas(img, mode);
      const {
        data: { text },
      } = await worker.recognize(canvas);
      const cleaned = (text ?? '').replace(/\s+/g, ' ').trim();
      console.info(`[FindMyBench OCR:${mode}]`, cleaned);

      if (cleaned && STOCK_OR_THIRD_PARTY_PATTERNS.some((re) => re.test(cleaned))) {
        return cleaned;
      }
    }

    return null;
  } catch (err) {
    console.warn('OCR watermark check failed:', err);
    return null;
  }
}

export function evaluateExifProximity(
  exifGps: LngLat | null | undefined,
  benchLocation: LngLat,
  radiusMeters: number = PHOTO_EXIF_MATCH_RADIUS_M,
): { verified: boolean | null; distanceMeters: number | null } {
  if (!exifGps) {
    return { verified: null, distanceMeters: null };
  }
  const dist = haversineMeters(exifGps, benchLocation);
  return {
    verified: dist <= radiusMeters,
    distanceMeters: dist,
  };
}

export function screenPhotoUpload(params: {
  caption: string;
  fileName?: string;
  tag: PhotoTag;
  width: number;
  height: number;
  dataUrl?: string;
  exifGps: LngLat | null;
  benchLocation: LngLat;
}): PhotoScreeningResult {
  const textToCheck = `${params.caption}`.trim();
  const normalizedText = textToCheck.replace(/[^\w\s./:-]/g, ' ').replace(/\s+/g, ' ');
  const fileNameToCheck = `${params.fileName ?? ''}`.trim();
  const exif = evaluateExifProximity(params.exifGps, params.benchLocation);

  if (
    textToCheck &&
    (HARD_BLOCK_PATTERNS.some((re) => re.test(textToCheck)) ||
      HARD_BLOCK_PATTERNS.some((re) => re.test(normalizedText)))
  ) {
    return {
      decision: 'blocked',
      reason:
        'Upload blocked: this photo or caption was flagged for harmful, explicit, or abusive content and was not uploaded.',
      exifVerified: exif.verified,
    };
  }

  if (
    STOCK_OR_THIRD_PARTY_PATTERNS.some(
      (re) => re.test(fileNameToCheck) || re.test(textToCheck) || re.test(normalizedText),
    )
  ) {
    return {
      decision: 'flagged',
      reason:
        'Held for review: this image appears to be a stock or third-party photo rather than an original user photo, and requires approval before going live.',
      exifVerified: exif.verified,
    };
  }

  if (
    textToCheck &&
    (OFF_TOPIC_TEXT_PATTERNS.some((re) => re.test(textToCheck)) ||
      OFF_TOPIC_TEXT_PATTERNS.some((re) => re.test(normalizedText)))
  ) {
    return {
      decision: 'flagged',
      reason:
        'Held for review: this upload looks off-topic (such as a meme, receipt, or screenshot) and is flagged before public gallery display.',
      exifVerified: exif.verified,
    };
  }

  return {
    decision: 'allowed',
    reason:
      exif.verified === true
        ? 'Approved: photo passed safety checks and matches the bench location.'
        : 'Approved: photo passed safety and relevance checks.',
    exifVerified: exif.verified,
  };
}

export async function screenPhotoUploadWithOcr(params: {
  caption: string;
  fileName?: string;
  tag: PhotoTag;
  width: number;
  height: number;
  dataUrl?: string;
  exifGps: LngLat | null;
  benchLocation: LngLat;
}): Promise<PhotoScreeningResult> {
  const baseResult = screenPhotoUpload(params);
  if (baseResult.decision !== 'allowed' || !params.dataUrl) {
    return baseResult;
  }

  const watermarkHit = await detectWatermarkTextInImage(params.dataUrl);
  if (watermarkHit) {
    return {
      decision: 'flagged',
      reason:
        'Held for review: a stock or third-party watermark was detected in this image, so it requires approval before going live.',
      exifVerified: baseResult.exifVerified,
    };
  }

  return baseResult;
}

function boxesOverlapRatio(a: DetectedFaceBox, b: DetectedFaceBox): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const interArea = xOverlap * yOverlap;
  if (interArea <= 0) return 0;
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return minArea > 0 ? interArea / minArea : 0;
}

function deduplicateBoxes(boxes: DetectedFaceBox[]): DetectedFaceBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept: DetectedFaceBox[] = [];
  for (const box of sorted) {
    if (kept.some((existing) => boxesOverlapRatio(existing, box) > 0.35)) continue;
    kept.push(box);
  }
  return kept;
}

function hasValidFaceGeometry(
  keypoints: Array<{ x: number; y: number }> | undefined,
  box: { originX: number; originY: number; width: number; height: number },
  inputW: number,
  inputH: number,
): boolean {
  if (!keypoints || keypoints.length < 4) return true;

  // MediaPipe BlazeFace keypoints: 0=rightEye, 1=leftEye, 2=nose, 3=mouth
  const rightEye = { x: keypoints[0].x * inputW, y: keypoints[0].y * inputH };
  const leftEye = { x: keypoints[1].x * inputW, y: keypoints[1].y * inputH };
  const nose = { x: keypoints[2].x * inputW, y: keypoints[2].y * inputH };
  const mouth = { x: keypoints[3].x * inputW, y: keypoints[3].y * inputH };

  const eyeAvgY = (rightEye.y + leftEye.y) / 2;

  // Eyes must sit above the mouth, and nose must sit between eyes and mouth
  if (mouth.y <= eyeAvgY + box.height * 0.05) return false;
  if (nose.y < eyeAvgY - box.height * 0.15 || nose.y > mouth.y + box.height * 0.15) return false;

  // Allow slightly wider horizontal margin for side-profile faces
  const padX = box.width * 0.35;
  const padY = box.height * 0.3;
  const inside = (p: { x: number; y: number }) =>
    p.x >= box.originX - padX &&
    p.x <= box.originX + box.width + padX &&
    p.y >= box.originY - padY &&
    p.y <= box.originY + box.height + padY;

  // Require at least one eye + nose + mouth inside (handles side profiles cleanly)
  return (inside(rightEye) || inside(leftEye)) && inside(nose) && inside(mouth);
}

async function detectFacesInImage(img: HTMLImageElement): Promise<DetectedFaceBox[]> {
  try {
    const detector = await getMediaPipeFaceDetector();
    const allBoxes: DetectedFaceBox[] = [];

    const collectDetections = (
      input: HTMLImageElement | HTMLCanvasElement,
      inputW: number,
      inputH: number,
      offsetX: number,
      offsetY: number,
      minScore: number,
      isZoomedTile: boolean,
    ) => {
      const result = detector.detect(input);
      const detections = result.detections ?? [];
      for (const d of detections) {
        const b = d.boundingBox;
        if (!b || b.width < 12 || b.height < 12) continue;

        const score = d.categories?.[0]?.score ?? 0;
        if (score < minScore) continue;

        // Reject weird aspect ratios (arms, tree trunks, fence posts)
        const aspect = b.width / b.height;
        if (aspect < 0.55 || aspect > 1.75) continue;

        // On zoomed tiles, ignore huge blobs that fill most of the tile (false positives on skin/bokeh)
        if (isZoomedTile && (b.width > inputW * 0.65 || b.height > inputH * 0.65)) continue;

        // Verify real facial landmark geometry (eyes above nose above mouth)
        if (!hasValidFaceGeometry(d.keypoints, b, inputW, inputH)) continue;

        allBoxes.push({
          x: b.originX + offsetX,
          y: b.originY + offsetY,
          width: b.width,
          height: b.height,
          score,
        });
      }
    };

    const runTileGrid = (
      cols: number,
      rows: number,
      tileWFrac: number,
      tileHFrac: number,
      minScore: number,
    ) => {
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      const tileW = Math.round(W * tileWFrac);
      const tileH = Math.round(H * tileHFrac);
      if (tileW < 96 || tileH < 96) return;

      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = tileW;
      tileCanvas.height = tileH;
      const tctx = tileCanvas.getContext('2d');
      if (!tctx) return;

      for (let r = 0; r < rows; r++) {
        const sy = rows === 1 ? 0 : Math.round(((H - tileH) * r) / (rows - 1));
        for (let c = 0; c < cols; c++) {
          const sx = cols === 1 ? 0 : Math.round(((W - tileW) * c) / (cols - 1));
          tctx.clearRect(0, 0, tileW, tileH);
          tctx.drawImage(img, sx, sy, tileW, tileH, 0, 0, tileW, tileH);
          collectDetections(tileCanvas, tileW, tileH, sx, sy, minScore, true);
        }
      }
    };

    // Level 1: Full image (close-up & portrait faces)
    collectDetections(img, img.naturalWidth, img.naturalHeight, 0, 0, 0.54, false);

    // Level 2: Medium overlapping tiles (mid-range group shots & B&W portraits)
    runTileGrid(3, 2, 0.5, 0.55, 0.52);

    // Level 3: Tight overlapping tiles (wide bench shots)
    runTileGrid(4, 3, 0.34, 0.4, 0.5);

    // Level 4: Distant overlapping tiles (small/further-away faces)
    runTileGrid(5, 3, 0.28, 0.34, 0.5);

    return deduplicateBoxes(allBoxes);
  } catch (err) {
    console.warn('MediaPipe face detection failed:', err);
    return [];
  }
}

export async function applyFaceBlurIfRequested(
  dataUrl: string,
  hasPeople: boolean,
  blurFaces: boolean,
): Promise<FaceBlurResult> {
  if (!hasPeople) {
    return {
      dataUrl,
      facesDetected: 0,
      appliedBlur: false,
      statusMessage: 'No people marked in photo.',
    };
  }

  if (!blurFaces) {
    return {
      dataUrl,
      facesDetected: 0,
      appliedBlur: false,
      statusMessage: 'Faces left unblurred per your choice.',
    };
  }

  const img = await loadImageElement(dataUrl);

  const faces = await detectFacesInImage(img);
  if (faces.length === 0) {
    return {
      dataUrl,
      facesDetected: 0,
      appliedBlur: false,
      statusMessage: 'No distinct face region found to blur; photo is ready to go live.',
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      dataUrl,
      facesDetected: faces.length,
      appliedBlur: false,
      statusMessage: 'Face blur unavailable on this device; photo is ready to go live.',
    };
  }

  ctx.drawImage(img, 0, 0);

  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d');

  for (const box of faces) {
    const x = Math.max(0, Math.floor(box.x));
    const y = Math.max(0, Math.floor(box.y));
    const w = Math.min(canvas.width - x, Math.max(4, Math.ceil(box.width)));
    const h = Math.min(canvas.height - y, Math.max(4, Math.ceil(box.height)));
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = Math.max(2, w * 0.5);
    const ry = Math.max(2, h * 0.55);

    if (!sctx) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.filter = 'blur(14px)';
      ctx.drawImage(img, x, y, w, h, x, y, w, h);
      ctx.restore();
      continue;
    }

    const tinyW = Math.max(5, Math.round(w / 7));
    const tinyH = Math.max(5, Math.round(h / 7));
    scratch.width = tinyW;
    scratch.height = tinyH;
    sctx.clearRect(0, 0, tinyW, tinyH);
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(img, x, y, w, h, 0, 0, tinyW, tinyH);

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch, 0, 0, tinyW, tinyH, x, y, w, h);
    ctx.filter = 'blur(4px)';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(scratch, 0, 0, tinyW, tinyH, x, y, w, h);
    ctx.restore();
  }

  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.85),
    facesDetected: faces.length,
    appliedBlur: true,
    statusMessage: `Isolated face blur applied to ${faces.length} detected ${faces.length === 1 ? 'face' : 'faces'}.`,
  };
}