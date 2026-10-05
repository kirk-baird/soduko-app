// Backtracking solver with cage-tuple and Latin (naked/hidden single) propagation.

import { popcount } from '../common';
import { CalcCage, Ctx, getCtx } from './model';

function lowDigit(m: number): number {
  return 31 - Math.clz32(m & -m);
}

interface SolverData {
  /** Per cage: flattened tuple masks, tm[t * k + j] = 1 << digit. */
  masks: Int32Array[];
}

const dataCache = new WeakMap<Ctx, SolverData>();

function solverData(ctx: Ctx): SolverData {
  let d = dataCache.get(ctx);
  if (!d) {
    d = {
      masks: ctx.tuples.map((ts, ci) => {
        const k = ctx.cages[ci].cells.length;
        const a = new Int32Array(ts.length * k);
        ts.forEach((t, ti) => t.forEach((digit, j) => (a[ti * k + j] = 1 << digit)));
        return a;
      }),
    };
    dataCache.set(ctx, d);
  }
  return d;
}

/** Propagate to a fixpoint. Returns false on contradiction. Mutates c. */
function propagate(ctx: Ctx, sd: SolverData, c: Int32Array, dirty: Uint8Array): boolean {
  const { n, cages, peers, lines, cageOf } = ctx;
  const N2 = n * n;
  const u = new Int32Array(4);
  const done = new Uint8Array(N2); // singles already pushed to peers
  for (let changed = true; changed; ) {
    changed = false;
    for (let ci = 0; ci < cages.length; ci++) {
      if (!dirty[ci]) continue;
      dirty[ci] = 0;
      const cells = cages[ci].cells;
      const k = cells.length;
      const tm = sd.masks[ci];
      u.fill(0);
      let any = false;
      for (let base = 0; base < tm.length; base += k) {
        let j = 0;
        while (j < k && (c[cells[j]] & tm[base + j]) !== 0) j++;
        if (j < k) continue;
        any = true;
        for (j = 0; j < k; j++) u[j] |= tm[base + j];
      }
      if (!any) return false;
      for (let j = 0; j < k; j++) {
        const cell = cells[j];
        const m = c[cell] & u[j];
        if (m !== c[cell]) {
          c[cell] = m;
          changed = true;
        }
      }
    }
    for (let i = 0; i < N2; i++) {
      const m = c[i];
      if (m === 0) return false;
      if (done[i] || (m & (m - 1)) !== 0) continue;
      done[i] = 1;
      for (const p of peers[i]) {
        if (c[p] & m) {
          c[p] &= ~m;
          if (c[p] === 0) return false;
          dirty[cageOf[p]] = 1;
          changed = true;
        }
      }
    }
    for (const line of lines) {
      for (let d = 1; d <= n; d++) {
        const b = 1 << d;
        let pos = -1;
        let cnt = 0;
        for (const i of line) {
          if (c[i] & b) {
            if (++cnt > 1) break;
            pos = i;
          }
        }
        if (cnt === 0) return false;
        if (cnt === 1 && c[pos] !== b) {
          c[pos] = b;
          dirty[cageOf[pos]] = 1;
          changed = true;
        }
      }
    }
  }
  return true;
}

/** Find up to `limit` solutions. */
export function solveAll(ctx: Ctx, limit = 2): number[][] {
  const { n, full } = ctx;
  const N2 = n * n;
  if (ctx.cageOf.some((x) => x < 0)) return [];
  const sd = solverData(ctx);
  const sols: number[][] = [];
  const rec = (c: Int32Array, dirty: Uint8Array) => {
    if (sols.length >= limit) return;
    if (!propagate(ctx, sd, c, dirty)) return;
    let best = -1;
    let bestCount = 99;
    for (let i = 0; i < N2; i++) {
      const pc = popcount(c[i]);
      if (pc > 1 && pc < bestCount) {
        bestCount = pc;
        best = i;
        if (pc === 2) break;
      }
    }
    if (best < 0) {
      sols.push(Array.from(c, lowDigit));
      return;
    }
    let m = c[best];
    while (m && sols.length < limit) {
      const b = m & -m;
      m &= ~b;
      const next = c.slice();
      next[best] = b;
      const nd = new Uint8Array(ctx.cages.length);
      nd[ctx.cageOf[best]] = 1;
      rec(next, nd);
    }
  };
  rec(new Int32Array(N2).fill(full), new Uint8Array(ctx.cages.length).fill(1));
  return sols;
}

export function solve(size: number, cages: CalcCage[], limit = 2): { count: number; solution: number[] | null } {
  const sols = solveAll(getCtx(size, cages), limit);
  return { count: sols.length, solution: sols[0] ?? null };
}
