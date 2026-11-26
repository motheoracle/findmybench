import { useState, type FormEvent } from 'react';
import Modal from './Modal';
import { benchService } from '../lib/benchService';
import type { User } from '../types';

export default function AuthModal({
  reason,
  onClose,
  onSignedIn,
}: {
  reason: string;
  onClose(): void;
  onSignedIn(u: User): void;
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signin') {
        const u = await benchService.signInWithPassword(email, password);
        onSignedIn(u);
      } else {
        const res = await benchService.signUpWithPassword(email, password, name);
        if (res.user) {
          onSignedIn(res.user);
        } else if (res.needsConfirmation) {
          setNotice('Account created — check your email to confirm your address, then sign in.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={mode === 'signin' ? 'Sign in to FindMyBench' : 'Create your free account'} onClose={onClose}>
      <p className="muted">{reason}</p>
      <div className="row" style={{ gap: '0.5rem', marginBottom: '0.75rem' }}>
        <button
          type="button"
          className={`btn btn-sm ${mode === 'signin' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => { setMode('signin'); setError(null); setNotice(null); }}
        >
          Sign in
        </button>
        <button
          type="button"
          className={`btn btn-sm ${mode === 'signup' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => { setMode('signup'); setError(null); setNotice(null); }}
        >
          Create account
        </button>
      </div>
      <form onSubmit={submit} className="stack">
        {mode === 'signup' && (
          <label className="field">
            <span>Display name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="e.g. Sam"
            />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.co.uk"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            placeholder="At least 6 characters"
          />
        </label>
        {notice && <div className="muted">{notice}</div>}
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy
            ? mode === 'signin'
              ? 'Signing in…'
              : 'Creating account…'
            : mode === 'signin'
              ? 'Sign in'
              : 'Create account'}
        </button>
      </form>
    </Modal>
  );
}

