import type { PublicAuthor, User, UserPreferences } from '../types';
import { ANONYMOUS_NAME, DEFAULT_PREFS } from '../config/community';
import { readJSON, uid, writeJSON } from '../utils/storage';

/**
 * Auth contract. v1 uses MockAuthService (localStorage).
 * v2: implement SupabaseAuthService with the same shape
 * (supabase.auth.signInWithOtp / onAuthStateChange, `profiles` table for name + prefs)
 * and swap the export below.
 */
export interface AuthService {
  getUser(): User | null;
  signIn(input: { name: string; email: string }): Promise<User>;
  signOut(): Promise<void>;
  updateProfile(patch: { name?: string; prefs?: Partial<UserPreferences> }): Promise<User>;
  onChange(cb: (user: User | null) => void): () => void;
}

/** What other people see. Never includes email, auth or billing identifiers. */
export function publicAuthor(user: User): PublicAuthor {
  return { id: user.id, name: user.prefs.creditAnonymously ? ANONYMOUS_NAME : user.name };
}

type StoredProfile = { name: string; prefs: UserPreferences };

export function validateDisplayName(name: string): string | null {
  const n = name.trim();
  if (n.length < 2) return 'Display name must be at least 2 characters.';
  if (n.length > 40) return 'Display name must be 40 characters or fewer.';
  if (/@/.test(n)) return "Please don't use an email address as your display name.";
  if (/https?:\/\/|www\./i.test(n)) return 'Display names cannot contain links.';
  return null;
}

class MockAuthService implements AuthService {
  private user: User | null = this.normalise(readJSON<Partial<User> | null>('user', null));
  private listeners = new Set<(u: User | null) => void>();

  private normalise(u: Partial<User> | null): User | null {
    if (!u?.id || !u.email || !u.name) return null;
    return { id: u.id, email: u.email, name: u.name, prefs: { ...DEFAULT_PREFS, ...(u.prefs ?? {}) } };
  }

  getUser() {
    return this.user;
  }

  async signIn({ name, email }: { name: string; email: string }) {
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('Please enter a valid email address.');
    const nameErr = validateDisplayName(name);
    if (nameErr) throw new Error(nameErr);
    // Stable id per email so a returning user keeps ownership of their benches.
    const ids = readJSON<Record<string, string>>('userIds', {});
    const id = ids[cleanEmail] ?? uid('user');
    writeJSON('userIds', { ...ids, [cleanEmail]: id });
    const profiles = readJSON<Record<string, StoredProfile>>('profiles', {});
    const prefs = { ...DEFAULT_PREFS, ...(profiles[id]?.prefs ?? {}) };
    this.user = { id, name: name.trim(), email: cleanEmail, prefs };
    this.persist();
    return this.user;
  }

  async signOut() {
    this.user = null;
    writeJSON('user', null);
    this.emit();
  }

  async updateProfile(patch: { name?: string; prefs?: Partial<UserPreferences> }) {
    if (!this.user) throw new Error('Not signed in.');
    if (patch.name !== undefined) {
      const err = validateDisplayName(patch.name);
      if (err) throw new Error(err);
    }
    this.user = {
      ...this.user,
      name: patch.name?.trim() ?? this.user.name,
      prefs: { ...this.user.prefs, ...(patch.prefs ?? {}) },
    };
    this.persist();
    return this.user;
  }

  onChange(cb: (u: User | null) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private persist() {
    if (!this.user) return;
    writeJSON('user', this.user);
    const profiles = readJSON<Record<string, StoredProfile>>('profiles', {});
    writeJSON('profiles', { ...profiles, [this.user.id]: { name: this.user.name, prefs: this.user.prefs } });
    this.emit();
  }

  private emit() {
    this.listeners.forEach((l) => l(this.user));
  }
}

export const authService: AuthService = new MockAuthService();
