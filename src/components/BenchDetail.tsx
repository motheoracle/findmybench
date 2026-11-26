import { useMemo, useState } from 'react';
import type { GalleryPhoto, ViewBench } from '../types';
import { difficultyLabel, isPaidTier, materialLabel } from '../config/taxonomy';
import PaywallCard from './PaywallCard';

export default function BenchDetail({
  view,
  isOwner,
  viewerId,
  signedIn,
  photos,
  photoCount,
  reviewCount,
  remainingPhotos,
  backLabel = 'All benches',
  onBack,
  onUnlock,
  onZoom,
  onEdit,
  onAddPhoto,
  onOpenPhoto,
  reviews,
}: {
  view: ViewBench;
  isOwner: boolean;
  viewerId?: string;
  signedIn: boolean;
  photos: GalleryPhoto[];
  photoCount: number;
  reviewCount: number;
  remainingPhotos: number;
  backLabel?: string;
  onBack(): void;
  onUnlock(): void;
  onZoom(): void;
  onEdit(): void;
  onAddPhoto(): void;
  onOpenPhoto(photo: GalleryPhoto): void;
  reviews: React.ReactNode;
}) {
  const { bench, locked } = view;
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const visiblePhotos = useMemo(
    () => photos.filter((p) => p.status !== 'hidden' || (viewerId && p.author.id === viewerId)),
    [photos, viewerId],
  );

  const copy = async () => {
    const text = `${bench.lat.toFixed(6)}, ${bench.lng.toFixed(6)}`;
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      // Clipboard may be blocked in restricted contexts
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const copyLink = async () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('bench', bench.id);
      await navigator.clipboard?.writeText(url.toString());
    } catch {
      // Clipboard may be restricted
    }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1600);
  };
  const isPaid = isPaidTier(bench.difficulty);

  return (
    <div className="view detail">
      <div className="detail-top">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          &lsaquo; {backLabel}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onZoom}>
          Zoom to
        </button>
      </div>

      <div className="badges">
        <span className={`pill ${isPaid ? 'obscure' : 'standard'}`}>
          {isPaid ? 'Pro' : 'Free'}
        </span>
        <span className="pill">{difficultyLabel(bench.difficulty)}</span>
        {bench.source === 'user' && <span className="pill">Community</span>}
      </div>

      <h2 className="detail-title">{bench.name}</h2>
      <p className="muted">
        {bench.region} &middot; {bench.source === 'user' ? 'Community find' : 'Curated spot'}
      </p>

      <div className="photo-frame">
        {bench.photo ? (
          <img src={bench.photo} alt={bench.name} />
        ) : (
                    <div className="photo-placeholder" aria-label="No main photo yet">
            <svg
              className="bench-placeholder-icon"
              viewBox="0 0 64 36"
              width="56"
              height="32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <rect x="6" y="12" width="52" height="5" rx="2" fill="currentColor" opacity="0.75" />
              <rect x="9" y="19" width="46" height="4" rx="1.5" fill="currentColor" opacity="0.55" />
              <path d="M13 17V31M51 17V31M13 24H51" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <span>No main photo yet</span>
          </div>
        )}
      </div>

      {locked ? (
        <PaywallCard onUnlock={onUnlock} />
      ) : (
        <>
          <div className="block">
            <h3>How to find it</h3>
            <p>{bench.directions}</p>
          </div>

          <div className="meta-card">
            <div className="meta-row">
              <span>Material</span>
              <strong>
                {materialLabel(bench.material)}
                {bench.materialNote ? ` (${bench.materialNote})` : ''}
              </strong>
            </div>
            <div className="meta-row">
              <span>Coordinates</span>
              <strong className="mono">
                {bench.lat.toFixed(6)}, {bench.lng.toFixed(6)}
              </strong>
            </div>
            {bench.createdBy && (
              <div className="meta-row">
                <span>Logged by</span>
                <strong>
                  {bench.createdBy.name}
                  {typeof bench.createdBy.age === 'number' ? `, ${bench.createdBy.age}` : ''}
                </strong>
              </div>
            )}
            <div className="meta-row">
              <span>Reviews</span>
              <strong>{reviewCount}</strong>
            </div>
          </div>

          {bench.notes && (
            <div className="block">
              <h3>Notes</h3>
              <p className="pre">{bench.notes}</p>
            </div>
          )}

          <div className="actions">
            <a
              className="btn btn-primary"
              href={`https://www.openstreetmap.org/?mlat=${bench.lat}&mlon=${bench.lng}#map=17/${bench.lat}/${bench.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              Directions
            </a>
            <button type="button" className="btn btn-secondary" onClick={copy}>
              {copied ? 'Copied' : 'Copy coords'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={copyLink}>
              {linkCopied ? 'Link copied' : 'Share link'}
            </button>
          </div>

          <div className="block">
            <div className="section-head">
              <h3>
                Photo gallery <span className="count">{photoCount}</span>
              </h3>
              <div className="row-gap">
                {remainingPhotos > 0 && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onAddPhoto}>
                    + Add photo ({remainingPhotos} left)
                  </button>
                )}
              </div>
            </div>
            {visiblePhotos.length > 0 ? (
              <div className="gallery-grid">
                {visiblePhotos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`thumb ${p.status === 'hidden' ? 'status-hidden' : ''}`}
                    onClick={() => onOpenPhoto(p)}
                  >
                    <img src={p.src} alt={p.caption || bench.name} />
                    {p.caption && <span className="thumb-cap">{p.caption}</span>}
                    {p.status === 'hidden' && <span className="thumb-flag">Hidden</span>}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted small">
                {signedIn ? 'No community photos yet - add the first view.' : 'Sign in to add community photos.'}
              </p>
            )}
          </div>

          {reviews}
        </>
      )}

      {isOwner && (
        <div className="owner-bar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit}>
            Edit bench
          </button>
        </div>
      )}
    </div>
  );
}

