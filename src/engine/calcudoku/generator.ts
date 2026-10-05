// Random Calcudoku construction: Latin square -> cage partition -> operations
// -> uniqueness repair (re-pick ops / merge cages around cells where a second
// solution differs).

import { Rng, shuffle } from '../rng';
import { CageOp, CalcCage, CalcudokuPuzzle, colOf, getCtx, rowOf } from './model';
import { solveAll } from './solver';

export interface CageOptions {
  /** Relative weights for cage sizes 1..4 (index 0 unused). */
  sizeWeights: [number, number, number, number, number];
  maxSingles: number;
  /** Probability of ÷ for a divisible 2-cell cage, and of − otherwise. */
  pDiv: number;
  pSub: number;
  /** Probability of × for 3–4 cell cages (if the product is at most maxProduct). */
  pMul: number;
  maxProduct: number;
  /** Uniqueness repair rounds before giving up on this layout. */
  repairs: number;
  /** Repair move probabilities: merge with a neighbouring differing cage, else split a 3–4 cell cage. */
  pMerge: number;
  pSplit: number;
}

export const DEFAULT_CAGE_OPTIONS: CageOptions = {
  sizeWeights: [0, 1, 6, 5, 3],
  maxSingles: 3,
  pDiv: 0.6,
  pSub: 0.45,
  pMul: 0.45,
  maxProduct: 1500,
  repairs: 12,
  pMerge: 0.4,
  pSplit: 0.5,
};

export function randomLatin(n: number, rng: Rng): number[] {
  const N2 = n * n;
  for (;;) {
    const g = new Array<number>(N2).fill(0);
    const rowUsed = new Array<number>(n).fill(0);
    const colUsed = new Array<number>(n).fill(0);
    let budget = 20000;
    const rec = (i: number): boolean => {
      if (i === N2) return true;
      if (--budget < 0) return false;
      const r = rowOf(n, i);
      const c = colOf(n, i);
      const ds = shuffle([...Array(n).keys()].map((d) => d + 1), rng);
      for (const d of ds) {
        const b = 1 << d;
        if ((rowUsed[r] | colUsed[c]) & b) continue;
        g[i] = d;
        rowUsed[r] |= b;
        colUsed[c] |= b;
        if (rec(i + 1)) return true;
        rowUsed[r] &= ~b;
        colUsed[c] &= ~b;
        if (budget < 0) return false;
      }
      g[i] = 0;
      return false;
    };
    if (rec(0)) return g;
  }
}

function neighbours(n: number, i: number): number[] {
  const r = rowOf(n, i);
  const c = colOf(n, i);
  const out: number[] = [];
  if (r > 0) out.push(i - n);
  if (r < n - 1) out.push(i + n);
  if (c > 0) out.push(i - 1);
  if (c < n - 1) out.push(i + 1);
  return out;
}

function pickWeighted(weights: number[], rng: Rng): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

/** Random partition of the grid into connected groups of 1..4 cells. */
export function randomPartition(n: number, rng: Rng, opt: CageOptions): number[][] {
  const N2 = n * n;
  const owner = new Array<number>(N2).fill(-1);
  const groups: number[][] = [];
  for (const start of shuffle([...Array(N2).keys()], rng)) {
    if (owner[start] >= 0) continue;
    const size = pickWeighted(opt.sizeWeights, rng);
    const g = [start];
    owner[start] = groups.length;
    while (g.length < size) {
      const frontier = [...new Set(g.flatMap((c) => neighbours(n, c)))].filter((c) => owner[c] < 0);
      if (!frontier.length) break;
      const c = frontier[Math.floor(rng() * frontier.length)];
      owner[c] = groups.length;
      g.push(c);
    }
    groups.push(g);
  }
  // Too many single cells: fold extras into a neighbouring group with room.
  const singles = shuffle(
    groups.map((g, i) => (g.length === 1 ? i : -1)).filter((i) => i >= 0),
    rng,
  );
  for (const gi of singles) {
    if (groups.filter((g) => g.length === 1).length <= opt.maxSingles) break;
    const cell = groups[gi][0];
    const targets = shuffle(
      neighbours(n, cell).map((c) => owner[c]).filter((o) => o !== gi && groups[o].length < 4 && groups[o].length > 0),
      rng,
    );
    if (!targets.length) continue;
    const t = targets[0];
    groups[t].push(cell);
    owner[cell] = t;
    groups[gi] = [];
  }
  return groups.filter((g) => g.length > 0).map((g) => g.sort((a, b) => a - b));
}

