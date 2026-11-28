import { useState } from 'react';
import Modal from './Modal';
import type { GalleryPhoto, ModerationStatus, Review } from '../types';
import { REPORT_REASONS, photoTagLabel } from '../config/community';

type ModerationAction = ModerationStatus | 'delete';

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
  onPhoto(id: string, s: ModerationAction): void;
  onReview(id: string, s: ModerationAction): void;
}) {
  const [photoChoices, setPhotoChoices] = useState<Record<string, ModerationAction>>({});
  const [reviewChoices, setReviewChoices] = useState<Record<string, ModerationAction>>({});

  const togglePhotoChoice = (id: string, action: ModerationAction) => {
    setPhotoChoices((prev) => {
      if (prev[id] === action) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: action };
    });
  };

  const toggleReviewChoice = (id: string, action: ModerationAction) => {
    setReviewChoices((prev) => {
      if (prev[id] === action) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: action };
    });
  };

  const activePhotoIds = new Set(photos.map((p) => p.id));
  const activeReviewIds = new Set(reviews.map((r) => r.id));

  const pendingPhotos = Object.entries(photoChoices).filter(([id]) => activePhotoIds.has(id));
  const pendingReviews = Object.entries(reviewChoices).filter(([id]) => activeReviewIds.has(id));
  const selectedCount = pendingPhotos.length + pendingReviews.length;

  const confirmAll = () => {
    if (selectedCount === 0) return;
    for (const [id, action] of pendingPhotos) {
      onPhoto(id, action);
    }
    for (const [id, action] of pendingReviews) {
      onReview(id, action);
    }
    setPhotoChoices({});
    setReviewChoices({});
  };

  const renderActions = (
    selected: ModerationAction | undefined,
    onSelect: (action: ModerationAction) => void,
  ) => (
    <div className="row-gap" style={{ flexWrap: 'wrap' }}>
      <button
        type="button"
        className={`btn btn-sm ${selected === 'visible' ? 'btn-primary' : 'btn-outline'}`}
        onClick={() => onSelect('visible')}
      >
        {selected === 'visible' ? '✓ Approve' : 'Approve'}
      </button>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        style={
          selected === 'hidden'
            ? { background: '#92400e', color: '#fff', borderColor: '#92400e' }
            : undefined
        }
        onClick={() => onSelect('hidden')}
      >
        {selected === 'hidden' ? '✓ Hide' : 'Hide'}
      </button>
      <button
        type="button"
        className={`btn btn-sm ${selected === 'delete' ? '' : 'btn-ghost danger-text'}`}
        style={
          selected === 'delete'
            ? { background: '#b91c1c', color: '#fff', borderColor: '#b91c1c' }
            : undefined
        }
        onClick={() => onSelect('delete')}
      >
        {selected === 'delete' ? '✓ Delete' : 'Delete'}
      </button>
    </div>
  );

  return (
    <Modal title="Moderation queue (DEV)" onClose={onClose}>
      {photos.length + reviews.length === 0 && <p className="muted">Nothing flagged. 🎉</p>}
      <ul className="mod-list">
        {photos.map((p) => (
          <li key={p.id}>
            <img src={p.src} alt="" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>
                <strong>{photoTagLabel(p.tag)}</strong> on {benchName(p.benchId)} ·{' '}
                <span className={`badge status-${p.status}`}>{p.status}</span>
              </div>
              <div className="small muted">
                {p.reports.length} report(s):{' '}
                {p.reports.map((r) => reasonLabel(r.reason)).join(', ') || '—'}
              </div>
              {renderActions(photoChoices[p.id], (s) => togglePhotoChoice(p.id, s))}
            </div>
          </li>
        ))}
        {reviews.map((r) => (
          <li
            key={r.id}
            style={{
              padding: 12,
              borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.08)',
              background: 'rgba(0,0,0,0.02)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>
                “{r.body.slice(0, 160)}
                {r.body.length > 160 ? '…' : ''}”
              </div>
              <div className="small muted">
                Review on <strong>{benchName(r.benchId)}</strong> ·{' '}
                <span className={`badge status-${r.status}`}>{r.status}</span>
              </div>
              <div className="small muted">
                {r.reports.length} report(s):{' '}
                {r.reports.map((rep) => reasonLabel(rep.reason)).join(', ') || '—'}
              </div>
              {renderActions(reviewChoices[r.id], (s) => toggleReviewChoice(r.id, s))}
            </div>
          </li>
        ))}
      </ul>

      {photos.length + reviews.length > 0 && (
        <div
          className="row-actions"
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px solid rgba(0,0,0,0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span className="small muted">
            {selectedCount === 0
              ? 'Select actions above, then confirm.'
              : `${selectedCount} ${selectedCount === 1 ? 'action' : 'actions'} selected`}
          </span>
          <div className="row-gap">
            {selectedCount > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setPhotoChoices({});
                  setReviewChoices({});
                }}
              >
                Clear
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={selectedCount === 0}
              onClick={confirmAll}
            >
              Confirm{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}