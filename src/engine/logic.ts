// Applying steps, grading puzzles and the singles-only autocomplete check.

import { Cands, Grid, bit } from './grid';
import { legalCandidates } from './sudoku/core';
import { CLASSIC, Geometry } from './sudoku/geometry';
import { CellDigit, FindOptions, State, Step, TECHNIQUES, TECHNIQUE_BY_ID, TechniqueId, findStep } from './techniques';

export function applyStep(s: State, st: Step, g: Geometry = CLASSIC): State {
  const values = s.values.slice();
  const cands = s.cands.slice();
  for (const e of st.eliminations) cands[e.cell] &= ~bit(e.digit);
  for (const p of st.placements) place(values, cands, p, g);
  return { values, cands };
}

/** Place a digit and remove it from all peers' candidates (mutates). */
export function place(values: Grid, cands: Cands, p: CellDigit, g: Geometry = CLASSIC) {
  values[p.cell] = p.digit;
  cands[p.cell] = 0;
  const b = bit(p.digit);
  for (const q of g.peers[p.cell]) cands[q] &= ~b;
}

export const DIFFICULTIES = ['medium', 'hard', 'extraHard', 'extreme'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  medium: 'Medium',
  hard: 'Hard',
  extraHard: 'Extra Hard',
  extreme: 'Extreme',
};

/** The hardest technique tier a puzzle of this difficulty requires. */
export const DIFFICULTY_TIER: Record<Difficulty, number> = {
  medium: 1,
  hard: 2,
  extraHard: 3,
  extreme: 4,
};

export function difficultyForTier(tier: number): Difficulty | null {
  // Singles-only puzzles are too easy for the lowest level offered.
  return (DIFFICULTIES as readonly Difficulty[]).find((d) => DIFFICULTY_TIER[d] === tier) ?? null;
}

export function techniquesForDifficulty(d: Difficulty): string[] {
  return TECHNIQUES.filter((t) => t.tier === DIFFICULTY_TIER[d]).map((t) => t.name);
}

export interface Grade {
  solved: boolean; // solvable using our techniques alone
  maxTier: number;
  counts: Partial<Record<TechniqueId, number>>;
  steps: number;
}

export function grade(puzzle: Grid, maxTier = 4, g: Geometry = CLASSIC, opts: FindOptions = {}): Grade {
  let s: State = { values: puzzle.slice(), cands: legalCandidates(g, puzzle) };
  const counts: Partial<Record<TechniqueId, number>> = {};
  let maxT = 0;
  let steps = 0;
  for (;;) {
    if (s.values.every((v) => v !== 0)) return { solved: true, maxTier: maxT, counts, steps };
    const st = findStep(s, maxTier, g, opts);
    if (!st) return { solved: false, maxTier: maxT, counts, steps };
    counts[st.technique] = (counts[st.technique] ?? 0) + 1;
    maxT = Math.max(maxT, TECHNIQUE_BY_ID[st.technique].tier);
    steps++;
    s = applyStep(s, st, g);
  }
}

/**
 * If the remaining puzzle can be completed using only naked and hidden singles
 * (starting from the placed digits), return the placements in solving order.
 * Returns null otherwise. Assumes the placed digits are correct.
 */
export function singlesFinish(values: Grid, g: Geometry = CLASSIC): CellDigit[] | null {
  let s: State = { values: values.slice(), cands: legalCandidates(g, values) };
  const out: CellDigit[] = [];
  for (;;) {
    if (s.values.every((v) => v !== 0)) return out;
    const st = findStep(s, 0, g);
    if (!st) return null;
    out.push(...st.placements);
    s = applyStep(s, st, g);
  }
}
