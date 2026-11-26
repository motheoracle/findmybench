import { PHOTO_ALLOWED_TYPES, PHOTO_MAX_UPLOAD_BYTES, PHOTO_MIN_DIMENSION } from '../config/community';

export interface ProcessedPhoto {
  dataUrl: string;
  width: number;
  height: number;
  /** Approximate size of the compressed image in bytes. */
  bytes: number;
  /** SHA-256 hex of the compressed image (FNV fallback outside secure contexts). */
  hash: string;
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
 * Validate, decode, downscale and JPEG-compress a photo so it fits in localStorage (v1).
 * Also rejects images below PHOTO_MIN_DIMENSION (icons, thumbnails, screenshots of tiny images).
 */
export async function processPhoto(file: File, maxDim = 1280, quality = 0.72): Promise<ProcessedPhoto> {
  const invalid = validatePhotoFile(file);
  if (invalid) throw new Error(invalid);

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(new Error('Could not read that image. HEIC photos may need converting to JPEG on this browser.'));
      el.src = url;
    });
    if (Math.min(img.naturalWidth, img.naturalHeight) < PHOTO_MIN_DIMENSION) {
      throw new Error(`Photo is too small — at least ${PHOTO_MIN_DIMENSION}px on the short side, please.`);
    }
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported.');
    ctx.drawImage(img, 0, 0, w, h);
    // Re-encoding through canvas also strips EXIF (incl. GPS) metadata.
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const bytes = Math.round(((dataUrl.length - 'data:image/jpeg;base64,'.length) * 3) / 4);
    return { dataUrl, width: w, height: h, bytes, hash: await sha256Hex(dataUrl) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Back-compat helper used for main bench photos. */
export async function compressImage(file: File, maxDim = 1280, quality = 0.72): Promise<string> {
  return (await processPhoto(file, maxDim, quality)).dataUrl;
}
