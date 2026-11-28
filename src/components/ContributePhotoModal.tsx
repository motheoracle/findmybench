import { useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import type { Bench, ModerationStatus, PhotoTag } from '../types';
import {
  CAPTION_MAX_CHARS,
  MAX_GALLERY_PHOTOS_PER_USER_PER_BENCH,
  PHOTO_EXIF_MATCH_RADIUS_M,
  PHOTO_MAX_UPLOAD_BYTES,
  PHOTO_TAGS,
} from '../config/community';
import { processPhoto, type ProcessedPhoto } from '../utils/image';
import type { ScreeningDecision } from '../utils/photoModeration';
import { haversineMeters } from '../utils/routing';
import { formatDistance } from '../utils/geo';

export interface ContributionPayload {
  photo: ProcessedPhoto;
  tag: PhotoTag;
  caption: string;
  screeningDecision: ScreeningDecision;
  moderationStatus: ModerationStatus;
  screeningReason: string;
  faceBlurApplied: boolean;
  faceBlurNote: string;
}

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
  const [fileName, setFileName] = useState('');
  const [tag, setTag] = useState<PhotoTag | null>(null);
  const [useCustomLabel, setUseCustomLabel] = useState(false);
  const [customWhatItShows, setCustomWhatItShows] = useState('');
  const [caption, setCaption] = useState('');
  const [hasPeople, setHasPeople] = useState<boolean>(false);
  const [blurFaces, setBlurFaces] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const exifDistanceM = useMemo(() => {
    if (!photo?.exifGps) return null;
    return haversineMeters(photo.exifGps, { lat: bench.lat, lng: bench.lng });
  }, [photo, bench.lat, bench.lng]);

  const onFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setFileName(file.name);
    try {
      setPhoto(await processPhoto(file, 1280, 0.7));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!photo) return setError('Choose or take a photo first.');

    const cleanCustom = customWhatItShows.trim();
    if (useCustomLabel) {
      if (!cleanCustom) {
        return setError('Tell us what the photo shows.');
      }
    } else if (!tag) {
      return setError('Tell us what the photo shows.');
    }

    const resolvedTag: PhotoTag = tag ?? PHOTO_TAGS[0].value;

    setBusy(true);
    setError(null);
    try {
      const trimmedCaption = caption.trim();
      const combinedCaption =
        useCustomLabel && cleanCustom
          ? trimmedCaption
            ? `${cleanCustom} — ${trimmedCaption}`
            : cleanCustom
          : trimmedCaption;

      const { applyFaceBlurIfRequested, screenPhotoUploadWithOcr } = await import(
        '../utils/photoModeration'
      );

      const screening = await screenPhotoUploadWithOcr({
        caption: combinedCaption,
        fileName,
        tag: resolvedTag,
        width: photo.width,
        height: photo.height,
        dataUrl: photo.dataUrl,
        exifGps: photo.exifGps,
        benchLocation: { lat: bench.lat, lng: bench.lng },
      });

      if (screening.decision === 'blocked') {
        setError(screening.reason);
        return;
      }

      const faceResult = await applyFaceBlurIfRequested(photo.dataUrl, hasPeople, blurFaces);
      const finalPhoto: ProcessedPhoto = {
        ...photo,
        dataUrl: faceResult.dataUrl,
      };
      const moderationStatus: ModerationStatus =
        screening.decision === 'flagged' ? 'flagged' : 'visible';

      const submitErr = onSubmit({
        photo: finalPhoto,
        tag: resolvedTag,
        caption: combinedCaption.slice(0, CAPTION_MAX_CHARS),
        screeningDecision: screening.decision,
        moderationStatus,
        screeningReason: screening.reason,
        faceBlurApplied: faceResult.appliedBlur,
        faceBlurNote: faceResult.statusMessage,
      });
      if (submitErr) setError(submitErr);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
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
          next to it. Unrelated or policy-violating images are blocked or held for review. You can add {remaining} more.
        </p>

        {photo ? (
          <div className="photo-preview">
            <img src={photo.dataUrl} alt="Your photo preview" />
            {exifDistanceM !== null ? (
              exifDistanceM <= PHOTO_EXIF_MATCH_RADIUS_M ? (
                <p className="info small">
                  ✓ Photo GPS metadata matches this bench ({formatDistance(exifDistanceM, 'metric')} away, within {PHOTO_EXIF_MATCH_RADIUS_M}m).
                </p>
              ) : (
                <p className="warn small">
                  Photo GPS metadata is {formatDistance(exifDistanceM, 'metric')} from this bench (outside the {PHOTO_EXIF_MATCH_RADIUS_M}m check). Make sure this photo shows {bench.name}.
                </p>
              )
            ) : (
              <p className="muted fine">
                No GPS location tag found in photo metadata (normal for screenshots, edits, or shared images).
              </p>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setPhoto(null);
                setFileName('');
              }}
            >
              Choose a different photo
            </button>
          </div>
        ) : (
          <div className="row-actions">
            <button type="button" className="btn btn-outline" onClick={() => cameraRef.current?.click()} disabled={busy}>📷 Take photo</button>
            <button type="button" className="btn btn-outline" onClick={() => libraryRef.current?.click()} disabled={busy}>🖼 Choose photo</button>
          </div>
        )}
        {busy && <p className="muted small">Checking safety, relevance &amp; privacy settings…</p>}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={libraryRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />

        <fieldset className="block">
          <legend>What does it show? <em>required</em></legend>
          <div
            className="option-grid three"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 8,
            }}
          >
            {PHOTO_TAGS.map((t) => (
              <label key={t.value} className={`option ${tag === t.value ? 'selected' : ''}`}>
                <input type="radio" name="photo-tag" checked={tag === t.value} onChange={() => setTag(t.value)} />
                <strong>{t.label}</strong>
                <span>{t.hint}</span>
              </label>
            ))}
          </div>

          <label className="checkbox-row" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={useCustomLabel}
              onChange={(e) => {
                const checked = e.target.checked;
                setUseCustomLabel(checked);
                if (!checked) setCustomWhatItShows('');
              }}
            />
            <span>Add a custom entry label</span>
          </label>

          {useCustomLabel && (
            <label className="field" style={{ marginTop: 8 }}>
              <span>Custom entry <em className="muted">(required)</em></span>
              <input
                value={customWhatItShows}
                maxLength={80}
                onChange={(e) => setCustomWhatItShows(e.target.value)}
                placeholder="e.g. Plaque inscription, walking path, shade tree"
              />
            </label>
          )}
        </fieldset>

        <fieldset className="block">
          <legend>People in photo</legend>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={hasPeople}
              onChange={(e) => {
                const checked = e.target.checked;
                setHasPeople(checked);
                if (!checked) setBlurFaces(true);
              }}
            />
            <span>There are people in this photo</span>
          </label>

          {hasPeople && (
            <>
              <div className="row-actions" style={{ marginTop: 10 }}>
                <label className={`option ${blurFaces ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="face-blur-choice"
                    checked={blurFaces}
                    onChange={() => setBlurFaces(true)}
                  />
                  <strong>Blur detected faces</strong>
                  <span>Pixelate &amp; blur faces only before going live</span>
                </label>
                <label className={`option ${!blurFaces ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="face-blur-choice"
                    checked={!blurFaces}
                    onChange={() => setBlurFaces(false)}
                  />
                  <strong>Leave faces unblurred</strong>
                  <span>Keep people unblurred as taken</span>
                </label>
              </div>
              {blurFaces && (
                <p className="small" style={{ color: '#b91c1c', marginTop: 8, marginBottom: 0 }}>
                  <strong>Notice:</strong> Edited photos with filters (such as black &amp; white or sepia), photos under 320px (low pixel count), or small/side-facing faces may not blur automatically due to face-detection limits.
                </p>
              )}
            </>
          )}
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

        {error && <div className="error" role="alert">{error}</div>}
        <button type="button" className="btn btn-primary btn-block" onClick={() => { void submit(); }} disabled={busy}>
          Add photo
        </button>
        <p className="fine">
          JPEG, PNG, WebP or HEIC · up to {Math.round(PHOTO_MAX_UPLOAD_BYTES / 1024 / 1024)} MB raw (high-MP compressed automatically) · GPS checked if present, stripped from saved image.
        </p>
      </div>
    </Modal>
  );
}