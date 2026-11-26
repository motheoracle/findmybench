import { useRef, useState, type FormEvent } from 'react';
import type { Bench, Difficulty, DraftLocation, Material, NearbyMatch, Units, User } from '../types';
import { DIFFICULTIES, MATERIALS } from '../config/taxonomy';
import { DUPLICATE_RADIUS_M, LOW_ACCURACY_WARN_M } from '../config/community';
import { formatCoord, formatDistance } from '../utils/geo';
import { compressImage } from '../utils/image';

export interface SubmitPayload {
  name: string;
  difficulty: Difficulty;
  material: Material;
  materialNote?: string;
  directions: string;
  notes?: string;
  photo?: string;
}

/**
 * "Log a Bench" (mode=create) and "Edit bench" (mode=edit) share this form.
 * Location lives in App state (the map sets it), so it's passed in as `draft`.
 */
export default function SubmitBenchForm({
  mode,
  initial,
  user,
  draft,
  pickMode,
  locating,
  duplicate,
  duplicateLocked,
  units,
  onStartPick,
  onUseCurrentLocation,
  onCancel,
  onSubmit,
  onOpenExisting,
  onContributeToExisting,
}: {
  mode: 'create' | 'edit';
  initial?: Bench;
  user: User;
  draft: DraftLocation | null;
  pickMode: boolean;
  locating: boolean;
  duplicate: NearbyMatch | null;
  duplicateLocked: boolean;
  units: Units;
  onStartPick(): void;
  onUseCurrentLocation(): void;
  onCancel(): void;
  onSubmit(p: SubmitPayload): void;
  onOpenExisting(id: string): void;
  onContributeToExisting(id: string): void;
}) {
  const [name, setName] = useState(initial?.name === 'Unnamed bench' ? '' : initial?.name ?? '');
  const [difficulty, setDifficulty] = useState<Difficulty | null>(initial?.difficulty ?? null);
  const [material, setMaterial] = useState<Material | null>(initial?.material ?? null);
  const [materialNote, setMaterialNote] = useState(initial?.materialNote ?? '');
  const [directions, setDirections] = useState(initial?.directions ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [photo, setPhoto] = useState<string | undefined>(initial?.photo);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    try {
      setPhoto(await compressImage(file));
      setErrors([]);
    } catch (err) {
      setErrors([(err as Error).message]);
    } finally {
      setPhotoBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: string[] = [];
    if (!draft) errs.push('Drop a pin on the map or use your current location.');
    if (duplicate) errs.push('A bench is already logged at this spot — open it or add a photo to its gallery instead.');
    if (!difficulty) errs.push('Choose how hard it is to find.');
    if (!material) errs.push('Choose a material.');
    if (directions.trim().length < 10) errs.push('Add a short description of how to find it (10+ characters).');
    if (name.trim().length > 80) errs.push('Bench name must be 80 characters or fewer.');
    setErrors(errs);
    if (errs.length) return;
    onSubmit({
      name: name.trim(),
      difficulty: difficulty!,
      material: material!,
      materialNote: materialNote.trim() || undefined,
      directions: directions.trim(),
      notes: notes.trim() || undefined,
      photo,
    });
  };

  const isObscure = difficulty === 'tricky' || difficulty === 'hidden';
  const moved = mode === 'edit' && initial && draft && (draft.lat !== initial.lat || draft.lng !== initial.lng);

  return (
    <form className="view submit" onSubmit={submit} noValidate>
      <div className="detail-nav">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>‹ Cancel</button>
        <span className="muted small">Signed in as {user.name}</span>
      </div>
      <h2>{mode === 'edit' ? 'Edit bench' : 'Log a Bench'}</h2>

      {/* 1. Location */}
      <fieldset className="block">
        <legend><span className="step">1</span> Location</legend>
        <div className={`loc-card ${draft && !duplicate ? 'set' : ''} ${duplicate ? 'dup' : ''} ${pickMode ? 'picking' : ''}`}>
          {pickMode ? (
            <span>Tap the map where the bench is… (zoom in close — Satellite helps)</span>
          ) : draft ? (
            <>
              <span className="mono">{formatCoord(draft.lat, draft.lng)}</span>
              <span className="muted small">
                {draft.accuracyM !== undefined ? `GPS accuracy ±${formatDistance(draft.accuracyM, units)} · ` : ''}
                Drag the pin to fine-tune{moved ? ' · location changed' : ''}
              </span>
            </>
          ) : (
            <span className="muted">No location yet</span>
          )}
        </div>
        {draft?.accuracyM !== undefined && draft.accuracyM > LOW_ACCURACY_WARN_M && !duplicate && (
          <p className="warn">Low GPS accuracy. Zoom in and drag the pin onto the exact bench for a precise listing.</p>
        )}

        {duplicate && (
          <div className="dup-card" role="alert">
            <strong>
              {duplicateLocked ? 'An obscure bench' : `“${duplicate.bench.name}”`} is already logged{' '}
              {formatDistance(duplicate.distanceM, units)} from this spot.
            </strong>
            <p>
              Benches within {formatDistance(DUPLICATE_RADIUS_M, units)} of each other count as the same bench, so we
              can't create a duplicate.{' '}
              {duplicateLocked
                ? 'Unlock obscure benches to view it and add photos.'
                : 'You can open it, or add your photo to its gallery instead.'}
            </p>
            <div className="row-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenExisting(duplicate.bench.id)}>
                Open existing bench
              </button>
              {!duplicateLocked && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => onContributeToExisting(duplicate.bench.id)}>
                  📷 Add a photo to its gallery
                </button>
              )}
            </div>
            <p className="fine">Is it genuinely a different bench? Move the pin onto its exact position.</p>
          </div>
        )}

        <div className="row-actions">
          <button type="button" className={`btn ${pickMode ? 'btn-primary' : 'btn-outline'}`} onClick={onStartPick}>
            📍 {draft ? 'Move pin' : 'Pick on map'}
          </button>
          <button type="button" className="btn btn-outline" onClick={onUseCurrentLocation} disabled={locating}>
            {locating ? 'Locating…' : '⌖ Use Current Location'}
          </button>
        </div>
      </fieldset>

      {/* 2. Bench name */}
      <fieldset className="block">
        <legend><span className="step">2</span> Bench name <em>optional</em></legend>
        <input
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="Bench name or dedication plaque"
        />
      </fieldset>

      {/* 3. Photo */}
      <fieldset className="block">
        <legend><span className="step">3</span> Main photo <em>optional</em></legend>
        {photo ? (
          <div className="photo-preview">
            <img src={photo} alt="Bench preview" />
            <div className="row-actions">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => libraryRef.current?.click()} disabled={photoBusy}>
                Replace
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhoto(undefined)}>Remove</button>
            </div>
          </div>
        ) : (
          <div className="row-actions">
            <button type="button" className="btn btn-outline" onClick={() => cameraRef.current?.click()} disabled={photoBusy}>
              📷 Take photo
            </button>
            <button type="button" className="btn btn-outline" onClick={() => libraryRef.current?.click()} disabled={photoBusy}>
              🖼 Choose photo
            </button>
          </div>
        )}
        {photoBusy && <p className="muted small">Processing photo…</p>}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={libraryRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        <p className="fine">Not in position for a photo? Skip it — you or others can add gallery photos later.</p>
      </fieldset>

      {/* 4. Difficulty */}
      <fieldset className="block">
        <legend><span className="step">4</span> How hard is it to find?</legend>
        <div className="option-grid">
          {DIFFICULTIES.map((d) => (
            <label key={d.value} className={`option ${difficulty === d.value ? 'selected' : ''}`}>
              <input type="radio" name="difficulty" value={d.value} checked={difficulty === d.value} onChange={() => setDifficulty(d.value)} />
              <strong>{d.label}</strong>
              <span>{d.hint}</span>
            </label>
          ))}
        </div>
        {isObscure && (
          <p className="info">This will be listed as an <strong>Obscure</strong> bench — visible in full to subscribers (and always to you).</p>
        )}
      </fieldset>

      {/* 5. Directions */}
      <fieldset className="block">
        <legend><span className="step">5</span> Directions / how to find it</legend>
        <textarea
          rows={4}
          maxLength={2000}
          value={directions}
          onChange={(e) => setDirections(e.target.value)}
          placeholder="e.g. From the car park, follow the stream path north for 300 m. Bench is behind the second fallen oak, facing the water."
        />
      </fieldset>

      {/* 6. Material */}
      <fieldset className="block">
        <legend><span className="step">6</span> Material</legend>
        <div className="chips wrap">
          {MATERIALS.map((m) => (
            <label key={m.value} className={`chip selectable ${material === m.value ? 'active' : ''}`}>
              <input type="radio" name="material" value={m.value} checked={material === m.value} onChange={() => setMaterial(m.value)} />
              {m.label}
            </label>
          ))}
        </div>
        <input
          className="mt"
          maxLength={120}
          value={materialNote}
          onChange={(e) => setMaterialNote(e.target.value)}
          placeholder="Custom material detail (optional) — e.g. reclaimed railway sleeper"
        />
      </fieldset>

      {/* 7. Notes */}
      <fieldset className="block">
        <legend><span className="step">7</span> More notes <em>optional</em></legend>
        <textarea
          rows={3}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything else? Views, condition, best time to visit, access notes…"
        />
      </fieldset>

      {errors.length > 0 && (
        <div className="error" role="alert">
          {errors.map((e) => (
            <div key={e}>• {e}</div>
          ))}
        </div>
      )}

      <div className="submit-bar">
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={!!duplicate}>
          {duplicate ? 'Duplicate location' : mode === 'edit' ? 'Save changes' : 'Save bench'}
        </button>
      </div>
    </form>
  );
}
