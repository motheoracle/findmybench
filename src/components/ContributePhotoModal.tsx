import { useRef, useState } from 'react';
import Modal from './Modal';
import type { Bench, PhotoTag } from '../types';
import { CAPTION_MAX_CHARS, MAX_GALLERY_PHOTOS_PER_USER_PER_BENCH, PHOTO_TAGS } from '../config/community';
import { processPhoto, type ProcessedPhoto } from '../utils/image';

export interface ContributionPayload {
  photo: ProcessedPhoto;
  tag: PhotoTag;
  caption: string;
}

/**
 * Structured gallery contribution. Guardrails (UX side — mirrored server-side in production):
 * signed-in only (enforced by App), required context tag, short link-free caption,
 * file type/size/min-dimension checks, per-user-per-bench cap, and an on-site attestation.
 */
export default function ContributePhotoModal({
  bench,
  remaining,
  onClose,
  onSubmit,
}: {
  bench: Bench;
  remaining: number;
  onClose(): void;
  onSubmit(p: ContributionPayload): string | null;
}) {
  const [photo, setPhoto] = useState<ProcessedPhoto | null>(null);
  const [tag, setTag] = useState<PhotoTag | null>(null);
  const [caption, setCaption] = useState('');
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const onFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setPhoto(await processPhoto(file, 1280, 0.7));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (!photo) return setError('Choose or take a photo first.');
    if (!tag) return setError('Tell us what the photo shows.');
    if (!attest) return setError('Please confirm the photo was taken at or near this bench.');
    setError(onSubmit({ photo, tag, caption: caption.trim() }));
  };

  if (remaining <= 0) {
    return (
      <Modal title="Photo limit reached" onClose={onClose}>
        <p>
          You've added the maximum of {MAX_GALLERY_PHOTOS_PER_USER_PER_BENCH} photos to <strong>{bench.name}</strong>.
          Delete one of yours from the gallery to add another.
        </p>
        <button className="btn btn-primary btn-block" onClick={onClose}>OK</button>
      </Modal>
    );
  }

  return (
    <Modal title="Add to the photo gallery" onClose={onClose}>
      <div className="stack">
        <p className="muted small">
          For <strong>{bench.name}</strong>. Photos should show this bench, the view from it, or something right
          next to it. Random or unrelated images get reported and removed. You can add {remaining} more.
        </p>

        {photo ? (
          <div className="photo-preview">
            <img src={photo.dataUrl} alt="Your photo preview" />
            <button className="btn btn-ghost btn-sm" onClick={() => setPhoto(null)}>Choose a different photo</button>
          </div>
        ) : (
          <div className="row-actions">
            <button className="btn btn-outline" onClick={() => cameraRef.current?.click()} disabled={busy}>📷 Take photo</button>
            <button className="btn btn-outline" onClick={() => libraryRef.current?.click()} disabled={busy}>🖼 Choose photo</button>
          </div>
        )}
        {busy && <p className="muted small">Checking photo…</p>}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={libraryRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />

        <fieldset className="block">
          <legend>What does it show? <em>required</em></legend>
          <div className="option-grid three">
            {PHOTO_TAGS.map((t) => (
              <label key={t.value} className={`option ${tag === t.value ? 'selected' : ''}`}>
                <input type="radio" name="photo-tag" checked={tag === t.value} onChange={() => setTag(t.value)} />
                <strong>{t.label}</strong>
                <span>{t.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>Caption <em className="muted">(optional, {caption.length}/{CAPTION_MAX_CHARS})</em></span>
          <input
            value={caption}
            maxLength={CAPTION_MAX_CHARS}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="e.g. Looking west over the Forth at sunset"
          />
        </label>

        <label className="check">
          <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
          <span>I took this photo at or near this bench, and it doesn't show identifiable people's faces or number plates.</span>
        </label>

        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>Add photo</button>
        <p className="fine">JPEG, PNG, WebP or HEIC · up to 15 MB · location metadata is stripped before saving.</p>
      </div>
    </Modal>
  );
}
