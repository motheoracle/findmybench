import { readJSON, writeJSON } from '../utils/storage';

export interface EntitlementService {
  isObscureUnlocked(): boolean;
  setObscureUnlocked(active: boolean): void;
  setActiveUser(userId: string | null): void;
  onChange(cb: (active: boolean) => void): () => void;
}

class MockEntitlementService implements EntitlementService {
  private currentUserId: string | null = null;
  private active = false;
  private listeners = new Set<(a: boolean) => void>();

  private keyForUser(userId: string | null): string {
    return userId ? `subscription.obscure.${userId}` : 'subscription.obscure.guest';
  }

  setActiveUser(userId: string | null) {
    this.currentUserId = userId;
    const next = userId ? readJSON<boolean>(this.keyForUser(userId), false) : false;
    if (next !== this.active) {
      this.active = next;
      this.listeners.forEach((l) => l(this.active));
    }
  }

  isObscureUnlocked() {
    return this.active;
  }

  setObscureUnlocked(active: boolean) {
    this.active = active;
    if (this.currentUserId) {
      writeJSON(this.keyForUser(this.currentUserId), active);
    }
    this.listeners.forEach((l) => l(active));
  }

  onChange(cb: (active: boolean) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

export const entitlements: EntitlementService = new MockEntitlementService();

export const DEV_TOOLS_ENABLED: boolean =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_TOOLS === 'true';
