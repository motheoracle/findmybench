import { useEffect, useState, type ChangeEvent } from 'react';
import Modal from './Modal';
import type { MapLayerMode, ThemeMode, Units, User, UserPreferences } from '../types';
import { LAYER_MODES } from '../config/mapStyles';
import { ANONYMOUS_NAME } from '../config/community';
import { validateDisplayName } from '../lib/benchService';
import { openManageSubscription } from '../lib/billingPortal';

function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export default function AccountSettingsModal({
  user,
  subscribed,
  onClose,
  onSave,
}: {
  user: User;
  subscribed: boolean;
  onClose(): void;
  onSave(patch: { name: string; age?: number; avatar?: string; prefs: UserPreferences }): Promise<string | null>;
}) {
  const [name, setName] = useState(user.name);
  const [age, setAge] = useState<string>(user.age ? String(user.age) : '');
  const [avatar, setAvatar] = useState<string>(user.avatar ?? '');
  const [prefs, setPrefs] = useState<UserPreferences>({
    ...user.prefs,
    theme: user.prefs.theme ?? 'light',
  });
  const [revealEmail, setRevealEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [managingSubscription, setManagingSubscription] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    const activeTheme: ThemeMode = prefs.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', activeTheme);
    document.documentElement.classList.toggle('dark', activeTheme === 'dark');
  }, [prefs.theme]);

  const cleanAge = age ? parseInt(age, 10) : undefined;
  const ageDisplay = cleanAge ? `, ${cleanAge}` : '';
  const publicName = prefs.creditAnonymously
    ? ANONYMOUS_NAME
    : `${name.trim() || 'Explorer'}${ageDisplay}`;

  const handleAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Profile picture must be smaller than 5MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAvatar(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleManageSubscription = async () => {
    setPortalError(null);
    setManagingSubscription(true);
    try {
      await openManageSubscription();
    } catch (err) {
      setPortalError(
        err instanceof Error ? err.message : 'Unable to open subscription portal.'
      );
      setManagingSubscription(false);
    }
  };

  const save = async () => {
    const err = validateDisplayName(name);
    if (err) return setError(err);
    if (cleanAge !== undefined && (cleanAge < 13 || cleanAge > 120)) {
      return setError('Age must be between 13 and 120.');
    }
    setBusy(true);
    setError(await onSave({ name: name.trim(), age: cleanAge, avatar, prefs }));
    setBusy(false);
  };

  return (
    <Modal title="Account Settings" onClose={onClose}>
      <div className="stack">
        <section className="settings-group">
          <h3>Public profile</h3>
          <div className="row" style={{ gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: '#e0e0e0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                fontWeight: 'bold',
                fontSize: '1.25rem',
              }}
            >
              {avatar ? (
                <img src={avatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                name.slice(0, 1).toUpperCase()
              )}
            </div>
            <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
              <span>Upload picture</span>
              <input type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: 'none' }} />
            </label>
          </div>

          <label className="field">
            <span>Display name</span>
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
          </label>

          <label className="field">
            <span>Age (optional)</span>
            <input
              type="number"
              min={13}
              max={120}
              value={age}
              placeholder="e.g. 30"
              onChange={(e) => setAge(e.target.value)}
            />
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={prefs.creditAnonymously}
              onChange={(e) => setPrefs({ ...prefs, creditAnonymously: e.target.checked })}
            />
            <span>Post anonymously - show "{ANONYMOUS_NAME}" on my benches, reviews and photos</span>
          </label>
          <div className="preview-chip">
            Others see you as: <strong>{publicName}</strong>
          </div>
        </section>

        <section className="settings-group">
          <h3>Preferences</h3>
          <label className="field">
            <span>Appearance</span>
            <select
              value={prefs.theme ?? 'light'}
              onChange={(e) => setPrefs({ ...prefs, theme: e.target.value as ThemeMode })}
            >
              <option value="light">Light mode</option>
              <option value="dark">Dark mode</option>
            </select>
          </label>
          <label className="field">
            <span>Map layer on launch <em className="muted">(all layers free)</em></span>
            <select
              value={prefs.defaultLayer}
              onChange={(e) => setPrefs({ ...prefs, defaultLayer: e.target.value as MapLayerMode })}
            >
              {LAYER_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Distance units</span>
            <select
              value={prefs.units}
              onChange={(e) => setPrefs({ ...prefs, units: e.target.value as Units })}
            >
              <option value="metric">Metric (m, km)</option>
              <option value="imperial">Imperial (ft, mi)</option>
            </select>
          </label>
        </section>

        <section className="settings-group private">
          <h3>Private account details</h3>
          <p className="fine">Only you can see these. They are never shown publicly.</p>
          <div className="kv">
            <span>Email</span>
            <span className="mono">
              {revealEmail ? user.email : maskEmail(user.email)}{' '}
              <button className="link-btn" onClick={() => setRevealEmail((r) => !r)}>
                {revealEmail ? 'Hide' : 'Show'}
              </button>
            </span>
          </div>
          <div className="kv">
            <span>Plan</span>
            <span>{subscribed ? 'Explorer - obscure & tricky unlocked' : 'Free'}</span>
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={handleManageSubscription}
              disabled={managingSubscription || busy}
            >
              {managingSubscription ? 'Opening Portal...' : 'Manage Subscription'}
            </button>
            {portalError && (
              <div className="error" role="alert" style={{ marginTop: '0.5rem' }}>
                {portalError}
              </div>
            )}
          </div>
        </section>

        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
          {busy ? 'Saving...' : 'Save settings'}
        </button>
      </div>
    </Modal>
  );
}