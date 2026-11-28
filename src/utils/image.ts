import {
  PHOTO_ALLOWED_TYPES,
  PHOTO_MAX_DIMENSION,
  PHOTO_MAX_UPLOAD_BYTES,
  PHOTO_MIN_DIMENSION,
} from '../config/community';
import type { LngLat } from '../types';

export interface ProcessedPhoto {
  dataUrl: string;
  width: number;
  height: number;
  /** Approximate size of the compressed image in bytes. */
  bytes: number;
  /** SHA-256 hex of the compressed image (FNV fallback outside secure contexts). */
  hash: string;
  /** GPS coordinates extracted from raw JPEG EXIF metadata if present. */
  exifGps: LngLat | null;
}

const EXT_OK = /\.(jpe?g|png|webp|heic|heif)$/i;

/**
 * Client-side file validation. This is a UX guard only — production must re-validate
 * server-side (Storage bucket rules: MIME allow-list, max object size, and image decoding
 * in an Edge Function before the object becomes public).
 */
export function validatePhotoFile(file: File): string | null {
  const typeOk = PHOTO_ALLOWED_TYPES.includes(file.type) || (!file.type && EXT_OK.test(file.name));
  if (!typeOk) return 'Please choose a JPEG, PNG, WebP or HEIC photo.';
  if (file.size > PHOTO_MAX_UPLOAD_BYTES)
    return `That photo is too large (max ${Math.round(PHOTO_MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`;
  if (file.size < 2048) return 'That file is too small to be a real photo.';
  return null;
}

function readUint16(view: DataView, offset: number, littleEndian: boolean): number {
  return view.getUint16(offset, littleEndian);
}

function readUint32(view: DataView, offset: number, littleEndian: boolean): number {
  return view.getUint32(offset, littleEndian);
}

function parseGpsCoord(
  view: DataView,
  tiffStart: number,
  valueOffset: number,
  littleEndian: boolean,
  ref: string,
): number | null {
  const absOffset = tiffStart + valueOffset;
  if (absOffset + 24 > view.byteLength) return null;

  const readRational = (idx: number): number | null => {
    const base = absOffset + idx * 8;
    const num = readUint32(view, base, littleEndian);
    const den = readUint32(view, base + 4, littleEndian);
    if (!den) return null;
    return num / den;
  };

  const deg = readRational(0);
  const min = readRational(1);
  const sec = readRational(2);
  if (deg === null || min === null || sec === null) return null;

  let decimal = deg + min / 60 + sec / 3600;
  if (ref === 'S' || ref === 'W') decimal = -decimal;
  return Number.isFinite(decimal) ? decimal : null;
}

function readAscii(view: DataView, offset: number, count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) {
    if (offset + i >= view.byteLength) break;
    const code = view.getUint8(offset + i);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out.trim();
}

/**
 * Lightweight EXIF GPS parser for JPEG files. Returns null when EXIF/GPS tags are absent
 * or stripped (common on messaging apps or screenshots).
 */
export async function extractExifGps(file: File): Promise<LngLat | null> {
  try {
    // Scan first 256 KB where APP1 EXIF marker resides in standard JPEGs.
    const slice = await file.slice(0, 256 * 1024).arrayBuffer();
    const view = new DataView(slice);
    if (view.byteLength < 12 || view.getUint16(0, false) !== 0xffd8) return null;

    let offset = 2;
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xffe1) {
        const segLen = view.getUint16(offset, false);
        const exifHeaderOffset = offset + 2;
        if (exifHeaderOffset + 6 <= view.byteLength && readAscii(view, exifHeaderOffset, 6) === 'Exif') {
          const tiffStart = exifHeaderOffset + 6;
          if (tiffStart + 8 > view.byteLength) return null;

          const endianMark = readUint16(view, tiffStart, false);
          const littleEndian = endianMark === 0x4949;
          if (!littleEndian && endianMark !== 0x4d4d) return null;

          const ifd0Rel = readUint32(view, tiffStart + 4, littleEndian);
          const ifd0Start = tiffStart + ifd0Rel;
          if (ifd0Start + 2 > view.byteLength) return null;

          const entries0 = readUint16(view, ifd0Start, littleEndian);
          let gpsIfdOffset: number | null = null;

          for (let i = 0; i < entries0; i++) {
            const entryOff = ifd0Start + 2 + i * 12;
            if (entryOff + 12 > view.byteLength) break;
            const tag = readUint16(view, entryOff, littleEndian);
            if (tag === 0x8825) {
              gpsIfdOffset = readUint32(view, entryOff + 8, littleEndian);
              break;
            }
          }

          if (gpsIfdOffset === null) return null;
          const gpsStart = tiffStart + gpsIfdOffset;
          if (gpsStart + 2 > view.byteLength) return null;

          const gpsEntries = readUint16(view, gpsStart, littleEndian);
          let latRef = '';
          let lngRef = '';
          let latValOff: number | null = null;
          let lngValOff: number | null = null;

          for (let i = 0; i < gpsEntries; i++) {
            const entryOff = gpsStart + 2 + i * 12;
            if (entryOff + 12 > view.byteLength) break;
            const tag = readUint16(view, entryOff, littleEndian);
            const valOrOff = readUint32(view, entryOff + 8, littleEndian);
            if (tag === 0x0001) {
              latRef = readAscii(view, entryOff + 8, 2) || readAscii(view, tiffStart + valOrOff, 2);
            } else if (tag === 0x0002) {
              latValOff = valOrOff;
            } else if (tag === 0x0003) {
              lngRef = readAscii(view, entryOff + 8, 2) || readAscii(view, tiffStart + valOrOff, 2);
            } else if (tag === 0x0004) {
              lngValOff = valOrOff;
            }
          }

          if (latValOff === null || lngValOff === null) return null;
          const lat = parseGpsCoord(view, tiffStart, latValOff, littleEndian, latRef || 'N');
          const lng = parseGpsCoord(view, tiffStart, lngValOff, littleEndian, lngRef || 'E');
          if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            return null;
          }
          return { lat, lng };
        }
        offset += segLen - 2;
      } else if ((marker & 0xff00) === 0xff00) {
        if (offset + 2 > view.byteLength) break;
        const segLen = view.getUint16(offset, false);
        offset += segLen;
      } else {
        break;
      }
    }
  } catch {
    // Ignore malformed metadata
  }
  return null;
}

