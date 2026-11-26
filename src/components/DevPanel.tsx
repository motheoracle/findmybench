import { useState } from 'react';
import type { User } from '../types';

export default function DevPanel({
  subscribed,
  onToggleSubscribed,
  user,
  onQuickSignIn,
  onSignOut,
  onResetBenches,
  mapStatus,
  moderationCount,
  onOpenModeration,
}: {
  subscribed: boolean;
  onToggleSubscribed(v: boolean): void;
  user: User | null;
  onQuickSignIn(): void;
  onSignOut(): void;
  onResetBenches(): void;
  mapStatus: string;
  moderationCount: number;
  onOpenModeration(): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`dev-panel ${open ? 'open' : ''}`}>
      <button className="dev-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        DEV {subscribed ? '· 🔓' : '· 🔒'}
      </button>
      {open && (
        <div className="dev-body">
          <label className="switch-row">
            <span>
              <strong>Subscription</strong>
              <small>{subscribed ? 'Obscure benches unlocked' : 'Obscure benches locked'}</small>
            </span>
            <input type="checkbox" checked={subscribed} onChange={(e) => onToggleSubscribed(e.target.checked)} />
          </label>
          <div className="switch-row">
            <span>
              <strong>Account</strong>
              <small>{user ? `${user.name} (${user.email})` : 'Signed out'}</small>
            </span>
            {user ? (
              <button className="btn btn-sm btn-outline" onClick={onSignOut}>Sign out</button>
            ) : (
              <button className="btn btn-sm btn-outline" onClick={onQuickSignIn}>Demo sign-in</button>
            )}
          </div>
          <div className="switch-row">
            <span>
              <strong>Local data</strong>
              <small>Remove logged benches, reviews &amp; photos</small>
            </span>
            <button className="btn btn-sm btn-outline" onClick={onResetBenches}>Reset</button>
          </div>
          <div className="switch-row">
            <span>
              <strong>Moderation</strong>
              <small>{moderationCount} flagged / hidden item{moderationCount === 1 ? '' : 's'}</small>
            </span>
            <button className="btn btn-sm btn-outline" onClick={onOpenModeration}>Open</button>
          </div>
          <div className="dev-meta">Map: {mapStatus} · Region: GB</div>
        </div>
      )}
    </div>
  );
}
