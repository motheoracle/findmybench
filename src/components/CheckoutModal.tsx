import { useState } from 'react';
import Modal from './Modal';
import { ACTIVE_REGION } from '../config/regions';

export interface CheckoutModalProps {
  checkoutUrl?: string | null;
  onRefresh: () => void;
  onClose: () => void;
}

export default function CheckoutModal({ checkoutUrl, onRefresh, onClose }: CheckoutModalProps) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Modal title="FindMyBench Explorer" onClose={onClose}>
      <div className="checkout">
        <div className="checkout-price">
          {ACTIVE_REGION.subscriptionPrice.replace('/mo', '')}
          <small>/month</small>
        </div>
        <ul className="paywall-list">
          <li>All historic, tricky &amp; obscure benches, with exact pins</li>
          <li>Full directions, photos and finder notes</li>
          <li>Support the people logging benches across the UK</li>
        </ul>
        {checkoutUrl ? (
          <a
            className="btn btn-amber btn-block"
            href={checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Continue to checkout
          </a>
        ) : (
          <div className="demo-note">
            <strong>Checkout link unavailable.</strong> Check your billing configuration or refresh once complete.
          </div>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing status...' : 'Refresh subscription status'}
        </button>
      </div>
    </Modal>
  );
}