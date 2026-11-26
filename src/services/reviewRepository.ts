import type { ModerationStatus, PublicAuthor, ReportReason, Review } from '../types';
import { AUTO_HIDE_REPORT_THRESHOLD, MAX_REVIEWS_PER_USER_PER_BENCH, REVIEW_MAX_CHARS } from '../config/community';
import { readJSON, uid, writeJSON } from '../utils/storage';

/**
 * Reviews & comments. v1: localStorage. v2: Supabase `reviews` table —
 *  - CHECK (char_length(body) BETWEEN 1 AND 10000) at the database level
 *  - RLS: insert/update/delete only where author_id = auth.uid(); select where status <> 'hidden'
 *    (or author_id = auth.uid()); obscure-bench reviews only for entitled users
 *  - `review_reports` table with UNIQUE(review_id, reporter_id) + trigger that hides at threshold
 */
const KEY = 'reviews.v1';

export function validateReviewBody(body: string): string | null {
  const t = body.trim();
  if (!t) return 'Write something before posting.';
  if (t.length > REVIEW_MAX_CHARS) return `Reviews are limited to ${REVIEW_MAX_CHARS.toLocaleString('en-GB')} characters.`;
  return null;
}

class LocalReviewRepository {
  private all(): Review[] {
    return readJSON<Review[]>(KEY, []);
  }
  private save(list: Review[]) {
    writeJSON(KEY, list);
  }

  /** Visible reviews plus the viewer's own (whatever their status), newest first. */
  list(benchId: string, viewerId?: string): Review[] {
    return this.all()
      .filter((r) => r.benchId === benchId && (r.status !== 'hidden' || r.author.id === viewerId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  countVisible(benchId: string) {
    return this.all().filter((r) => r.benchId === benchId && r.status !== 'hidden').length;
  }

  listForModeration(): Review[] {
    return this.all().filter((r) => r.status !== 'visible');
  }

  add(input: { benchId: string; author: PublicAuthor; body: string; rating?: Review['rating'] }): Review {
    const err = validateReviewBody(input.body);
    if (err) throw new Error(err);
    const list = this.all();
    const mine = list.filter((r) => r.benchId === input.benchId && r.author.id === input.author.id).length;
    if (mine >= MAX_REVIEWS_PER_USER_PER_BENCH)
      throw new Error(`You've already posted ${MAX_REVIEWS_PER_USER_PER_BENCH} reviews on this bench — edit an existing one instead.`);
    const review: Review = {
      id: uid('review'),
      benchId: input.benchId,
      author: input.author,
      body: input.body.trim(),
      rating: input.rating,
      createdAt: new Date().toISOString(),
      status: 'visible',
      reports: [],
    };
    this.save([...list, review]);
    return review;
  }

  update(id: string, actorId: string, patch: { body: string; rating?: Review['rating'] }) {
    const err = validateReviewBody(patch.body);
    if (err) throw new Error(err);
    const list = this.all();
    const r = list.find((x) => x.id === id);
    if (!r) throw new Error('Review not found.');
    if (r.author.id !== actorId) throw new Error('You can only edit your own reviews.');
    r.body = patch.body.trim();
    r.rating = patch.rating;
    r.updatedAt = new Date().toISOString();
    this.save(list);
  }

  remove(id: string, actorId: string) {
    const list = this.all();
    const r = list.find((x) => x.id === id);
    if (!r) return;
    if (r.author.id !== actorId) throw new Error('You can only delete your own reviews.');
    this.save(list.filter((x) => x.id !== id));
  }

  report(id: string, reporterId: string, reason: ReportReason) {
    const list = this.all();
    const r = list.find((x) => x.id === id);
    if (!r) return;
    if (r.author.id === reporterId) throw new Error("You can't report your own review.");
    if (r.reports.some((x) => x.userId === reporterId)) throw new Error("You've already reported this review.");
    r.reports.push({ userId: reporterId, reason, at: new Date().toISOString() });
    r.status = r.reports.length >= AUTO_HIDE_REPORT_THRESHOLD ? 'hidden' : 'flagged';
    this.save(list);
  }

  /** Moderator action (DEV panel in v1; admin role / service key in production). */
  moderate(id: string, status: ModerationStatus | 'delete') {
    const list = this.all();
    if (status === 'delete') return this.save(list.filter((x) => x.id !== id));
    const r = list.find((x) => x.id === id);
    if (!r) return;
    r.status = status;
    if (status === 'visible') r.reports = [];
    this.save(list);
  }

  clearAll() {
    writeJSON(KEY, null);
  }

  renameAuthor(authorId: string, name: string) {
    const list = this.all();
    let changed = false;
    for (const r of list)
      if (r.author.id === authorId && r.author.name !== name) {
        r.author = { id: authorId, name };
        changed = true;
      }
    if (changed) this.save(list);
  }
}

export const reviewRepo = new LocalReviewRepository();
