// Puzzle generation for all sudoku variants.
//
// Two ways to thin a full grid down to a puzzle, both keeping 180° rotational
// symmetry of the givens:
//  - "dfs": remove a clue pair if the backtracking solver still finds exactly
//    one solution (fast for 81-cell grids), then grade.
//  - "logic": remove a clue pair only if the puzzle is still solvable by our
//    techniques up to a tier cap (no uniqueness-based techniques). Logical
//    solvability proves uniqueness, avoids slow searches on big grids
//    (16×16, samurai) and lands near the target difficulty.

import { Grid } from './grid';
import { DIFFICULTY_TIER, Difficulty, grade } from './logic';
import { Rng, shuffle } from './rng';
import { randomSolvedGrid, solve } from './solver';
import { CLASSIC, Geometry, geometryFor } from './sudoku/geometry';

export interface Puzzle {
  puzzle: Grid;
  solution: Grid;
}

/** For each cell, the cell at the 180°-rotated display position (or itself). */
const mirrorCache = new WeakMap<Geometry, number[]>();
function mirrorOf(g: Geometry): number[] {
  let m = mirrorCache.get(g);
  if (!m) {
    m = g.pos.map(([r, c]) => g.cellAt[(g.gridRows - 1 - r) * g.gridCols + (g.gridCols - 1 - c)]);
    mirrorCache.set(g, m);
  }
  return m;
}

function symmetricPairs(g: Geometry): number[][] {
  const mirror = mirrorOf(g);
  const seen = new Set<number>();
  const pairs: number[][] = [];
  for (let i = 0; i < g.cellCount; i++) {
    if (seen.has(i)) continue;
    const j = mirror[i];
    seen.add(i);
    seen.add(j);
    pairs.push(i === j ? [i] : [i, j]);
  }
  return pairs;
}

export function generateMinimal(rng: Rng, symmetric = true, g: Geometry = CLASSIC): Puzzle {
  const p = generateMinimalFrom(rng, symmetric, g);
  if (!p) throw new Error('could not fill grid');
  return p;
}

function generateMinimalFrom(rng: Rng, symmetric: boolean, g: Geometry): Puzzle | null {
  let solution: Grid | null = null;
  for (let t = 0; !solution && t < 5; t++) solution = randomSolvedGrid(rng, g, 20000);
  if (!solution) return null;
  const puzzle = solution.slice();
  const groups = symmetric ? symmetricPairs(g) : [...Array(g.cellCount).keys()].map((i) => [i]);
  for (const grp of shuffle(groups, rng)) {
    const saved = grp.map((i) => puzzle[i]);
    for (const i of grp) puzzle[i] = 0;
    if (solve(puzzle, 2, undefined, g).count !== 1) grp.forEach((i, k) => (puzzle[i] = saved[k]));
  }
  return { puzzle, solution };
}

export function generateByLogic(rng: Rng, g: Geometry, tierCap: number, solution?: Grid): Puzzle | null {
  let sol = solution ?? null;
  for (let tries = 0; !sol && tries < 5; tries++) sol = randomSolvedGrid(rng, g, 50000);
  if (!sol) return null;
  const puzzle = sol.slice();
  const stillSolvable = () => grade(puzzle, tierCap, g, { noUniqueness: true }).solved;
  for (const grp of shuffle(symmetricPairs(g), rng)) {
    const saved = grp.map((i) => puzzle[i]);
    for (const i of grp) puzzle[i] = 0;
    if (!stillSolvable()) grp.forEach((i, k) => (puzzle[i] = saved[k]));
  }
  // For the harder levels, also try single clues (gives up a little symmetry
  // but makes the target technique more likely to be needed).
  if (tierCap >= 3 && grade(puzzle, 4, g).maxTier < tierCap) {
    for (const i of shuffle([...Array(g.cellCount).keys()], rng)) {
      if (!puzzle[i]) continue;
      const saved = puzzle[i];
      puzzle[i] = 0;
      if (!stillSolvable()) puzzle[i] = saved;
    }
  }
  return { puzzle, solution: sol };
}

