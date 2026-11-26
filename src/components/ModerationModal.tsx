import Modal from './Modal';
import type { GalleryPhoto, ModerationStatus, Review } from '../types';
import { REPORT_REASONS, photoTagLabel } from '../config/community';

const reasonLabel = (r: string) => REPORT_REASONS.find((x) => x.value === r)?.label ?? r;

/** DEV-only moderation queue. Production: an admin dashboard backed by a service-role key / admin RLS role. */
export default function ModerationModal({
  photos,
  reviews,
  benchName,
  onClose,
  onPhoto,
  onReview,
}: {
  photos: GalleryPhoto[];
  reviews: Review[];
  benchName(id: string): string;
  onClose(): void;
  onPhoto(id: string, s: ModerationStatus | 'delete'): void;
  onReview(id: string, s: ModerationStatus | 'delete'): void;
}) {
  const actions = (fn: (s: ModerationStatus | 'delete') => void) => (
    <div className="row-gap">
      <button className="btn btn-outline btn-sm" onClick={() => fn('visible')}>Approve</button>
      <button className="btn btn-outline btn-sm" onClick={() => fn('hidden')}>Hide</button>
      <button className="btn btn-ghost btn-sm danger-text" onClick={() => fn('delete')}>Delete</button>
    </div>
  );
  return (
    <Modal title="Moderation queue (DEV)" onClose={onClose}>
      {photos.length + reviews.length === 0 && <p className="muted">Nothing flagged. 🎉</p>}
      <ul className="mod-list">
        {photos.map((p) => (
          <li key={p.id}>
            <img src={p.src} alt="" />
            <div>
              <strong>{photoTagLabel(p.tag)}</strong> on {benchName(p.benchId)} · <span className={`badge status-${p.status}`}>{p.status}</span>
              <div className="small muted">{p.reports.length} report(s): {p.reports.map((r) => reasonLabel(r.reason)).join(', ') || '—'}</div>
              {actions((s) => onPhoto(p.id, s))}
            </div>
          </li>
        ))}
        {reviews.map((r) => (
          <li key={r.id}>
            <div className="mod-review">“{r.body.slice(0, 160)}{r.body.length > 160 ? '…' : ''}”</div>
            <div>
              Review on {benchName(r.benchId)} · <span className={`badge status-${r.status}`}>{r.status}</span>
              <div className="small muted">{r.reports.length} report(s): {r.reports.map((x) => reasonLabel(x.reason)).join(', ') || '—'}</div>
              {actions((s) => onReview(r.id, s))}
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
