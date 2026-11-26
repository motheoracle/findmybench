import Modal from './Modal';
import { ACTIVE_REGION } from '../config/regions';

export default function CheckoutModal({ onClose, onActivate }: { onClose(): void; onActivate(): void }) {
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
        <div className="demo-note">
          <strong>Demo checkout.</strong> No payment is taken in this prototype. In production this hands off to
          App Store / Google Play billing (native) or Stripe (web), e.g. via RevenueCat.
        </div>
        <button className="btn btn-amber btn-block" onClick={onActivate}>
          Activate demo subscription
        </button>
        <button className="btn btn-ghost btn-block" onClick={onClose}>
          Not now
        </button>
      </div>
    </Modal>
  );
}
