import { useSyncExternalStore } from 'react';
import type { Gate } from '@/mock/netlist';

export type LevelId = 'not' | 'and' | 'or' | 'nor' | 'xor' | 'xnor' | 'mux' | 'half' | 'maj' | 'full';
export type World = 'basics' | 'combine' | 'build';

export interface Level {
  id: LevelId;
  world: World;
  title: string;
  /** One short line for the tile. */
  blurb: string;
  /** The one idea this puzzle teaches. */
  idea: string;
  task: string;
  nIn: number;
  nOut: number;
  expected: number[];
  /** Best known gate count (the exact minimum, checked by exhaustive search where the puzzle has one output). */
  par: number;
  /** Nudges, gentlest first. */
  nudges: string[];
  solution: Gate[];
}

export const WORLDS: Array<{ id: World; title: string; blurb: string }> = [
  { id: 'basics', title: 'Basics', blurb: 'Meet the one brick you get.' },
  { id: 'combine', title: 'Combine', blurb: 'Reuse answers to save parts.' },
  { id: 'build', title: 'Build', blurb: 'Real circuits from real computers.' },
];

const g = (a: number, b: number): Gate => ({ a, b });

/** Signals: 0 and 1 are constants, inputs start at 2, then gate k is signal 2 + nIn + k. */
export const LEVELS: Level[] = [
  {
    id: 'not',
    world: 'basics',
    title: 'NOT: flip the switch',
    blurb: 'Lamp is the opposite of the switch.',
    idea: 'A NAND brick is ON unless both of its inputs are ON. Connect both inputs to the same switch and it simply flips: ON becomes OFF, OFF becomes ON.',
    task: 'Make the lamp the opposite of the switch.',
    nIn: 1,
    nOut: 1,
    expected: [1, 0],
    par: 1,
    nudges: ['One brick is enough. Click "Add gate".', 'Choose in0 for both of its inputs.'],
    solution: [g(2, 2)],
  },
  {
    id: 'and',
    world: 'basics',
    title: 'AND: both switches on',
    blurb: 'On only when both are on.',
    idea: 'AND is a NAND followed by a flip. Build the NAND first, then use a second brick, with its answer on both inputs, to flip it back.',
    task: 'The lamp turns on only when both switches are on.',
    nIn: 2,
    nOut: 1,
    expected: [0, 0, 0, 1],
    par: 2,
    nudges: ['You need two bricks. The second one is the flip.', 'g0 = NAND(in0, in1). Then g1 = NAND(g0, g0).'],
    solution: [g(2, 3), g(4, 4)],
  },
  {
    id: 'or',
    world: 'basics',
    title: 'OR: either switch on',
    blurb: 'On when at least one is on.',
    idea: 'Flip each switch first, then NAND the two flipped signals. "Not A NAND not B" is exactly "A or B".',
    task: 'The lamp turns on when at least one of the two switches is on.',
    nIn: 2,
    nOut: 1,
    expected: [0, 1, 1, 1],
    par: 3,
    nudges: ['Each switch gets its own flip brick.', 'g0 = NAND(in0, in0) and g1 = NAND(in1, in1).', 'Now combine them: g2 = NAND(g0, g1).'],
    solution: [g(2, 2), g(3, 3), g(4, 5)],
  },
  {
    id: 'nor',
    world: 'combine',
    title: 'NOR: neither switch on',
    blurb: 'On only when both are off.',
    idea: 'NOR is OR with the answer flipped. When you already know how to build something, finishing a puzzle is often just one extra brick.',
    task: 'The lamp turns on only when both switches are off.',
    nIn: 2,
    nOut: 1,
    expected: [1, 0, 0, 0],
    par: 4,
    nudges: ['Build OR first. It takes three bricks.', 'Add a fourth brick that flips the OR: NAND(g2, g2).'],
    solution: [g(2, 2), g(3, 3), g(4, 5), g(6, 6)],
  },
  {
    id: 'xor',
    world: 'combine',
    title: 'XOR: exactly one switch on',
    blurb: 'On when the switches differ.',
    idea: 'Reuse an answer. One brick can feed several other bricks, so you do not have to build the same thing twice. That is how scores get small.',
    task: 'The lamp turns on when exactly one of the two switches is on.',
    nIn: 2,
    nOut: 1,
    expected: [0, 1, 1, 0],
    par: 4,
    nudges: [
      'Start with g0 = NAND(in0, in1). It will be useful in two places.',
      'g1 = NAND(in0, g0) and g2 = NAND(in1, g0). Both use g0.',
      'Combine the two: g3 = NAND(g1, g2). That is 4 bricks.',
    ],
    solution: [g(2, 3), g(2, 4), g(3, 4), g(5, 6)],
  },
  {
    id: 'xnor',
    world: 'combine',
    title: 'XNOR: the switches match',
    blurb: 'On when both agree.',
    idea: 'XNOR is XOR flipped. Keep the XOR you already know and add one brick at the end.',
    task: 'The lamp turns on when the two switches are both on or both off.',
    nIn: 2,
    nOut: 1,
    expected: [1, 0, 0, 1],
    par: 5,
    nudges: ['Build XOR first. It takes four bricks.', 'Flip its answer with a fifth brick.'],
    solution: [g(2, 3), g(2, 4), g(3, 4), g(5, 6), g(7, 7)],
  },
  {
    id: 'mux',
    world: 'build',
    title: 'Selector: pick a switch',
    blurb: 'Switch 3 chooses switch 1 or 2.',
    idea: 'A selector is how a computer chooses between two values. When the third switch is off the lamp copies the first switch, when it is on the lamp copies the second.',
    task: 'Lamp = in1 when in2 is on, otherwise in0.',
    nIn: 3,
    nOut: 1,
    expected: [0, 1, 0, 1, 0, 0, 1, 1],
    par: 4,
    nudges: [
      'You need the opposite of the selector (in2). Flip it with one brick.',
      'g1 = NAND(in0, g0) lets in0 through when the selector is off. g2 = NAND(in1, in2) lets in1 through when it is on.',
      'Combine them: g3 = NAND(g1, g2).',
    ],
    solution: [g(4, 4), g(2, 5), g(3, 4), g(6, 7)],
  },
  {
    id: 'half',
    world: 'build',
    title: 'Half adder: add two bits',
    blurb: 'Two lamps: sum and carry.',
    idea: 'Add two one-bit numbers. Lamp 0 shows the sum bit, lamp 1 shows the carry. The two answers share a brick, so do not build it twice.',
    task: 'Lamp 0 = in0 XOR in1 (the sum). Lamp 1 = in0 AND in1 (the carry).',
    nIn: 2,
    nOut: 2,
    expected: [0, 1, 1, 2],
    par: 5,
    nudges: [
      'The sum is XOR and the carry is AND. XOR already contains NAND(in0, in1).',
      'Build XOR (4 bricks). The carry is that first NAND, flipped: one more brick.',
      'The last two bricks drive the lamps: the sum first, the carry last.',
    ],
    solution: [g(2, 3), g(2, 4), g(3, 4), g(5, 6), g(4, 4)],
  },
  {
    id: 'maj',
    world: 'build',
    title: 'Majority: two out of three',
    blurb: 'On when most switches are on.',
    idea: 'Voting. The lamp follows whatever most of the three switches say. It is on when any pair of switches is both on.',
    task: 'The lamp turns on when at least two of the three switches are on.',
    nIn: 3,
    nOut: 1,
    expected: [0, 0, 0, 1, 0, 1, 1, 1],
    par: 6,
    nudges: [
      'Make a NAND for each pair: in0 with in1, in1 with in2, and in0 with in2.',
      'Combine two of the pair bricks, flip the result, then combine it with the third.',
      'g3 = NAND(g0, g1), g4 = NAND(g3, g3), g5 = NAND(g4, g2).',
    ],
    solution: [g(2, 3), g(3, 4), g(2, 4), g(5, 6), g(8, 8), g(9, 7)],
  },
  {
    id: 'full',
    world: 'build',
    title: 'Full adder: the boss',
    blurb: 'Add three bits. Nine bricks.',
    idea: 'The adder inside every computer chip. It adds three bits and gives a sum and a carry. Build the XOR trick twice and share bricks.',
    task: 'Lamp 0 = the sum of the three switches (odd number on). Lamp 1 = the carry (two or more on).',
    nIn: 3,
    nOut: 2,
    expected: [0, 1, 1, 2, 1, 2, 2, 3],
    par: 9,
    nudges: [
      'Sum = in0 XOR in1 XOR in2. Carry = at least two on.',
      'XOR of in0 and in1 is 4 bricks. XOR that answer with in2 is 4 more.',
      'The carry is NAND of two bricks you already have: the first NAND(in0, in1) and the NAND of (the first XOR, in2). That is the ninth brick.',
    ],
    solution: [g(2, 3), g(2, 5), g(3, 5), g(6, 7), g(8, 4), g(8, 9), g(4, 9), g(10, 11), g(5, 9)],
  },
];

