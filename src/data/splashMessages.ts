import { readJSON, writeJSON } from '../utils/storage';

const RECENT_HISTORY_KEY = 'splash_recent_indices_v2';
const RECENT_HISTORY_LIMIT = 150;

const VERBS = [
  'Loading',
  'Checking',
  'Polishing',
  'Scouting',
  'Mapping',
  'Testing',
  'Counting',
  'Inspecting',
  'Hunting',
  'Measuring',
  'Tuning',
  'Auditing',
  'Warming up',
  'Spotting',
  'Calibrating',
  'Negotiating with',
  'Asking',
  'Dodging',
  'Aligning',
  'Verifying',
] as const;

const NOUNS_AND_JOKES = [
  'your benches...',
  'bench locations on Earth...',
  'wooden slats...',
  'shade spots...',
  'squirrels if this seat is taken...',
  'scenic UK viewpoints...',
  'armrest wobble...',
  'park pigeons...',
  'paths for splinters...',
  'harbour wind chill...',
  'tea-break posture...',
  'quiet corner seats...',
  'vintage iron bolts...',
  'main-character views...',
  'moss softness...',
  'puddle clearance...',
  'benches near bakeries...',
  'inner bench radar...',
  'pigeon drama levels...',
  'map pins with timber...',
  'sunny patches...',
  'dog-friendly spots...',
  'suspicious seagulls...',
  'calm canal seats...',
  'dramatic horizons...',
  'stray acorns...',
  'coffee spill safety...',
  'quiet park loops...',
  'river-bend seats...',
  'cloud-watching angles...',
  'seagulls eyeing your sandwich...',
] as const;

const EXTRA_QUIRKY_LINES: readonly string[] = [
  'Bribing a park swan with imaginary crusts...',
  'Checking if that bench is secretly a time machine...',
  'Making sure your legs get the VIP treatment...',
  'Looking for seats with zero leaf-blower noise...',
  'Testing how dramatic your sigh will sound here...',
  'Checking if the view beats a desktop wallpaper...',
  'Keeping one eye on the clouds and one on the map...',
  'Finding places where nobody rushes your tea...',
  'Checking if a bench has main-character energy...',
  'Sweeping stray leaves off prime seating...',
];

function buildMessagePool(): string[] {
  const seen = new Set<string>();
  const pool: string[] = [];

  for (const verb of VERBS) {
    for (const target of NOUNS_AND_JOKES) {
      const line = `${verb} ${target}`;
      if (!seen.has(line)) {
        seen.add(line);
        pool.push(line);
      }
    }
  }

  for (const line of EXTRA_QUIRKY_LINES) {
    if (!seen.has(line)) {
      seen.add(line);
      pool.push(line);
    }
  }

  return pool;
}

export const SPLASH_MESSAGE_POOL: readonly string[] = buildMessagePool();

/**
 * Picks `count` distinct short messages per app open while avoiding recently seen
 * messages across app closes/reopens so consecutive load-ins stay fresh.
 */
export function pickSessionSplashMessages(count = 7): string[] {
  const total = SPLASH_MESSAGE_POOL.length;
  const safeCount = Math.min(count, total);
  const recent = new Set<number>(readJSON<number[]>(RECENT_HISTORY_KEY, []));

  let candidates = Array.from({ length: total }, (_, idx) => idx).filter((idx) => !recent.has(idx));
  if (candidates.length < safeCount) {
    recent.clear();
    candidates = Array.from({ length: total }, (_, idx) => idx);
  }

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const chosenIndices = candidates.slice(0, safeCount);
  const updatedRecent = [...chosenIndices, ...recent].slice(0, RECENT_HISTORY_LIMIT);
  writeJSON(RECENT_HISTORY_KEY, updatedRecent);

  return chosenIndices.map((idx) => SPLASH_MESSAGE_POOL[idx]);
}