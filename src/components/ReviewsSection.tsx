import { useMemo, useState } from 'react';
import type { Rating, ReportReason, Review, User } from '../types';
import { REPORT_REASONS, REVIEW_MAX_CHARS, REVIEW_PREVIEW_CHARS } from '../config/community';

function resolveDisplayRating(review: Review): Rating | undefined {
  if (typeof review.rating === 'number' && review.rating >= 1 && review.rating <= 5) {
    return Math.round(review.rating) as Rating;
  }
  const tenMatch = review.body.match(/\b(10|[1-9])\s*\/\s*10\b/i);
  if (tenMatch) {
    const n = Number(tenMatch[1]);
    return Math.max(1, Math.min(5, Math.round(n / 2))) as Rating;
  }
  const fiveMatch = review.body.match(/\b([1-5])\s*\/\s*5\b|\b([1-5])\s*stars?\b/i);
  if (fiveMatch) {
    const n = Number(fiveMatch[1] || fiveMatch[2]);
    if (n >= 1 && n <= 5) return n as Rating;
  }
  return undefined;
}
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function Stars({ value, onChange }: { value?: Rating; onChange?(v: Rating | undefined): void }) {
  const interactive = !!onChange;
  return (
    <span className={`stars ${interactive ? 'interactive' : ''}`} role={interactive ? 'radiogroup' : undefined}>
      {([1, 2, 3, 4, 5] as const).map((n) => {
        const active = (value ?? 0) >= n;
        if (!interactive) {
          return (
            <span key={n} className={active ? 'on' : ''}>
              &#9733;
            </span>
          );
        }
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            className={active ? 'on' : ''}
            onClick={() => onChange(value === n ? undefined : n)}
          >
            &#9733;
          </button>
        );
      })}
    </span>
  );
}

function Composer({
  initialBody = '',
  initialRating,
  submitLabel = 'Post review',
  onCancel,
  onSubmit,
}: {
  initialBody?: string;
  initialRating?: Rating;
  submitLabel?: string;
  onCancel(): void;
  onSubmit(body: string, rating?: Rating): string | null | Promise<string | null>;
}) {
  const [body, setBody] = useState(initialBody);
  const [rating, setRating] = useState<Rating | undefined>(initialRating);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const len = body.trim().length;
  const pct = len / REVIEW_MAX_CHARS;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const msg = await onSubmit(body, rating);
    setBusy(false);
    if (msg) setErr(msg);
  };

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-rating">
        <span className="muted small">Your rating (optional)</span>
        <Stars value={rating} onChange={setRating} />
      </div>
      <textarea
        rows={3}
        maxLength={REVIEW_MAX_CHARS}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="How was it? The view, the walk in, condition of the bench, best time to visit..."
        aria-label="Write a review"
      />
      <div className="composer-foot">
        <span className={`counter ${pct > 0.9 ? 'warn' : ''}`}>
          {body.length}/{REVIEW_MAX_CHARS}
        </span>
        <div className="row-gap">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || len === 0}>
            {busy ? 'Saving...' : submitLabel}
          </button>
        </div>
      </div>
      {err && <p className="error">{err}</p>}
      <p className="fine">Reviews are public and show your display name - never your email.</p>
    </form>
  );
}