export const LEVEL_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l])) as Record<LevelId, Level>;

/** The puzzles that open the live version. The rest are optional extra practice. */
export const REQUIRED: LevelId[] = ['not', 'and', 'xor'];

/** 3 stars at the best known score, 2 stars one over, 1 star for any correct circuit. */
export function starsFor(par: number, gates: number): 1 | 2 | 3 {
  return gates <= par ? 3 : gates <= par + 1 ? 2 : 1;
}

export interface Progress {
  /** Best gate count per solved puzzle. */
  solved: Partial<Record<LevelId, number>>;
  /** The visitor chose to skip the practice. */
  skipped: boolean;
}

const KEY = 'tapegold:practice:v1';
const listeners = new Set<() => void>();

function read(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<Progress>;
      return { solved: j.solved ?? {}, skipped: j.skipped === true };
    }
  } catch {
    // unreadable or unavailable: start fresh
  }
  return { solved: {}, skipped: false };
}

let progress: Progress = read();

function write(next: Progress) {
  progress = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: progress lasts until the page closes
  }
  for (const l of listeners) l();
}

export function completeLevel(id: LevelId, gates: number): void {
  const best = progress.solved[id];
  if (best !== undefined && best <= gates) return;
  write({ ...progress, solved: { ...progress.solved, [id]: gates } });
}

