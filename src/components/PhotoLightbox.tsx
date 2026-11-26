import { useState } from 'react';
import Modal from './Modal';
import type { GalleryPhoto, ReportReason, User } from '../types';
import { REPORT_REASONS, photoTagLabel } from '../config/community';

export default function PhotoLightbox({
  photo,
  user,
  onClose,
  onDelete,
  onReport,
}: {
  photo: GalleryPhoto;
  user: User | null;
  onClose(): void;
  onDelete(): void;
  onReport(reason: ReportReason): string | null;
}) {
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<ReportReason>('off-topic');
  const [msg, setMsg] = useState<string | null>(null);
  const own = user?.id === photo.author.id;
  const alreadyReported = !!user && photo.reports.some((r) => r.userId === user.id);

  return (
    <Modal title={photoTagLabel(photo.tag)} onClose={onClose}>
      <div className="lightbox">
        <img src={photo.src} alt={photo.caption || photoTagLabel(photo.tag)} />
        {photo.caption && <p>{photo.caption}</p>}
        <p className="muted small">
          by {photo.author.name} · {new Date(photo.createdAt).toLocaleDateString('en-GB')}
        </p>
        {own && photo.status !== 'visible' && (
          <p className="status-note">
            {photo.status === 'hidden' ? 'Hidden pending moderation — only you can see this.' : 'Reported — under review.'}
          </p>
        )}
        <div className="row-actions">
          {own ? (
            <button className="btn btn-outline btn-sm danger-text" onClick={() => confirm('Delete this photo?') && onDelete()}>
              Delete my photo
            </button>
          ) : user ? (
            alreadyReported ? (
              <span className="muted small">You reported this photo — thanks.</span>
            ) : (
              <button className="btn btn-outline btn-sm" onClick={() => setReporting((r) => !r)}>⚑ Report photo</button>
            )
          ) : (
            <span className="muted small">Sign in to report a photo.</span>
          )}
        </div>
        {reporting && (
          <div className="report-box">
            <select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
              {REPORT_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                const err = onReport(reason);
                setMsg(err ?? 'Thanks — our moderators will take a look.');
                if (!err) setReporting(false);
              }}
            >
              Send report
            </button>
          </div>
        )}
        {msg && <p className="small">{msg}</p>}
      </div>
    </Modal>
  );
}
