// Calcudoku data model: cages, cage arithmetic, and a per-puzzle context with
// precomputed cage "tuples" (every assignment of a cage's cells that reaches
// its target while keeping digits distinct within a row/column).

import { bit } from '../common';

export type CageOp = '+' | '-' | '*' | '/' | '=';

export interface CalcCage {
  cells: number[];
  op: CageOp;
  target: number;
}

/** Cells are row-major: index = r * size + c. JSON-serialisable. */
export interface CalcudokuPuzzle {
  size: number;
  cages: CalcCage[];
  solution: number[];
}

export interface Ctx {
  n: number;
  cages: CalcCage[];
  cageOf: number[];
  rows: number[][];
  cols: number[][];
  lines: number[][]; // rows 0..n-1 then columns n..2n-1
  peers: number[][]; // same row or column
  tuples: number[][][]; // per cage: valid assignments aligned with cage.cells
  full: number; // mask of digits 1..n
}

export const rowOf = (n: number, i: number) => Math.floor(i / n);
export const colOf = (n: number, i: number) => i % n;

const OP_SYMBOL: Record<CageOp, string> = { '+': '+', '-': '−', '*': '×', '/': '÷', '=': '' };

/** Display label, e.g. '24×', '2−', '3÷', '15+', '5'. */
export function cageLabel(c: CalcCage): string {
  return `${c.target}${OP_SYMBOL[c.op]}`;
}

export function cageSatisfied(op: CageOp, target: number, ds: number[]): boolean {
  switch (op) {
    case '=':
      return ds.length === 1 && ds[0] === target;
    case '+':
      return ds.reduce((a, b) => a + b, 0) === target;
    case '*':
      return ds.reduce((a, b) => a * b, 1) === target;
    case '-':
      return ds.length === 2 && Math.abs(ds[0] - ds[1]) === target;
    case '/': {
      if (ds.length !== 2) return false;
      const hi = Math.max(ds[0], ds[1]);
      const lo = Math.min(ds[0], ds[1]);
      return hi % lo === 0 && hi / lo === target;
    }
  }
}

/** True if cells a and b are in the same row or column (so must differ). */
export const sameLine = (n: number, a: number, b: number) => rowOf(n, a) === rowOf(n, b) || colOf(n, a) === colOf(n, b);

/** Every assignment of the cage reaching its target, with row/column distinctness inside the cage. */
export function enumerateCage(n: number, cage: CalcCage): number[][] {
  const { cells, op, target } = cage;
  const k = cells.length;
  if (op === '=') return k === 1 && target >= 1 && target <= n ? [[target]] : [];
  if ((op === '-' || op === '/') && k !== 2) return [];
  const conflict: number[][] = cells.map((a, i) => cells.slice(0, i).flatMap((b, j) => (sameLine(n, a, b) ? [j] : [])));
  const out: number[][] = [];
  const cur = new Array<number>(k).fill(0);
  const rec = (i: number, acc: number) => {
    if (i === k) {
      if (cageSatisfied(op, target, cur)) out.push(cur.slice());
      return;
    }
    const rem = k - i - 1;
    for (let d = 1; d <= n; d++) {
      if (conflict[i].some((j) => cur[j] === d)) continue;
      let next = acc;
      if (op === '+') {
        next = acc + d;
        if (next + rem > target || next + rem * n < target) continue;
      } else if (op === '*') {
        next = acc * d;
        if (target % next !== 0) continue;
        if (rem === 0 && next !== target) continue;
      }
      cur[i] = d;
      rec(i + 1, next);
    }
    cur[i] = 0;
  };
  rec(0, op === '*' ? 1 : 0);
  return out;
}

const ctxCache = new WeakMap<CalcCage[], Ctx>();

export function getCtx(n: number, cages: CalcCage[]): Ctx {
  const hit = ctxCache.get(cages);
  if (hit && hit.n === n) return hit;
  const N2 = n * n;
  const cageOf = new Array<number>(N2).fill(-1);
  cages.forEach((c, ci) => c.cells.forEach((cell) => (cageOf[cell] = ci)));
  const rows = [...Array(n).keys()].map((r) => [...Array(n).keys()].map((c) => r * n + c));
  const cols = [...Array(n).keys()].map((c) => [...Array(n).keys()].map((r) => r * n + c));
  const peers = [...Array(N2).keys()].map((i) =>
    [...rows[rowOf(n, i)], ...cols[colOf(n, i)]].filter((j) => j !== i),
  );
  const ctx: Ctx = {
    n,
    cages,
    cageOf,
    rows,
    cols,
    lines: [...rows, ...cols],
    peers,
    tuples: cages.map((c) => enumerateCage(n, c)),
    full: ((1 << (n + 1)) - 1) & ~1,
  };
  ctxCache.set(cages, ctx);
  return ctx;
}

/** Allowed digits per cell: the placed value, or the candidate mask. */
export const allowedOf = (values: number[], cands: number[], cell: number) =>
  values[cell] ? bit(values[cell]) : cands[cell];

/** Cage tuples consistent with the given placed values and candidates. */
export function validTuples(ctx: Ctx, ci: number, values: number[], cands: number[]): number[][] {
  const cells = ctx.cages[ci].cells;
  const allowed = cells.map((c) => allowedOf(values, cands, c));
  return ctx.tuples[ci].filter((t) => t.every((d, k) => (allowed[k] & (1 << d)) !== 0));
}

/** Per-cell union of digits over the given tuples. */
export function tupleUnion(k: number, tuples: number[][]): number[] {
  const u = new Array<number>(k).fill(0);
  for (const t of tuples) for (let j = 0; j < k; j++) u[j] |= 1 << t[j];
  return u;
}

/** Digits not used by a placed peer (row/column), per empty cell; 0 for filled cells. */
export function latinCandidates(ctx: Ctx, values: number[]): number[] {
  const { n, full } = ctx;
  const rowUsed = new Array<number>(n).fill(0);
  const colUsed = new Array<number>(n).fill(0);
  values.forEach((v, i) => {
    if (v) {
      rowUsed[rowOf(n, i)] |= bit(v);
      colUsed[colOf(n, i)] |= bit(v);
    }
  });
  return values.map((v, i) => (v ? 0 : full & ~rowUsed[rowOf(n, i)] & ~colUsed[colOf(n, i)]));
}

/**
 * Latin candidates further restricted to digits for which the cell's cage can
 * still be completed (with the other empty cage cells taking latin candidates).
 */
export function legalCandidates(ctx: Ctx, values: number[]): number[] {
  const lat = latinCandidates(ctx, values);
  const res = lat.slice();
  ctx.cages.forEach((cage, ci) => {
    if (cage.cells.every((c) => values[c])) return;
    const u = tupleUnion(cage.cells.length, validTuples(ctx, ci, values, lat));
    cage.cells.forEach((c, k) => {
      if (!values[c]) res[c] &= u[k];
    });
  });
  return res;
}
