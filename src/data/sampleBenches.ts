import type { Bench, CountryCode, Difficulty, Material } from '../types';
import { tierForDifficulty } from '../config/taxonomy';

type Seed = {
  id: string;
  name: string;
  region: string;
  country_code: CountryCode;
  lat: number;
  lng: number;
  difficulty: Difficulty;
  material: Material;
  materialNote?: string;
  directions: string;
  notes?: string;
};

const SEEDS: Seed[] = [
  {
    id: 'b-kew',
    name: 'South Promenade River Bench',
    region: 'Richmond upon Thames, London',
    country_code: 'GB',
    lat: 51.4718,
    lng: -0.3086,
    difficulty: 'urban',
    material: 'Wood',
    directions: 'Follow the Thames Path south from Richmond Bridge for six minutes along the river wall.',
    notes: 'Busy at sunset - arrive early for the view over the river.',
  },
  {
    id: 'b-edinburgh',
    name: 'Calton Hill West Crag Bench',
    region: 'Edinburgh, Scotland',
    country_code: 'GB',
    lat: 55.9554,
    lng: -3.1828,
    difficulty: 'scenic',
    material: 'stone',
    directions: 'Climb the steps from Waterloo Place and take the grassy path curving toward the west edge.',
  },
  {
    id: 'b-bristol',
    name: 'Clifton Gorge Overlook Bench',
    region: 'Bristol, South West',
    country_code: 'GB',
    lat: 51.4557,
    lng: -2.6279,
    difficulty: 'transit',
    material: 'Metal / Cast Iron',
    materialNote: 'painted green',
    directions: 'Walk past the observatory car park toward the Avon Gorge rim path.',
  },
  {
    id: 'b-snowdon',
    name: 'Cwm Idwal Back Wall Bench',
    region: 'Eryri (Snowdonia), Gwynedd',
    country_code: 'GB',
    lat: 53.1066,
    lng: -4.0177,
    difficulty: 'tricky',
    material: 'stone',
    directions: 'Take the footpath past Llyn Idwal and continue toward the rocky amphitheatre below Twll Du.',
  },
  {
    id: 'b-kielder',
    name: 'Kielder Larch Ride Bench',
    region: 'Kielder Forest, Northumberland',
    country_code: 'GB',
    lat: 55.2345,
    lng: -2.5782,
    difficulty: 'obscure',
    material: 'Wood',
    directions: 'From Kielder Castle take the forest road north then the second unmarked ride on the left. Bench faces west over a clear-felled valley - great for dark-sky watching.',
    notes: 'Exposed - windy most days.',
  },
];

export const SAMPLE_BENCHES: Bench[] = SEEDS.map((s) => ({
  ...s,
  tier: tierForDifficulty(s.difficulty),
  source: 'sample',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
}));