function ReviewItem({
  review,
  user,
  onUpdate,
  onDelete,
  onReport,
}: {
  review: Review;
  user: User | null;
  onUpdate(id: string, body: string, rating?: Rating): string | null | Promise<string | null>;
  onDelete(id: string): void | Promise<void>;
  onReport(id: string, reason: ReportReason, details: string): string | null | void | Promise<string | null | void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<ReportReason>('spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState(false);

  const isAuthor = !!user && review.author.id === user.id;
  const long = review.body.length > REVIEW_PREVIEW_CHARS;
  const text = long && !expanded ? `${review.body.slice(0, REVIEW_PREVIEW_CHARS).trimEnd()}...` : review.body;

  const saveEdit = async (body: string, rating?: Rating) => {
    const err = await onUpdate(review.id, body, rating);
    if (!err) setEditing(false);
    return err;
  };

  const handleDelete = async () => {
    setBusy(true);
    await onDelete(review.id);
    setBusy(false);
  };

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await onReport(review.id, reason, details);
    setBusy(false);
    setDetails('');
    setReported(true);
    setReporting(false);
  };

  if (editing) {
    return (
      <li className="review-card">
        <Composer
          initialBody={review.body}
          initialRating={review.rating}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={saveEdit}
        />
      </li>
    );
  }

  return (
    <li className={`review-card status-${review.status}`}>
      <div className="review-head">
        <div>
          <strong>
            {review.author.name}
            {typeof review.author.age === 'number' ? `, ${review.author.age}` : ''}
          </strong>
          <span className="muted small">
            {' '}
            &middot; {fmtDate(review.createdAt)}
            {review.updatedAt ? ' - edited' : ''}
          </span>
        </div>
        {(() => {
          const displayRating = resolveDisplayRating(review);
          return displayRating ? <Stars value={displayRating} /> : null;
        })()}
      </div>

      {review.status !== 'visible' && (
        <p className="status-note">
          {review.status === 'hidden'
            ? 'Hidden pending moderation - only you can see this.'
            : 'Reported - under review.'}
        </p>
      )}

      <p className="review-body">{text}</p>
      {long && (
        <button type="button" className="link-btn" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}

      <div className="review-actions">
        {isAuthor && (
          <>
            <button type="button" className="link-btn" onClick={() => setEditing(true)} disabled={busy}>
              Edit
            </button>
            <button type="button" className="link-btn danger" onClick={handleDelete} disabled={busy}>
              {busy ? 'Deleting...' : 'Delete'}
            </button>
          </>
        )}
        {!isAuthor && review.status === 'visible' && (
          reported ? (
            <span className="muted small">Reported - thanks</span>
          ) : (
            <button type="button" className="link-btn" onClick={() => setReporting((r) => !r)}>
              Report
            </button>
          )
        )}
      </div>

      {reporting && (
        <form
          className="report-box"
          onSubmit={handleReport}
          style={{
            display: 'grid',
            gap: 8,
            alignItems: 'stretch',
            marginTop: 10,
            paddingTop: 10,
            borderTop: '1px solid rgba(0, 0, 0, 0.08)',
          }}
        >
          <label className="field" style={{ width: '100%' }}>
            <span>Reason</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as ReportReason)}
              style={{ width: '100%' }}
            >
              {REPORT_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ width: '100%' }}>
            <span>Details (optional)</span>
            <input
              type="text"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Anything helpful for moderators"
              style={{ width: '100%' }}
            />
          </label>
          <div className="row-gap" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReporting(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>
              Submit report
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export default function ReviewsSection({
  reviews,
  user,
  onRequireAuth,
  onComposerOpen,
  onCreate,
  onUpdate,
  onDelete,
  onReport,
}: {
  reviews: Review[];
  user: User | null;
  onRequireAuth(): void;
  onComposerOpen?(): void;
  onCreate(body: string, rating?: Rating): string | null | Promise<string | null>;
  onUpdate(id: string, body: string, rating?: Rating): string | null | Promise<string | null>;
  onDelete(id: string): void | Promise<void>;
  onReport(id: string, reason: ReportReason, details: string): string | null | void | Promise<string | null | void>;
}) {
  const [composing, setComposing] = useState(false);
  const [reviewSort, setReviewSort] = useState<'newest' | 'highest' | 'lowest'>('newest');

  const visible = reviews.filter(
    (r) => r.status !== 'hidden' || (user && r.author.id === user.id),
  );
  const sortedReviews = useMemo(() => {
    if (reviewSort === 'highest') {
      return [...visible].sort((a, b) => (resolveDisplayRating(b) ?? 0) - (resolveDisplayRating(a) ?? 0));
    }
    if (reviewSort === 'lowest') {
      return [...visible].sort((a, b) => {
        const ra = resolveDisplayRating(a);
        const rb = resolveDisplayRating(b);
        if (ra === undefined && rb === undefined) return b.createdAt.localeCompare(a.createdAt);
        if (ra === undefined) return 1;
        if (rb === undefined) return -1;
        return ra - rb;
      });
    }
    return [...visible].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [visible, reviewSort]);
  const rated = visible.filter((r) => typeof resolveDisplayRating(r) === 'number');
  const avg = rated.length ? rated.reduce((s, r) => s + (resolveDisplayRating(r) ?? 0), 0) / rated.length : null;

  const startComposing = () => {
    if (!user) {
      onRequireAuth();
      return;
    }
    setComposing(true);
    onComposerOpen?.();
  };

  const create = async (body: string, rating?: Rating) => {
    const err = await onCreate(body, rating);
    if (!err) setComposing(false);
    return err;
  };

  return (
    <section className="block reviews">
      <div className="section-head">
        <h3>
          Reviews <span className="count">{visible.length}</span>
        </h3>
        <div className="row-gap" style={{ alignItems: 'center' }}>
          <select
            value={reviewSort}
            onChange={(e) => setReviewSort(e.target.value as 'newest' | 'highest' | 'lowest')}
            aria-label="Sort reviews"
            style={{ borderRadius: 8, padding: '3px 8px', border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)', fontSize: '0.8rem' }}
          >
            <option value="newest">Newest</option>
            <option value="highest">Highest rated</option>
            <option value="lowest">Lowest rated</option>
          </select>
        </div>
        {avg !== null && (
          <span className="muted small">
            &#9733; {avg.toFixed(1)} ({rated.length})
          </span>
        )}
      </div>

      {!composing ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={startComposing}>
          Write a review
        </button>
      ) : (
        <Composer onCancel={() => setComposing(false)} onSubmit={create} />
      )}

      {visible.length === 0 && !composing && (
        <p className="muted small">No reviews yet - be the first to share your visit.</p>
      )}

      <ul className="review-list">
        {sortedReviews.map((r) => (
          <ReviewItem
            key={r.id}
            review={r}
            user={user}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onReport={onReport}
          />
        ))}
      </ul>
    </section>
  );
}