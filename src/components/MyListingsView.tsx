import type { Bench } from '../types';
import { difficultyLabel } from '../config/taxonomy';

export interface ListingStats {
  reviews: number;
  photos: number;
}

export default function MyListingsView({
  benches,
  stats,
  onBack,
  onView,
  onEdit,
  onLogBench,
}: {
  benches: Bench[];
  stats: Record<string, ListingStats>;
  onBack(): void;
  onView(id: string): void;
  onEdit(id: string): void;
  onLogBench(): void;
}) {
  const sorted = [...benches].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
  return (
    <div className="view">
      <div className="detail-nav">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>‹ All benches</button>
      </div>
      <div className="detail-head">
        <h2>My Listings</h2>
        <p className="muted">
          {benches.length === 0 ? "You haven't logged any benches yet." : `${benches.length} bench${benches.length > 1 ? 'es' : ''} you've logged`}
        </p>
      </div>

      {benches.length === 0 ? (
        <div className="empty-card">
          <p>Found a great bench? Log it and it'll appear here, ready to edit any time.</p>
          <button className="btn btn-primary btn-block" onClick={onLogBench}>＋ Log a Bench</button>
        </div>
      ) : (
        <ul className="listing-list">
          {sorted.map((b) => (
            <li key={b.id} className="listing">
              <div className="listing-thumb">
                {b.photo ? <img src={b.photo} alt="" /> : <span aria-hidden="true">🪑</span>}
              </div>
              <div className="listing-main">
                <div className="bench-row-title">
                  <i className={`dot ${b.tier}`} /> {b.name}
                </div>
                <div className="bench-row-sub">
                  {difficultyLabel(b.difficulty)} · {stats[b.id]?.reviews ?? 0} reviews · {stats[b.id]?.photos ?? 0} photos
                </div>
                <div className="bench-row-sub">
                  {b.updatedAt ? `Edited ${new Date(b.updatedAt).toLocaleDateString('en-GB')}` : `Logged ${new Date(b.createdAt).toLocaleDateString('en-GB')}`}
                </div>
                <div className="row-gap mt">
                  <button className="btn btn-outline btn-sm" onClick={() => onView(b.id)}>🗺 View on map</button>
                  <button className="btn btn-primary btn-sm" onClick={() => onEdit(b.id)}>✎ Edit</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
