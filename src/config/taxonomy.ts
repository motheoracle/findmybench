import type { Difficulty, Material, Tier } from '../types';

export interface TaxonomyItem {
  value: Difficulty;
  label: string;
  shortLabel: string;
  desc: string;
  isPaid: boolean;
}

export const TAXONOMY: TaxonomyItem[] = [
  {
    value: 'easy',
    label: 'Standard / Urban',
    shortLabel: 'Urban',
    desc: 'Town centres, high streets, bus stops & public parks. High footfall.',
    isPaid: false,
  },
  {
    value: 'moderate',
    label: 'Scenic / Viewpoint',
    shortLabel: 'Scenic',
    desc: 'Promenades, harbour walls & hilltops with clear open vistas.',
    isPaid: false,
  },
  {
    value: 'tricky',
    label: 'Tricky / Off-Trail',
    shortLabel: 'Tricky',
    desc: 'Faint paths, unpaved woodland tracks & steep hillsides.',
    isPaid: true,
  },
  {
    value: 'hidden',
    label: 'Obscure & Hidden',
    shortLabel: 'Obscure',
    desc: 'Tucked away in lost inclosures, behind ruins or secret clearings.',
    isPaid: true,
  },
  {
    value: 'historic',
    label: 'Historic / Heritage',
    shortLabel: 'Historic',
    desc: 'Historic landmarks, heritage sites & notable old benches.',
    isPaid: true,
  },
];

export interface DifficultyOption {
  value: Difficulty;
  label: string;
  hint: string;
}

export const DIFFICULTIES: DifficultyOption[] = [
  { value: 'easy', label: 'Standard / Urban', hint: 'Town centres, parks & high-footfall spots.' },
  { value: 'moderate', label: 'Scenic / Viewpoint', hint: 'Coastal walls, hilltops & open vistas.' },
  { value: 'tricky', label: 'Tricky / Off-Trail', hint: 'Unpaved tracks & steep woodland paths.' },
  { value: 'hidden', label: 'Obscure & Hidden', hint: 'Secret clearings & overgrown spots.' },
  { value: 'historic', label: 'Historic / Heritage', hint: 'Heritage sites & notable old benches.' },
];

export interface MaterialOption {
  value: Material;
  label: string;
}

export const MATERIALS: MaterialOption[] = [
  { value: 'wood', label: 'Wood' },
  { value: 'metal', label: 'Metal / Cast Iron' },
  { value: 'stone', label: 'Stone / Concrete' },
  { value: 'composite', label: 'Composite / Plastic' },
  { value: 'mixed', label: 'Mixed' },
];

export function tierForDifficulty(d: Difficulty): Tier {
  return d;
}

export function isPaidTier(d: Difficulty): boolean {
  return d === 'tricky' || d === 'hidden' || d === 'historic';
}

export function difficultyLabel(d: Difficulty): string {
  switch (d) {
    case 'easy':
      return 'Standard / Urban';
    case 'moderate':
      return 'Scenic / Viewpoint';
    case 'tricky':
      return 'Tricky / Off-Trail';
    case 'hidden':
      return 'Obscure & Hidden';
    case 'historic':
      return 'Historic / Heritage';
    default:
      return 'Standard / Urban';
  }
}

export function materialLabel(m: Material): string {
  switch (m) {
    case 'wood':
    case 'Wood':
      return 'Wood';
    case 'metal':
    case 'Metal / Cast Iron':
      return 'Metal / Cast Iron';
    case 'stone':
    case 'Stone / Concrete':
      return 'Stone / Concrete';
    case 'composite':
    case 'Composite / Plastic':
      return 'Composite / Plastic';
    case 'mixed':
    case 'Mixed':
      return 'Mixed';
    default:
      return m;
  }
}