import type { LngLat } from '../types';

export interface RouteResult {
  coords: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  mode: 'walking-path' | 'straight-fallback';
}

export function haversineMeters(a: LngLat, b: LngLat): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export async function fetchWalkingRoute(
  origin: LngLat,
  target: LngLat,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const url =
    `https://router.project-osrm.org/route/v1/foot/` +
    `${origin.lng},${origin.lat};${target.lng},${target.lat}` +
    `?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Routing failed (${res.status})`);
    const data = (await res.json()) as {
      code?: string;
      routes?: Array<{
        distance?: number;
        duration?: number;
        geometry?: { coordinates?: [number, number][] };
      }>;
    };

    const route = data.routes?.[0];
    const lineCoords = route?.geometry?.coordinates;
    if (route && data.code === 'Ok' && Array.isArray(lineCoords) && lineCoords.length >= 2) {
      return {
        coords: lineCoords,
        distanceMeters: typeof route.distance === 'number' ? route.distance : haversineMeters(origin, target),
        durationSeconds:
          typeof route.duration === 'number'
            ? route.duration
            : haversineMeters(origin, target) / 1.35,
        mode: 'walking-path',
      };
    }
  } catch {
    // Fall back to direct line if routing service is offline/unreachable
  }

  const dist = haversineMeters(origin, target);
  return {
    coords: [
      [origin.lng, origin.lat],
      [target.lng, target.lat],
    ],
    distanceMeters: dist,
    durationSeconds: dist / 1.35,
    mode: 'straight-fallback',
  };
}