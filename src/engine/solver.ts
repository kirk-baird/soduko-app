// Fast backtracking solver (bitmask + minimum-remaining-values heuristic).
// Used for uniqueness checks during generation and to obtain the solution.

import { ALL_DIGITS, Grid, PEERS, bit, isConsistent } from './grid';
import { Rng, shuffle } from './rng';

export interface SolveResult {
  count: number; // number of solutions found (capped at `limit`)
  solution: Grid | null; // first solution found
}

export function solve(grid: Grid, limit = 2, rng?: Rng): SolveResult {
  if (!isConsistent(grid)) return { count: 0, solution: null };
  const g = grid.slice();
  const cands = new Array<number>(81).fill(0);
  for (let i = 0; i < 81; i++) {
    if (g[i]) continue;
    let m = ALL_DIGITS;
    for (const p of PEERS[i]) if (g[p]) m &= ~bit(g[p]);
    cands[i] = m;
  }

  let count = 0;
  let solution: Grid | null = null;

  const rec = (): boolean => {
    // pick empty cell with fewest candidates
    let best = -1;
    let bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      let m = cands[i];
      let n = 0;
      while (m) {
        m &= m - 1;
        n++;
      }
      if (n < bestN) {
        bestN = n;
        best = i;
        if (n <= 1) break;
      }
    }
    if (best === -1) {
      count++;
      if (!solution) solution = g.slice();
      return count >= limit;
    }
    if (bestN === 0) return false;

    let digits: number[] = [];
    for (let d = 1; d <= 9; d++) if (cands[best] & bit(d)) digits.push(d);
    if (rng) digits = shuffle(digits, rng);

    for (const d of digits) {
      const b = bit(d);
      g[best] = d;
      const changed: number[] = [];
      let dead = false;
      for (const p of PEERS[best]) {
        if (!g[p] && cands[p] & b) {
          cands[p] &= ~b;
          changed.push(p);
          if (cands[p] === 0) dead = true;
        }
      }
      if (!dead && rec()) return true;
      for (const p of changed) cands[p] |= b;
      g[best] = 0;
    }
    return false;
  };

  rec();
  return { count, solution };
}

export const hasUniqueSolution = (g: Grid) => solve(g, 2).count === 1;

/** A uniformly-shuffled complete valid grid. */
export function randomSolvedGrid(rng: Rng): Grid {
  const empty = new Array<number>(81).fill(0);
  const res = solve(empty, 1, rng);
  return res.solution!;
}
