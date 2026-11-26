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
];

export interface MaterialOption {
  value: Material;
  label: string;
}

export const MATERIALS: MaterialOption[] = [
  { value: 'Wood', label: 'Wood' },
  { value: 'Metal / Cast Iron', label: 'Metal / Cast Iron' },
  { value: 'Stone / Concrete', label: 'Stone / Concrete' },
  { value: 'Composite / Plastic', label: 'Composite / Plastic' },
  { value: 'Mixed', label: 'Mixed' },
];

export function tierForDifficulty(d: Difficulty): Tier {
  return d;
}

export function isPaidTier(d: Difficulty): boolean {
  return d === 'tricky' || d === 'hidden';
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
    default:
      return 'Standard / Urban';
  }
}

export function materialLabel(m: Material): string {
  switch (m) {
    case 'wood':
      return 'Wood';
    case 'metal':
      return 'Metal / Cast Iron';
    case 'stone':
      return 'Stone / Concrete';
    case 'composite':
      return 'Composite / Plastic';
    case 'mixed':
      return 'Mixed';
    default:
      return m;
  }
}