/**
 * Random irregular regions for jigsaw sudoku: start from the 3×3 boxes and
 * repeatedly swap the regions of two neighbouring cells, keeping every
 * region connected (sizes stay 9).
 */
export function randomJigsawRegions(rng: Rng, swaps = 400): number[] {
  const regions = Array.from({ length: 81 }, (_, i) => Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3));
  const nbrs = (i: number) => {
    const r = Math.floor(i / 9);
    const c = i % 9;
    const out: number[] = [];
    if (r > 0) out.push(i - 9);
    if (r < 8) out.push(i + 9);
    if (c > 0) out.push(i - 1);
    if (c < 8) out.push(i + 1);
    return out;
  };
  const connected = (k: number) => {
    const cells = regions.map((x, i) => (x === k ? i : -1)).filter((i) => i >= 0);
    const seen = new Set([cells[0]]);
    const stack = [cells[0]];
    while (stack.length) {
      const x = stack.pop()!;
      for (const y of nbrs(x)) {
        if (regions[y] === k && !seen.has(y)) {
          seen.add(y);
          stack.push(y);
        }
      }
    }
    return seen.size === cells.length;
  };
  let done = 0;
  for (let guard = 0; done < swaps && guard < swaps * 50; guard++) {
    const a = Math.floor(rng() * 81);
    const ns = nbrs(a).filter((b) => regions[b] !== regions[a]);
    if (!ns.length) continue;
    // Move a into its neighbour b's region, and some other cell c of b's
    // region (touching a's region) into a's region, so sizes stay equal.
    const b = ns[Math.floor(rng() * ns.length)];
    const ra = regions[a];
    const rb = regions[b];
    const candidates = regions
      .map((x, i) => (x === rb && i !== b && nbrs(i).some((j) => regions[j] === ra && j !== a) ? i : -1))
      .filter((i) => i >= 0);
    if (!candidates.length) continue;
    const c = candidates[Math.floor(rng() * candidates.length)];
    regions[a] = rb;
    regions[c] = ra;
    if (connected(ra) && connected(rb)) done++;
    else {
      regions[a] = ra;
      regions[c] = rb;
    }
  }
  return regions;
}

/**
 * Classic-style generation: try up to `maxAttempts` random puzzles and return
 * the first whose hardest required technique matches the difficulty.
 */
export function generateForDifficulty(
  difficulty: Difficulty,
  rng: Rng,
  maxAttempts = 200,
  g: Geometry = CLASSIC,
): Puzzle | null {
  const tier = DIFFICULTY_TIER[difficulty];
  for (let n = 0; n < maxAttempts; n++) {
    const p = generateMinimal(rng, true, g);
    const gr = grade(p.puzzle, 4, g);
    if (gr.solved && gr.maxTier === tier) return p;
  }
  return null;
}

export interface VariantPuzzle extends Puzzle {
  regions?: number[]; // jigsaw only
}

/** One generation attempt for a variant; null if it didn't hit the difficulty. */
export function generateVariant(
  variant: 'classic' | 'windoku' | 'jigsaw' | 'sixteen' | 'samurai',
  difficulty: Difficulty,
  rng: Rng,
): VariantPuzzle | null {
  const tier = DIFFICULTY_TIER[difficulty];
  if (variant === 'classic') {
    const p = generateMinimal(rng);
    const gr = grade(p.puzzle);
    return gr.solved && gr.maxTier === tier ? p : null;
  }
  const regions = variant === 'jigsaw' ? randomJigsawRegions(rng) : undefined;
  const g = geometryFor(variant, regions);
  let solution: Grid | null = null;
  for (let t = 0; !solution && t < 3; t++) solution = randomSolvedGrid(rng, g, 200000);
  if (!solution) return null;
  const p = generateByLogic(rng, g, tier, solution);
  if (!p) return null;
  const gr = grade(p.puzzle, 4, g);
  if (!(gr.solved && gr.maxTier === tier)) return null;
  return { ...p, regions };
}
