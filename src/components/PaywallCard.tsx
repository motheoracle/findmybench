import { useState } from 'react';
import { ACTIVE_REGION } from '../config/regions';
import { openManageSubscription } from '../lib/billingPortal';

export default function PaywallCard({
  onUnlock,
  compact = false,
}: {
  onUnlock(): void;
  obscureCount?: number;
  compact?: boolean;
}) {
  const [managingSubscription, setManagingSubscription] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

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

  return (
    <div className={`paywall ${compact ? 'compact' : ''}`}>
      <div className="paywall-head">
        <span className="lock-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-6 0V7a2 2 0 1 1 4 0v2h-4Z"/></svg>
        </span>
        <div>
          <div className="paywall-price">{ACTIVE_REGION.subscriptionPrice}</div>
          <div className="paywall-title" style={{ color: '#ffffff' }}>Unlock Pro Features</div>
        </div>
      </div>
      {!compact && (
        <ul className="paywall-list">
          <li>Exact pins &amp; step-by-step directions for off-trail and pro benches</li>
          <li>Photos and finder notes from the community</li>
          <li>Map, Satellite &amp; Terrain stay free for everyone</li>
        </ul>
      )}
      <button className="btn btn-amber btn-block" onClick={onUnlock}>
        Pay Now
      </button>

      <div style={{ marginTop: '0.75rem', textAlign: 'center' }}>
        <button
          type="button"
          onClick={handleManageSubscription}
          disabled={managingSubscription}
          style={{
            background: 'none',
            border: 'none',
            color: '#fcd34d',
            textDecoration: 'underline',
            fontSize: '0.8rem',
            cursor: 'pointer',
            opacity: managingSubscription ? 0.6 : 1,
          }}
        >
          {managingSubscription ? 'Opening Portal...' : 'Already subscribed? Manage Subscription'}
        </button>
        {portalError && (
          <div className="error" role="alert" style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
            {portalError}
          </div>
        )}
      </div>
    </div>
  );
}