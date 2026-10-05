// Kakuro engine: public API.
//
// A rows×cols grid of black and white cells. Each maximal horizontal or
// vertical run of 2+ white cells has a clue (in the black cell to its left /
// above) giving the run's sum. Fill each white cell with 1–9 so every run adds
// up to its clue with no digit repeated within a run.

import { Difficulty, DifficultyInfo } from '../common';
import { Rng } from '../rng';
import { generateLevel } from './generator';
import { grade } from './logic';
import { KakuroPuzzle } from './types';

export type { KakuroPuzzle, KakuroRun } from './types';
export { combinations } from './combos';
export { solve } from './solver';
export { clues, findHint, grade, rulesFor, singlesFinish } from './logic';
export { TECHNIQUES } from './techniques';
export { LEVELS } from './generator';

export const DIFFICULTY_INFO: Record<Difficulty, DifficultyInfo> = {
  medium: { label: 'Medium', description: '7×7 grid, friendly sums' },
  hard: { label: 'Hard', description: '9×9 grid, combination logic' },
  extraHard: { label: 'Extra Hard', description: '11×11 grid, pairs and tight fits' },
  extreme: { label: 'Extreme', description: '13×13 grid, sum blocks and what-ifs' },
};

/**
 * Generate a uniquely solvable puzzle that our techniques can solve, graded to
 * `difficulty`. Each attempt takes a few ms to ~100 ms; returns null if no
 * attempt in `maxAttempts` matched.
 */
export function generate(difficulty: Difficulty, rng: Rng, maxAttempts = 200): KakuroPuzzle | null {
  return generateLevel(difficulty, rng, maxAttempts, (p) => grade(p));
}