export function skipPractice(): void {
  write({ ...progress, skipped: true });
}

export function restartPractice(): void {
  write({ solved: {}, skipped: false });
}

export interface PracticeState extends Progress {
  /** Required puzzles solved. */
  count: number;
  /** Required puzzles in total. */
  total: number;
  /** The three required puzzles are solved, or practice was skipped: the live version is open. */
  done: boolean;
  /** Stars earned over every puzzle, and the most there are. */
  stars: number;
  maxStars: number;
  starsOf: (id: LevelId) => 0 | 1 | 2 | 3;
}

function derive(p: Progress): PracticeState {
  const starsOf = (id: LevelId): 0 | 1 | 2 | 3 => {
    const best = p.solved[id];
    return best === undefined ? 0 : starsFor(LEVEL_BY_ID[id].par, best);
  };
  const count = REQUIRED.filter((id) => p.solved[id] !== undefined).length;
  return {
    ...p,
    count,
    total: REQUIRED.length,
    done: count === REQUIRED.length || p.skipped,
    stars: LEVELS.reduce((n, l) => n + starsOf(l.id), 0),
    maxStars: LEVELS.length * 3,
    starsOf,
  };
}

let cached = derive(progress);
let cachedFrom = progress;

function snapshot(): PracticeState {
  if (cachedFrom !== progress) {
    cachedFrom = progress;
    cached = derive(progress);
  }
  return cached;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function usePractice(): PracticeState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
