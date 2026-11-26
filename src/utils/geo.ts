import type { Bench, LngLat, Units, User, ViewBench } from '../types';

/** Deterministic hash → [0,1) so a locked bench's approximate pin doesn't jump around. */
function hash01(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Offset a locked bench by ~1–2 km so the pin shows the *area* only.
 * NOTE: client-side fuzzing is a UX affordance, not security. When the API moves to
 * Supabase, exact coordinates/directions for obscure benches must only be returned
 * to entitled users (RLS / edge function). See supabase/schema.sql.
 */
export function fuzz(bench: Bench): { lat: number; lng: number } {
  const angle = hash01(bench.id, 1) * Math.PI * 2;
  const distKm = 1 + hash01(bench.id, 2); // 1–2 km
  const dLat = (distKm / 111) * Math.sin(angle);
  const dLng = (distKm / (111 * Math.cos((bench.lat * Math.PI) / 180))) * Math.cos(angle);
  return { lat: bench.lat + dLat, lng: bench.lng + dLng };
}

export const isOwner = (bench: Bench, user: User | null) => !!user && bench.createdBy?.id === user.id;

export function toViewBench(bench: Bench, opts: { subscribed: boolean; user: User | null }): ViewBench {
  const locked = bench.tier === 'obscure' && !opts.subscribed && !isOwner(bench, opts.user);
  if (!locked) return { bench, locked, displayLat: bench.lat, displayLng: bench.lng };
  const f = fuzz(bench);
  return { bench, locked, displayLat: f.lat, displayLng: f.lng };
}

/** Great-circle distance in metres (haversine). Accurate to well under a metre at bench scales. */
export function distanceM(a: LngLat, b: LngLat): number {
  const R = 6_371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(m: number, units: Units = 'metric'): string {
  if (units === 'imperial') {
    const ft = m * 3.28084;
    return ft < 1000 ? `${Math.round(ft)} ft` : `${(m / 1609.344).toFixed(1)} mi`;
  }
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** 6 decimal places ≈ 0.1 m — enough precision for a single bench. */
export function formatCoord(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

/** Normalise to 6 dp so stored coordinates are stable and comparable. */
export const roundCoord = (v: number) => Math.round(v * 1e6) / 1e6;

export function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
