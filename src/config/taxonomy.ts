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
    value: 'urban',
    label: 'Standard / Urban',
    shortLabel: 'Urban',
    desc: 'Town centres, high streets, bus stops & public parks. High footfall.',
    isPaid: false,
  },
  {
    value: 'scenic',
    label: 'Scenic / Viewpoint',
    shortLabel: 'Scenic',
    desc: 'Promenades, harbour walls & hilltops with clear open vistas.',
    isPaid: false,
  },
  {
    value: 'transit',
    label: 'Rest & Transit',
    shortLabel: 'Transit',
    desc: 'Canal towpaths, trailside rests & park walking loop seats.',
    isPaid: false,
  },
  {
    value: 'historic',
    label: 'Memorial & Historic',
    shortLabel: 'Historic',
    desc: 'Heritage benches, antique carved seats & commemorative spots.',
    isPaid: true,
  },
  {
    value: 'tricky',
    label: 'Tricky / Off-Trail',
    shortLabel: 'Tricky',
    desc: 'Faint paths, unpaved woodland tracks & steep hillsides.',
    isPaid: true,
  },
  {
    value: 'obscure',
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
  { value: 'urban', label: 'Standard / Urban', hint: 'Town centres, parks & high-footfall spots.' },
  { value: 'scenic', label: 'Scenic / Viewpoint', hint: 'Coastal walls, hilltops & open vistas.' },
  { value: 'transit', label: 'Rest & Transit', hint: 'Towpaths & trailside resting points.' },
  { value: 'historic', label: 'Memorial & Historic', hint: 'Heritage seats & carved memorial benches.' },
  { value: 'tricky', label: 'Tricky / Off-Trail', hint: 'Unpaved tracks & steep woodland paths.' },
  { value: 'obscure', label: 'Obscure & Hidden', hint: 'Secret clearings & overgrown spots.' },
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
  return d === 'historic' || d === 'tricky' || d === 'obscure' || d === 'hidden';
}

export function difficultyLabel(d: Difficulty): string {
  switch (d) {
    case 'urban':
    case 'easy':
      return 'Standard / Urban';
    case 'scenic':
      return 'Scenic / Viewpoint';
    case 'transit':
    case 'moderate':
      return 'Rest & Transit';
    case 'historic':
      return 'Memorial & Historic';
    case 'tricky':
      return 'Tricky / Off-Trail';
    case 'obscure':
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
