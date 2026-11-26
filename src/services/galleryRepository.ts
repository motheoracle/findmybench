import type { GalleryPhoto, ModerationStatus, PhotoTag, PublicAuthor, ReportReason } from '../types';
import {
  AUTO_HIDE_REPORT_THRESHOLD,
  CAPTION_MAX_CHARS,
  MAX_GALLERY_PHOTOS_PER_BENCH,
  MAX_GALLERY_PHOTOS_PER_USER_PER_BENCH,
  PHOTO_TAGS,
} from '../config/community';
import { readJSON, uid, writeJSON } from '../utils/storage';

/**
 * Bench photo gallery with anti-random-photo guardrails.
 *
 * v1 (this file) enforces everything client-side so the UX is right. In production the SAME
 * rules must be enforced server-side, because client checks can be bypassed:
 *
 *  1. Auth: Supabase Storage bucket policy — INSERT only for `auth.role() = 'authenticated'`,
 *     object path `bench-photos/{bench_id}/{auth.uid()}/{uuid}.jpg`.
 *  2. Caps: a `gallery_photos` row is required for every object; a BEFORE INSERT trigger rejects
 *     when count(*) for (bench_id, author_id) >= 3 or for bench_id >= 40, plus a per-user daily rate limit.
 *  3. File checks: bucket `allowed_mime_types` + `file_size_limit`; an Edge Function decodes the
 *     image (rejects non-images / polyglots), re-encodes to strip EXIF/GPS, and enforces min dimensions.
 *  4. Duplicates & spam: store a perceptual hash (pHash/dHash) and reject near-duplicates on the
 *     same bench; optionally check against known-bad hash lists.
 *  5. Moderation: new photos can start as 'flagged' (pending) for low-trust accounts; an automated
 *     safety classifier (e.g. a vision moderation API) runs before status → 'visible'.
 *  6. Reports: `photo_reports` with UNIQUE(photo_id, reporter_id); a trigger hides the photo once
 *     AUTO_HIDE_REPORT_THRESHOLD distinct users report it, and queues it for human review.
 *  7. Location sanity (optional): if the uploader shares device location, require it within ~200 m
 *     of the bench for "POV from bench" photos.
 */
const KEY = 'gallery.v1';

export interface NewPhotoInput {
  benchId: string;
  author: PublicAuthor;
  src: string;
  tag: PhotoTag;
  caption: string;
  width: number;
  height: number;
  bytes: number;
  contentHash: string;
}

class LocalGalleryRepository {
  private all(): GalleryPhoto[] {
    return readJSON<GalleryPhoto[]>(KEY, []);
  }
  private save(list: GalleryPhoto[]) {
    writeJSON(KEY, list);
  }

  /** Visible photos plus the viewer's own (whatever their status), oldest first. */
  list(benchId: string, viewerId?: string): GalleryPhoto[] {
    return this.all()
      .filter((p) => p.benchId === benchId && (p.status !== 'hidden' || p.author.id === viewerId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  countVisible(benchId: string) {
    return this.all().filter((p) => p.benchId === benchId && p.status !== 'hidden').length;
  }

  countByUser(benchId: string, userId: string) {
    return this.all().filter((p) => p.benchId === benchId && p.author.id === userId).length;
  }

  remainingForUser(benchId: string, userId: string) {
    return Math.max(0, MAX_GALLERY_PHOTOS_PER_USER_PER_BENCH - this.countByUser(benchId, userId));
  }

  listForModeration(): GalleryPhoto[] {
    return this.all().filter((p) => p.status !== 'visible');
  }

  add(input: NewPhotoInput): GalleryPhoto {
    if (!input.author?.id) throw new Error('Sign in to add photos.');
    if (!PHOTO_TAGS.some((t) => t.value === input.tag)) throw new Error('Choose what the photo shows.');
    const caption = input.caption.trim();
    if (caption.length > CAPTION_MAX_CHARS) throw new Error(`Captions are limited to ${CAPTION_MAX_CHARS} characters.`);
    if (/https?:\/\/|www\./i.test(caption)) throw new Error('Captions cannot contain links.');

    const list = this.all();
    const onBench = list.filter((p) => p.benchId === input.benchId);
    if (onBench.filter((p) => p.author.id === input.author.id).length >= MAX_GALLERY_PHOTOS_PER_USER_PER_BENCH)
      throw new Error(`You've reached the limit of ${MAX_GALLERY_PHOTOS_PER_USER_PER_BENCH} photos for this bench.`);
    if (onBench.length >= MAX_GALLERY_PHOTOS_PER_BENCH) throw new Error('This bench gallery is full.');
    if (onBench.some((p) => p.contentHash === input.contentHash))
      throw new Error('That exact photo is already in this bench’s gallery.');

    const photo: GalleryPhoto = {
      id: uid('photo'),
      ...input,
      caption,
      createdAt: new Date().toISOString(),
      status: 'visible',
      reports: [],
    };
    this.save([...list, photo]);
    return photo;
  }

  remove(id: string, actorId: string) {
    const list = this.all();
    const p = list.find((x) => x.id === id);
    if (!p) return;
    if (p.author.id !== actorId) throw new Error('You can only delete your own photos.');
    this.save(list.filter((x) => x.id !== id));
  }

  report(id: string, reporterId: string, reason: ReportReason) {
    const list = this.all();
    const p = list.find((x) => x.id === id);
    if (!p) return;
    if (p.author.id === reporterId) throw new Error("You can't report your own photo.");
    if (p.reports.some((r) => r.userId === reporterId)) throw new Error("You've already reported this photo.");
    p.reports.push({ userId: reporterId, reason, at: new Date().toISOString() });
    p.status = p.reports.length >= AUTO_HIDE_REPORT_THRESHOLD ? 'hidden' : 'flagged';
    this.save(list);
  }

  /** Moderator action (DEV panel in v1; admin role / service key in production). */
  moderate(id: string, status: ModerationStatus | 'delete') {
    const list = this.all();
    if (status === 'delete') return this.save(list.filter((x) => x.id !== id));
    const p = list.find((x) => x.id === id);
    if (!p) return;
    p.status = status;
    if (status === 'visible') p.reports = [];
    this.save(list);
  }

  renameAuthor(authorId: string, name: string) {
    const list = this.all();
    let changed = false;
    for (const p of list)
      if (p.author.id === authorId && p.author.name !== name) {
        p.author = { id: authorId, name };
        changed = true;
      }
    if (changed) this.save(list);
  }

  clearAll() {
    writeJSON(KEY, null);
  }
}

export const galleryRepo = new LocalGalleryRepository();
