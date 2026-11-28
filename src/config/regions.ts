import type { CountryCode } from '../types';

export interface RegionConfig {
  country_code: CountryCode;
  name: string;
  /** [lng, lat] */
  center: [number, number];
  zoom: number;
  minZoom: number;
  /** [[west, south], [east, north]] — used for maxBounds and submission validation */
  bounds: [[number, number], [number, number]];
  currency: 'GBP';
  subscriptionPrice: string;
}

/**
- Region registry. v1 = GB only. To add a country in v2:
-  1. widen `CountryCode` in src/types.ts
-  2. add an entry here
-  3. seed/query benches by `country_code`
 */
export const REGIONS: Record<CountryCode, RegionConfig> = {
  GB: {
    country_code: 'GB',
    name: 'United Kingdom',
    center: [-3.3, 54.5],
    zoom: 5.1,
    minZoom: 3.5,
    bounds: [
      [-14.5, 48.8],
      [4.5, 61.5],
    ],
    currency: 'GBP',
    subscriptionPrice: '£4.99/mo',
  },
};

export const ACTIVE_COUNTRY: CountryCode =
  ((import.meta.env.VITE_COUNTRY_CODE as CountryCode | undefined) ?? 'GB') in REGIONS
    ? ((import.meta.env.VITE_COUNTRY_CODE as CountryCode | undefined) ?? 'GB')
    : 'GB';

export const ACTIVE_REGION = REGIONS[ACTIVE_COUNTRY];

export function isInsideRegion(lng: number, lat: number, region = ACTIVE_REGION): boolean {
  const [[w, s], [e, n]] = region.bounds;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}