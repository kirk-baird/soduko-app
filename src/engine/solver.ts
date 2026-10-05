// Fast backtracking solver (bitmask + minimum-remaining-values heuristic).
// Used for uniqueness checks during generation and to obtain the solution.

import { Grid, bit } from './grid';
import { Rng, shuffle } from './rng';
import { isConsistent } from './sudoku/core';
import { CLASSIC, Geometry } from './sudoku/geometry';

export interface SolveResult {
  count: number; // number of solutions found (capped at `limit`)
  solution: Grid | null; // first solution found
}

export interface SolveOptions {
  /** Give up after this many search nodes (count is then a lower bound). */
  nodeLimit?: number;
}

export function solve(grid: Grid, limit = 2, rng?: Rng, g: Geometry = CLASSIC, opts: SolveOptions = {}): SolveResult & { aborted?: boolean } {
  if (!isConsistent(g, grid)) return { count: 0, solution: null };
  const N = g.cellCount;
  const PEERS = g.peers;
  let nodes = 0;
  let aborted = false;
  const v = grid.slice();
  const cands = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) {
    if (v[i]) continue;
    let m = g.all;
    for (const p of PEERS[i]) if (v[p]) m &= ~bit(v[p]);
    cands[i] = m;
  }

  let count = 0;
  let solution: Grid | null = null;

  const rec = (): boolean => {
    if (opts.nodeLimit && ++nodes > opts.nodeLimit) {
      aborted = true;
      return true;
    }
    // pick empty cell with fewest candidates
    let best = -1;
    let bestN = 99;
    for (let i = 0; i < N; i++) {
      if (v[i]) continue;
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
      if (!solution) solution = v.slice();
      return count >= limit;
    }
    if (bestN === 0) return false;

    let digits: number[] = [];
    for (let d = 1; d <= g.n; d++) if (cands[best] & bit(d)) digits.push(d);
    if (rng) digits = shuffle(digits, rng);

    for (const d of digits) {
      const b = bit(d);
      v[best] = d;
      const changed: number[] = [];
      let dead = false;
      for (const p of PEERS[best]) {
        if (!v[p] && cands[p] & b) {
          cands[p] &= ~b;
          changed.push(p);
          if (cands[p] === 0) dead = true;
        }
      }
      if (!dead && rec()) return true;
      for (const p of changed) cands[p] |= b;
      v[best] = 0;
    }
    return false;
  };

  rec();
  return aborted ? { count, solution: count ? solution : null, aborted } : { count, solution };
}

export const hasUniqueSolution = (grid: Grid, g: Geometry = CLASSIC) => solve(grid, 2, undefined, g).count === 1;

/** A random complete valid grid (null if the search gave up, e.g. an unlucky jigsaw layout). */
export function randomSolvedGrid(rng: Rng, g: Geometry = CLASSIC, nodeLimit?: number): Grid | null {
  const blank = new Array<number>(g.cellCount).fill(0);
  const res = solve(blank, 1, rng, g, { nodeLimit });
  return res.aborted ? null : res.solution;
}