async function sha256Hex(text: string): Promise<string> {
  try {
    if (crypto?.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    /* fall through */
  }
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv-${(h >>> 0).toString(16)}-${text.length}`;
}

/**
 * Validate, decode, downscale and JPEG-compress a photo (including high-MP camera files).
 * Also rejects images below PHOTO_MIN_DIMENSION or above PHOTO_MAX_DIMENSION.
 */
export async function processPhoto(file: File, maxDim = 1280, quality = 0.72): Promise<ProcessedPhoto> {
  const invalid = validatePhotoFile(file);
  if (invalid) throw new Error(invalid);

  const exifGps = await extractExifGps(file);
  const url = URL.createObjectURL(file);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(new Error('Could not read that image. HEIC photos may need converting to JPEG on this browser.'));
      el.src = url;
    });

    const minSide = Math.min(img.naturalWidth, img.naturalHeight);
    const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
    if (minSide < PHOTO_MIN_DIMENSION) {
      throw new Error(`Photo is too small — at least ${PHOTO_MIN_DIMENSION}px on the short side, please.`);
    }
    if (maxSide > PHOTO_MAX_DIMENSION) {
      throw new Error(`Photo dimensions exceed the ${PHOTO_MAX_DIMENSION}px limit.`);
    }

    const scale = Math.min(1, maxDim / maxSide);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported.');

    // Step-down large source images in halves to preserve detail and avoid memory spikes.
    if (maxSide > maxDim * 2) {
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        let curW = img.naturalWidth;
        let curH = img.naturalHeight;
        tempCanvas.width = curW;
        tempCanvas.height = curH;
        tempCtx.drawImage(img, 0, 0, curW, curH);

        while (Math.max(curW, curH) * 0.5 > maxDim) {
          const nextW = Math.max(1, Math.round(curW * 0.5));
          const nextH = Math.max(1, Math.round(curH * 0.5));
          const stepCanvas = document.createElement('canvas');
          stepCanvas.width = nextW;
          stepCanvas.height = nextH;
          const stepCtx = stepCanvas.getContext('2d');
          if (!stepCtx) break;
          stepCtx.drawImage(tempCanvas, 0, 0, curW, curH, 0, 0, nextW, nextH);
          tempCanvas.width = nextW;
          tempCanvas.height = nextH;
          tempCtx.drawImage(stepCanvas, 0, 0);
          curW = nextW;
          curH = nextH;
        }
        ctx.drawImage(tempCanvas, 0, 0, curW, curH, 0, 0, w, h);
      } else {
        ctx.drawImage(img, 0, 0, w, h);
      }
    } else {
      ctx.drawImage(img, 0, 0, w, h);
    }

    // Re-encoding through canvas strips EXIF from the output dataUrl while preserving exifGps above.
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const bytes = Math.round(((dataUrl.length - 'data:image/jpeg;base64,'.length) * 3) / 4);
    return { dataUrl, width: w, height: h, bytes, hash: await sha256Hex(dataUrl), exifGps };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Back-compat helper used for main bench photos. */
export async function compressImage(file: File, maxDim = 1280, quality = 0.72): Promise<string> {
  return (await processPhoto(file, maxDim, quality)).dataUrl;
}