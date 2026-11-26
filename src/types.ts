export type CountryCode = 'GB';

export type Difficulty =
  | 'easy'
  | 'moderate'
  | 'tricky'
  | 'obscure'
  | 'hidden'
  | 'urban'
  | 'scenic'
  | 'transit'
  | 'historic';

export type Tier = Difficulty;

export type Material =
  | 'wood'
  | 'metal'
  | 'stone'
  | 'composite'
  | 'mixed'
  | 'Wood'
  | 'Metal / Cast Iron'
  | 'Stone / Concrete'
  | 'Composite / Plastic'
  | 'Mixed';

export type MapLayerMode = 'default' | 'satellite' | 'terrain';
export type Units = 'metric' | 'imperial';

export interface LngLat {
  lng: number;
  lat: number;
}

export interface UserPreferences {
  creditAnonymously: boolean;
  defaultLayer: MapLayerMode;
  units: Units;
}

export interface User {
  id: string;
  name: string;
  email: string;
  age?: number;
  avatar?: string;
  prefs: UserPreferences;
}

export interface PublicAuthor {
  id: string;
  name: string;
  age?: number;
  avatar?: string;
}

export interface Bench {
  id: string;
  country_code: CountryCode;
  region: string;
  name: string;
  lat: number;
  lng: number;
  difficulty: Difficulty;
  tier: Tier;
  material: Material;
  materialNote?: string;
  directions: string;
  notes?: string;
  photo?: string;
  createdBy?: PublicAuthor;
  createdAt: string;
  updatedAt?: string;
  source?: 'sample' | 'user';
}

export interface ViewBench {
  bench: Bench;
  locked: boolean;
  displayLat: number;
  displayLng: number;
}

export type ViewableBench = ViewBench;

export type BenchEditable = Pick<
  Bench,
  'name' | 'difficulty' | 'material' | 'materialNote' | 'directions' | 'notes' | 'photo' | 'lat' | 'lng'
>;

export interface NearbyMatch {
  bench: Bench;
  distanceM: number;
}

export interface DraftLocation extends LngLat {
  accuracyM?: number;
}

export type ModerationStatus = 'visible' | 'flagged' | 'hidden';
export type ReportReason = 'spam' | 'offensive' | 'inaccurate' | 'off-topic' | 'inappropriate' | 'privacy' | 'other';

export interface UserReport {
  userId: string;
  reason: ReportReason;
  createdAt?: string;
  at?: string;
}

export type Rating = 1 | 2 | 3 | 4 | 5;

export interface Review {
  id: string;
  benchId: string;
  author: PublicAuthor;
  body: string;
  rating?: Rating;
  createdAt: string;
  updatedAt?: string;
  status: ModerationStatus;
  reports: UserReport[];
}

export type PhotoTag = 'bench-view' | 'pov' | 'nearby';

export interface GalleryPhoto {
  id: string;
  benchId: string;
  author: PublicAuthor;
  src: string;
  tag: PhotoTag;
  caption: string;
  width: number;
  height: number;
  bytes: number;
  contentHash: string;
  createdAt: string;
  status: ModerationStatus;
  reports: UserReport[];
}
