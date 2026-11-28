import { useMemo, useRef, useState } from 'react';
import type { GalleryPhoto, ViewBench } from '../types';
import { difficultyLabel, isPaidTier, materialLabel } from '../config/taxonomy';
import { compressImage } from '../utils/image';
import { useMediaQuery } from '../hooks/useMediaQuery';
import PaywallCard from './PaywallCard';

const PUBLIC_WEB_ORIGIN = 'https://findmybench.netlify.app';

export default function BenchDetail({
  view,
  isOwner,
  canUpdateMainPhoto = false,
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
  onDirections,
  onEdit,
  onUpdateMainPhoto,
  onAddPhoto,
  onOpenPhoto,
  reviews,
}: {
  view: ViewBench;
  isOwner: boolean;
  canUpdateMainPhoto?: boolean;
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
  onDirections?(): void;
  onEdit(): void;
  onUpdateMainPhoto?(photoDataUrl: string): Promise<void> | void;
  onAddPhoto(): void;
  onOpenPhoto(photo: GalleryPhoto): void;
  reviews: React.ReactNode;
}) {
  const { bench, locked } = view;
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [updatingMainPhoto, setUpdatingMainPhoto] = useState(false);
  const [hoveredPhotoId, setHoveredPhotoId] = useState<string | null>(null);
  const mainPhotoInputRef = useRef<HTMLInputElement>(null);

  const visiblePhotos = useMemo(
    () => photos.filter((p) => p.status !== 'hidden' || (viewerId && p.author.id === viewerId)),
    [photos, viewerId],
  );

  const mainPhotoSrc = bench.photo || visiblePhotos[0]?.src || undefined;

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
      const host = window.location.hostname;
      const isLocal = !host || host === 'localhost' || host === '127.0.0.1';
      const baseOrigin = isLocal ? PUBLIC_WEB_ORIGIN : window.location.origin;
      const url = new URL('/', baseOrigin);
      url.searchParams.set('bench', bench.id);
      await navigator.clipboard?.writeText(url.toString());
    } catch {
      // Clipboard may be restricted
    }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1600);
  };

  const handleDirectionsClick = () => {
    if (onDirections) {
      onDirections();
      return;
    }
    const url = `https://www.openstreetmap.org/?mlat=${bench.lat}&mlon=${bench.lng}#map=17/${bench.lat}/${bench.lng}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleMainPhotoFile = async (file: File | undefined) => {
    if (!file || !onUpdateMainPhoto) return;
    setUpdatingMainPhoto(true);
    try {
      const compressed = await compressImage(file);
      await onUpdateMainPhoto(compressed);
    } finally {
      setUpdatingMainPhoto(false);
    }
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
        {mainPhotoSrc ? (
          <>
            <img src={mainPhotoSrc} alt={bench.name} />
            <span className="photo-badge">
              {bench.mainPhotoSetByPhotographer ? 'Photographer photo' : 'Initial photo'}
            </span>
          </>
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
            <button type="button" className="btn btn-primary" onClick={handleDirectionsClick}>
              Directions
            </button>
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
              <div
                className="gallery-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: isDesktop ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
                  gap: 10,
                }}
              >
                {visiblePhotos.map((p) => {
                  const isHovered = hoveredPhotoId === p.id;
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <button
                        type="button"
                        className={`thumb ${p.status === 'hidden' ? 'status-hidden' : ''}`}
                        onClick={() => onOpenPhoto(p)}
                        onMouseEnter={() => isDesktop && setHoveredPhotoId(p.id)}
                        onMouseLeave={() => isDesktop && setHoveredPhotoId((cur) => (cur === p.id ? null : cur))}
                        onFocus={() => isDesktop && setHoveredPhotoId(p.id)}
                        onBlur={() => isDesktop && setHoveredPhotoId((cur) => (cur === p.id ? null : cur))}
                        style={{
                          position: 'relative',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '100%',
                          height: isDesktop ? 148 : 200,
                          padding: 4,
                          overflow: 'hidden',
                          borderRadius: 10,
                          background: 'rgba(15, 23, 42, 0.06)',
                        }}
                      >
                        <img
                          src={p.src}
                          alt={p.caption || bench.name}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            display: 'block',
                            borderRadius: 6,
                          }}
                        />
                        {isDesktop && p.caption && (
                          <span
                            className="thumb-cap"
                            style={{
                              position: 'absolute',
                              insetInline: 0,
                              bottom: 0,
                              padding: '8px 10px',
                              background: 'rgba(15, 23, 42, 0.82)',
                              color: '#ffffff',
                              fontSize: 12,
                              lineHeight: 1.35,
                              textAlign: 'left',
                              opacity: isHovered ? 1 : 0,
                              transition: 'opacity 140ms ease',
                              pointerEvents: 'none',
                            }}
                          >
                            {p.caption}
                          </span>
                        )}
                        {p.status === 'hidden' && <span className="thumb-flag">Hidden</span>}
                      </button>

                      {!isDesktop && p.caption && (
                        <span
                          className="thumb-cap small"
                          style={{
                            padding: '2px 4px',
                            lineHeight: 1.35,
                            wordBreak: 'break-word',
                          }}
                        >
                          {p.caption}
                        </span>
                      )}
                    </div>
                  );
                })}
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

      {(isOwner || canUpdateMainPhoto) && (
        <div className="owner-bar">
          {isOwner && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit}>
              Edit bench
            </button>
          )}
          {canUpdateMainPhoto && onUpdateMainPhoto && (
            <>
              <input
                ref={mainPhotoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                hidden
                onChange={(e) => {
                  void handleMainPhotoFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={updatingMainPhoto}
                onClick={() => mainPhotoInputRef.current?.click()}
              >
                {updatingMainPhoto ? 'Updating main photo…' : 'Update main photo'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}