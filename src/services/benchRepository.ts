import type { Bench, BenchEditable, CountryCode, LngLat, NearbyMatch } from '../types';
import { SAMPLE_BENCHES } from '../data/sampleBenches';
import { tierForDifficulty } from '../config/taxonomy';
import { DUPLICATE_RADIUS_M } from '../config/community';
import { distanceM, roundCoord } from '../utils/geo';
import { readJSON, uid, writeJSON } from '../utils/storage';

export type NewBenchInput = Omit<Bench, 'id' | 'createdAt' | 'updatedAt' | 'source'>;

export class DuplicateBenchError extends Error {
  constructor(public match: NearbyMatch) {
    super(`A bench is already logged ${Math.round(match.distanceM)} m from this spot.`);
  }
}

/**
 * Bench data contract. v1 = sample seed + user submissions in localStorage.
 * v2: SupabaseBenchRepository —
 *  - `list`: select by country_code (RLS hides exact coords of obscure rows from non-subscribers)
 *  - `add`/`update`: insert/update with RLS `created_by = auth.uid()`
 *  - `findNearby`: a PostGIS RPC (`ST_DWithin(geog, point, radius)`) that returns only
 *    `{ id, distance_m }` so the duplicate check can't be used to probe exact locations
 *    of locked benches. Enforce the duplicate rule in the RPC/trigger too, not just the client.
 */
export interface BenchRepository {
  list(country: CountryCode): Bench[];
  get(id: string): Bench | undefined;
  add(input: NewBenchInput): Bench;
  update(id: string, patch: BenchEditable, actorId: string): Bench;
  findNearby(p: LngLat, opts?: { radiusM?: number; excludeId?: string; country?: CountryCode }): NearbyMatch | null;
  renameAuthor(authorId: string, name: string): void;
  clearUserBenches(): void;
}

const KEY = 'benches.user.v1';

class LocalBenchRepository implements BenchRepository {
  private userBenches(): Bench[] {
    return readJSON<Bench[]>(KEY, []);
  }

  list(country: CountryCode): Bench[] {
    return [...SAMPLE_BENCHES, ...this.userBenches()].filter((b) => b.country_code === country);
  }

  get(id: string) {
    return SAMPLE_BENCHES.find((b) => b.id === id) ?? this.userBenches().find((b) => b.id === id);
  }

  findNearby(p: LngLat, opts: { radiusM?: number; excludeId?: string; country?: CountryCode } = {}) {
    const radius = opts.radiusM ?? DUPLICATE_RADIUS_M;
    let best: NearbyMatch | null = null;
    for (const b of this.list(opts.country ?? 'GB')) {
      if (b.id === opts.excludeId) continue;
      const d = distanceM(p, b);
      if (d <= radius && (!best || d < best.distanceM)) best = { bench: b, distanceM: d };
    }
    return best;
  }

  add(input: NewBenchInput): Bench {
    const dup = this.findNearby(input, { country: input.country_code });
    if (dup) throw new DuplicateBenchError(dup);
    const bench: Bench = {
      ...input,
      lat: roundCoord(input.lat),
      lng: roundCoord(input.lng),
      tier: tierForDifficulty(input.difficulty),
      id: uid('bench'),
      createdAt: new Date().toISOString(),
      source: 'user',
    };
    writeJSON(KEY, [...this.userBenches(), bench]); // throws a friendly error if storage is full
    return bench;
  }

  update(id: string, patch: BenchEditable, actorId: string): Bench {
    const all = this.userBenches();
    const idx = all.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error('That bench could not be found (sample benches cannot be edited).');
    const current = all[idx];
    if (current.createdBy?.id !== actorId) throw new Error('You can only edit benches you logged.');
    const dup = this.findNearby(patch, { excludeId: id, country: current.country_code });
    if (dup) throw new DuplicateBenchError(dup);
    const next: Bench = {
      ...current,
      ...patch,
      lat: roundCoord(patch.lat),
      lng: roundCoord(patch.lng),
      tier: tierForDifficulty(patch.difficulty),
      updatedAt: new Date().toISOString(),
    };
    all[idx] = next;
    writeJSON(KEY, all);
    return next;
  }

  renameAuthor(authorId: string, name: string) {
    const all = this.userBenches();
    let changed = false;
    for (const b of all) {
      if (b.createdBy?.id === authorId && b.createdBy.name !== name) {
        b.createdBy = { id: authorId, name };
        changed = true;
      }
    }
    if (changed) writeJSON(KEY, all);
  }

  clearUserBenches() {
    writeJSON(KEY, null);
  }
}

export const benchRepo: BenchRepository = new LocalBenchRepository();
