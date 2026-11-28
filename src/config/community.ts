import type { PhotoTag, ReportReason, UserPreferences } from '../types';

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const env = import.meta.env;

/** Pins closer than this to an existing bench are treated as duplicates. */
export const DUPLICATE_RADIUS_M = num(env.VITE_DUPLICATE_RADIUS_M, 20);

/** GPS fixes worse than this get a "drag the pin to the exact spot" hint. */
export const LOW_ACCURACY_WARN_M = 25;

// ---- Reviews ----
export const REVIEW_MAX_CHARS = 10_000;
export const REVIEW_PREVIEW_CHARS = 600;
export const MAX_REVIEWS_PER_USER_PER_BENCH = 5;

// ---- Gallery guardrails (mirrored server-side in production — see services/galleryRepository.ts) ----
export const MAX_GALLERY_PHOTOS_PER_USER_PER_BENCH = num(env.VITE_MAX_PHOTOS_PER_USER_PER_BENCH, 100);
export const MAX_GALLERY_PHOTOS_PER_BENCH = 250;
/** High raw upload ceiling so 108MP–200MP+ camera photos aren't rejected before client-side compression. */
export const PHOTO_MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
export const PHOTO_MIN_DIMENSION = 64; // px — rejects thumbnails, icons, junk
export const PHOTO_MAX_DIMENSION = 16384; // px — generous ceiling for high-res/200MP+ sensors
export const PHOTO_EXIF_MATCH_RADIUS_M = 30; // meters — EXIF GPS match tolerance around bench
export const PHOTO_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const CAPTION_MAX_CHARS = 140;
/** Reports from this many distinct users auto-hide a photo/review pending moderation. */
export const AUTO_HIDE_REPORT_THRESHOLD = 3;

export const PHOTO_TAGS: { value: PhotoTag; label: string; hint: string }[] = [
  { value: 'bench-view', label: 'Bench view', hint: 'The bench itself, plaque or details' },
  { value: 'pov', label: 'POV from bench', hint: 'What you see sitting on it' },
  { value: 'nearby', label: 'Nearby landmark / context', hint: 'Something within sight that helps find it' },
];
export const photoTagLabel = (t: PhotoTag) => PHOTO_TAGS.find((x) => x.value === t)?.label ?? t;

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'off-topic', label: 'Not this bench / off-topic' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'privacy', label: 'Shows people, faces or number plates' },
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'other', label: 'Something else' },
];

export const ANONYMOUS_NAME = 'Anonymous bench hunter';

export const DEFAULT_PREFS: UserPreferences = {
  creditAnonymously: false,
  defaultLayer: 'default',
  units: 'metric',
};