function pickOp(cells: number[], sol: number[], rng: Rng, opt: CageOptions, avoid?: CageOp): CalcCage {
  const ds = cells.map((c) => sol[c]);
  const sum = ds.reduce((a, b) => a + b, 0);
  const prod = ds.reduce((a, b) => a * b, 1);
  if (cells.length === 1) return { cells, op: '=', target: ds[0] };
  const options: { op: CageOp; target: number; w: number }[] = [];
  if (cells.length === 2) {
    const hi = Math.max(ds[0], ds[1]);
    const lo = Math.min(ds[0], ds[1]);
    const div = hi % lo === 0;
    if (div) options.push({ op: '/', target: hi / lo, w: opt.pDiv });
    const restDiv = div ? 1 - opt.pDiv : 1;
    options.push({ op: '-', target: hi - lo, w: restDiv * opt.pSub });
    const rest = restDiv * (1 - opt.pSub);
    options.push({ op: '+', target: sum, w: rest / 2 }, { op: '*', target: prod, w: rest / 2 });
  } else {
    const mulOk = prod <= opt.maxProduct;
    options.push({ op: '*', target: prod, w: mulOk ? opt.pMul : 0 }, { op: '+', target: sum, w: mulOk ? 1 - opt.pMul : 1 });
  }
  const usable = options.filter((o) => o.op !== avoid && o.w > 0);
  const pool = usable.length ? usable : options;
  const o = pool[pickWeighted(pool.map((x) => x.w), rng)];
  return { cells, op: o.op, target: o.target };
}

/**
 * Build a uniquely solvable puzzle for the given solution, or null if the
 * layout couldn't be repaired within opt.repairs rounds.
 */
export function cagePuzzle(n: number, sol: number[], rng: Rng, opt: CageOptions): CalcudokuPuzzle | null {
  let cages = randomPartition(n, rng, opt).map((g) => pickOp(g, sol, rng, opt));
  for (let round = 0; round <= opt.repairs; round++) {
    const sols = solveAll(getCtx(n, cages), 2);
    if (sols.length === 1) return { size: n, cages, solution: sol.slice() };
    if (round === opt.repairs || sols.length === 0) return null;
    const alt = sols.find((s) => s.some((v, i) => v !== sol[i]))!;
    const diff = alt.map((v, i) => (v !== sol[i] ? i : -1)).filter((i) => i >= 0);
    const cageOf = new Array<number>(n * n).fill(-1);
    cages.forEach((c, ci) => c.cells.forEach((cell) => (cageOf[cell] = ci)));
    const cell = diff[Math.floor(rng() * diff.length)];
    const ci = cageOf[cell];
    const cage = cages[ci];
    // Prefer merging with a neighbouring cage that also differs.
    const diffSet = new Set(diff);
    const mergeable = shuffle(
      [...new Set(cage.cells.flatMap((c) => neighbours(n, c)).map((c) => cageOf[c]))].filter(
        (cj) =>
          cj !== ci &&
          cages[cj].cells.length + cage.cells.length <= 4 &&
          cages[cj].op !== '=' &&
          cages[cj].cells.some((c) => diffSet.has(c)),
      ),
      rng,
    );
    const next = cages.slice();
    const r = rng();
    const singles = cages.filter((c) => c.cells.length === 1).length;
    const split = r >= opt.pMerge ? splitCage(n, cage.cells, cell, singles < opt.maxSingles, rng) : null;
    if (mergeable.length && r < opt.pMerge) {
      const cj = mergeable[0];
      const cells = [...cage.cells, ...cages[cj].cells].sort((a, b) => a - b);
      next[ci] = pickOp(cells, sol, rng, opt);
      next.splice(cj, 1);
    } else if (split && rng() < opt.pSplit) {
      next[ci] = pickOp(split[0], sol, rng, opt);
      next.push(pickOp(split[1], sol, rng, opt));
    } else {
      next[ci] = pickOp(cage.cells, sol, rng, opt, cage.op);
    }
    cages = next;
  }
  return null;
}

function connected(n: number, cells: number[]): boolean {
  const seen = new Set([cells[0]]);
  const stack = [cells[0]];
  while (stack.length) {
    const c = stack.pop()!;
    for (const x of neighbours(n, c)) {
      if (cells.includes(x) && !seen.has(x)) {
        seen.add(x);
        stack.push(x);
      }
    }
  }
  return seen.size === cells.length;
}

/** Split a 3–4 cell cage into two connected parts, one containing `cell`. */
function splitCage(n: number, cells: number[], cell: number, allowSingle: boolean, rng: Rng): [number[], number[]] | null {
  if (cells.length < 3) return null;
  const others = cells.filter((c) => c !== cell);
  const options: [number[], number[]][] = [];
  for (let mask = 0; mask < 1 << others.length; mask++) {
    const a = [cell, ...others.filter((_, j) => mask & (1 << j))];
    const b = cells.filter((c) => !a.includes(c));
    if (!b.length) continue;
    if (!allowSingle && (a.length < 2 || b.length < 2)) continue;
    if (connected(n, a) && connected(n, b)) options.push([a.sort((x, y) => x - y), b.sort((x, y) => x - y)]);
  }
  return options.length ? options[Math.floor(rng() * options.length)] : null;
}

/** A random unique puzzle of the given size (retries layouts until one works). */
export function randomPuzzle(n: number, rng: Rng, opt: CageOptions = DEFAULT_CAGE_OPTIONS, tries = 50): CalcudokuPuzzle | null {
  for (let t = 0; t < tries; t++) {
    const sol = randomLatin(n, rng);
    const p = cagePuzzle(n, sol, rng, opt);
    if (p) return p;
  }
  return null;
}
