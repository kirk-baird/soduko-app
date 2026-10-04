// Puzzle generation: random solved grid -> remove clues (with 180° rotational
// symmetry) while the solution stays unique -> grade by techniques required.

import { Grid } from './grid';
import { Difficulty, DIFFICULTY_TIER, grade } from './logic';
import { Rng, shuffle } from './rng';
import { randomSolvedGrid, solve } from './solver';

export interface Puzzle {
  puzzle: Grid;
  solution: Grid;
}

export function generateMinimal(rng: Rng, symmetric = true): Puzzle {
  const solution = randomSolvedGrid(rng);
  const puzzle = solution.slice();
  const order = shuffle(
    [...Array(symmetric ? 41 : 81).keys()],
    rng,
  );
  for (const i of order) {
    const j = 80 - i;
    const saved = [puzzle[i], puzzle[j]];
    puzzle[i] = 0;
    if (symmetric) puzzle[j] = 0;
    if (solve(puzzle, 2).count !== 1) {
      puzzle[i] = saved[0];
      if (symmetric) puzzle[j] = saved[1];
    }
  }
  return { puzzle, solution };
}

/**
 * Try up to `maxAttempts` random puzzles and return the first whose hardest
 * required technique matches the difficulty. Returns null if none found.
 */
export function generateForDifficulty(difficulty: Difficulty, rng: Rng, maxAttempts = 200): Puzzle | null {
  const tier = DIFFICULTY_TIER[difficulty];
  for (let n = 0; n < maxAttempts; n++) {
    const p = generateMinimal(rng);
    const g = grade(p.puzzle);
    if (g.solved && g.maxTier === tier) return p;
  }
  return null;
}
