import { ACTIVE_REGION } from '../config/regions';

export default function PaywallCard({
  onUnlock,
  obscureCount,
  compact = false,
}: {
  onUnlock(): void;
  obscureCount?: number;
  compact?: boolean;
}) {
  return (
    <div className={`paywall ${compact ? 'compact' : ''}`}>
      <div className="paywall-head">
        <span className="lock-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V7Z" /></svg>
        </span>
        <div>
          <div className="paywall-price">{ACTIVE_REGION.subscriptionPrice}</div>
          <div className="paywall-title">Unlock Obscure Benches</div>
        </div>
      </div>
      {!compact && (
        <ul className="paywall-list">
          <li>Exact pins &amp; step-by-step directions for off-trail and hidden benches{obscureCount ? ` (${obscureCount} in the UK so far)` : ''}</li>
          <li>Photos and finder notes from the community</li>
          <li>Map, Satellite &amp; Terrain stay free for everyone</li>
        </ul>
      )}
      <button className="btn btn-amber btn-block" onClick={onUnlock}>
        {ACTIVE_REGION.subscriptionPrice} — Unlock Obscure Benches
      </button>
      {!compact && <p className="fine">Cancel anytime. Demo build: no payment is taken.</p>}
    </div>
  );
}
