// Backtracking Kakuro solver with exact per-run propagation.

import { popcount } from '../common';
import { comboMasks, runSupport } from './combos';
import { Ctx, KakuroLayout, ctxOf } from './types';

const ALL = 0x3fe; // digits 1..9

const lowDigit = (m: number) => 31 - Math.clz32(m & -m);

/**
 * Prune `dom` to single-run consistency over every run (queue-based).
 * Returns false on contradiction. `dirtyRuns` = runs to start from (all if omitted).
 */
export function propagate(ctx: Ctx, dom: number[], dirtyRuns?: number[]): boolean {
  const { runs, cellRuns } = ctx;
  const inQ = new Uint8Array(runs.length);
  const queue: number[] = [];
  const start = dirtyRuns ?? runs.map((_, i) => i);
  for (const r of start) {
    if (!inQ[r]) {
      inQ[r] = 1;
      queue.push(r);
    }
  }
  const doms: number[] = [];
  const out: number[] = [];
  while (queue.length) {
    const ri = queue.pop()!;
    inQ[ri] = 0;
    const run = runs[ri];
    const cells = run.cells;
    doms.length = cells.length;
    for (let i = 0; i < cells.length; i++) doms[i] = dom[cells[i]];
    if (!runSupport(doms, comboMasks(run.sum, cells.length), out)) return false;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const nd = dom[c] & out[i];
      if (nd === dom[c]) continue;
      if (!nd) return false;
      dom[c] = nd;
      for (const rj of cellRuns[c]) {
        if (rj !== ri && !inQ[rj]) {
          inQ[rj] = 1;
          queue.push(rj);
        }
      }
    }
  }
  return true;
}

export interface SolveResult {
  count: number;
  solutions: number[][];
}

/** Find up to `limit` solutions. `initial` optionally restricts cells (candidate masks). */
export function solveAll(p: KakuroLayout, limit = 2, initial?: number[], nodeLimit = Infinity): SolveResult & { aborted: boolean } {
  const ctx = ctxOf(p);
  const dom = new Array<number>(ctx.n).fill(0);
  for (const c of ctx.whiteCells) dom[c] = initial ? initial[c] & ALL : ALL;
  const solutions: number[][] = [];
  let nodes = 0;
  let aborted = false;

  const rec = (d: number[], dirty?: number[]): void => {
    if (solutions.length >= limit || aborted) return;
    if (++nodes > nodeLimit) {
      aborted = true;
      return;
    }
    if (!propagate(ctx, d, dirty)) return;
    let best = -1;
    let bestN = 99;
    for (const c of ctx.whiteCells) {
      const k = popcount(d[c]);
      if (k > 1 && k < bestN) {
        bestN = k;
        best = c;
        if (k === 2) break;
      }
    }
    if (best < 0) {
      solutions.push(d.map((m) => (m ? lowDigit(m) : 0)));
      return;
    }
    let m = d[best];
    while (m) {
      const b = m & -m;
      m ^= b;
      const nd = d.slice();
      nd[best] = b;
      rec(nd, ctx.cellRuns[best]);
      if (solutions.length >= limit || aborted) return;
    }
  };
  rec(dom);
  return { count: solutions.length, solutions, aborted };
}

export function solve(
  p: KakuroLayout,
  limit = 2,
): { count: number; solution: number[] | null } {
  const r = solveAll(p, limit);
  return { count: r.count, solution: r.solutions[0] ?? null };
}
