// Kakuro generation: random symmetric layout, random digit fill, uniqueness
// repair, then grading against the requested difficulty.

import { Difficulty } from '../common';
import { Rng, shuffle } from '../rng';
import { solveAll } from './solver';
import { KakuroPuzzle, KakuroRun, layoutRuns } from './types';

export interface LevelConfig {
  rows: number; // including the clue row
  cols: number; // including the clue column
  density: number; // target share of interior cells that are white
  maxRun: number;
  bias: number; // 0..1, how strongly fills favour runs with few combinations
  minTier: number;
  maxTier: number;
}

// ---------- layout ----------

function layoutValid(rows: number, cols: number, white: boolean[]): boolean {
  let first = -1;
  let count = 0;
  for (let r = 1; r < rows; r++) {
    for (let c = 1; c < cols; c++) {
      const i = r * cols + c;
      if (!white[i]) continue;
      count++;
      if (first < 0) first = i;
      const h = (c > 1 && white[i - 1]) || (c + 1 < cols && white[i + 1]);
      const v = (r > 1 && white[i - cols]) || (r + 1 < rows && white[i + cols]);
      if (!h || !v) return false;
    }
  }
  if (count === 0) return false;
  // connectivity
  const seen = new Uint8Array(rows * cols);
  const stack = [first];
  seen[first] = 1;
  let reached = 0;
  while (stack.length) {
    const i = stack.pop()!;
    reached++;
    const r = Math.floor(i / cols);
    const c = i % cols;
    const nb = [c > 0 ? i - 1 : -1, c + 1 < cols ? i + 1 : -1, r > 0 ? i - cols : -1, r + 1 < rows ? i + cols : -1];
    for (const j of nb) {
      if (j >= 0 && white[j] && !seen[j]) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return reached === count;
}

/** Cells (in runs) that lie in runs longer than maxRun. */
function longRunCells(rows: number, cols: number, white: boolean[], maxRun: number): number[] {
  const out: number[] = [];
  for (const run of layoutRuns(rows, cols, white)) if (run.cells.length > maxRun) out.push(...run.cells);
  return out;
}

export function makeLayout(rows: number, cols: number, rng: Rng, density: number, maxRun: number): boolean[] | null {
  const white = new Array<boolean>(rows * cols).fill(false);
  for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) white[r * cols + c] = true;
  const partner = (i: number) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return (rows - r) * cols + (cols - c);
  };
  const interior = (rows - 1) * (cols - 1);
  const target = Math.round(density * interior);
  let whiteCount = interior;
  let fails = 0;
  for (;;) {
    const long = longRunCells(rows, cols, white, maxRun);
    if (!long.length && whiteCount <= target) return white;
    let cell: number;
    if (long.length) cell = long[Math.floor(rng() * long.length)];
    else {
      const ws: number[] = [];
      for (let i = 0; i < white.length; i++) if (white[i]) ws.push(i);
      cell = ws[Math.floor(rng() * ws.length)];
    }
    const p = partner(cell);
    white[cell] = false;
    white[p] = false;
    if (layoutValid(rows, cols, white)) {
      whiteCount -= cell === p ? 1 : 2;
      fails = 0;
    } else {
      white[cell] = true;
      white[p] = true;
      if (++fails > 200) return null;
    }
  }
}

// ---------- fill ----------

export function fillDigits(
  rows: number,
  cols: number,
  white: boolean[],
  runs: KakuroRun[],
  rng: Rng,
  bias: number,
  fixed?: number[], // cells already holding a digit to keep (0 = free)
): number[] | null {
  const n = rows * cols;
  const cellRuns: number[][] = Array.from({ length: n }, () => []);
  runs.forEach((r, i) => r.cells.forEach((c) => cellRuns[c].push(i)));
  const pol = runs.map(() => (rng() < 0.5 ? -1 : 1));
  const used = new Array<number>(runs.length).fill(0);
  const values = new Array<number>(n).fill(0);
  const order: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!white[i]) continue;
    if (fixed && fixed[i]) {
      values[i] = fixed[i];
      for (const r of cellRuns[i]) used[r] |= 1 << fixed[i];
    } else order.push(i);
  }
  let nodes = 0;
  const rec = (k: number): boolean => {
    if (k === order.length) return true;
    if (++nodes > 20000) return false;
    const c = order[k];
    let mask = 0x3fe;
    for (const r of cellRuns[c]) mask &= ~used[r];
    if (!mask) return false;
    const p = cellRuns[c].reduce((s, r) => s + pol[r], 0);
    const ds: { d: number; s: number }[] = [];
    for (let d = 1; d <= 9; d++) if (mask & (1 << d)) ds.push({ d, s: rng() * (1 - bias) * 2 + bias * p * ((d - 5) / 4) });
    ds.sort((a, b) => a.s - b.s);
    for (const { d } of ds) {
      values[c] = d;
      for (const r of cellRuns[c]) used[r] |= 1 << d;
      if (rec(k + 1)) return true;
      for (const r of cellRuns[c]) used[r] &= ~(1 << d);
      values[c] = 0;
    }
    return false;
  };
  return rec(0) ? values : null;
}

// ---------- uniqueness ----------

function withSums(runs: KakuroRun[], values: number[]): KakuroRun[] {
  return runs.map((r) => ({ ...r, sum: r.cells.reduce((s, c) => s + values[c], 0) }));
}

export interface RawPuzzle {
  puzzle: KakuroPuzzle;
  stats: { refills: number; blackened: number };
}

/**
 * One attempt at a uniquely solvable puzzle: layout, fill, then repair
 * ambiguity by re-filling the cells where two solutions differ, or by turning
 * one of those cells (and its symmetric partner) black.
 */
export function makeUnique(cfg: LevelConfig, rng: Rng): RawPuzzle | null {
  const { rows, cols } = cfg;
  const white = makeLayout(rows, cols, rng, cfg.density, cfg.maxRun);
  if (!white) return null;
  let runs = layoutRuns(rows, cols, white);
  let values = fillDigits(rows, cols, white, runs, rng, cfg.bias);
  if (!values) return null;
  const minWhite = Math.round((cfg.density - 0.12) * (rows - 1) * (cols - 1));
  let refills = 0;
  let blackened = 0;
  for (let iter = 0; iter < 120; iter++) {
    const withS = withSums(runs, values);
    const res = solveAll({ rows, cols, white, runs: withS }, 2, undefined, 20000);
    if (res.aborted) return null;
    if (res.count === 1) {
      return { puzzle: { rows, cols, white: white.slice(), runs: withS, solution: values }, stats: { refills, blackened } };
    }
    const other = res.solutions.find((s) => s.some((v, i) => v !== values![i]))!;
    const diff: number[] = [];
    for (let i = 0; i < values.length; i++) if (other[i] !== values[i]) diff.push(i);
    // 1) Re-fill the differing cells (keeping the rest).
    if (refills < 80) {
      refills++;
      const fixed = values.slice();
      // free the differing cells plus a few random neighbours in their runs
      const free = new Set(diff);
      for (const c of diff) {
        for (const r of runs) {
          if (r.cells.includes(c) && rng() < 0.15) for (const q of r.cells) free.add(q);
        }
      }
      for (const c of free) fixed[c] = 0;
      const nv = fillDigits(rows, cols, white, runs, rng, cfg.bias, fixed);
      if (nv) {
        values = nv;
        continue;
      }
    }
    // 2) Black out a differing cell and its partner if the layout stays valid.
    let done = false;
    let wc = white.filter(Boolean).length;
    for (const c of shuffle(diff.slice(), rng)) {
      const r = Math.floor(c / cols);
      const cc = c % cols;
      const p = (rows - r) * cols + (cols - cc);
      if (wc - (p === c ? 1 : 2) < minWhite) break;
      white[c] = false;
      white[p] = false;
      if (layoutValid(rows, cols, white)) {
        values = values.slice();
        values[c] = 0;
        values[p] = 0;
        runs = layoutRuns(rows, cols, white);
        blackened++;
        wc -= p === c ? 1 : 2;
        done = true;
        break;
      }
      white[c] = true;
      white[p] = true;
    }
    if (!done) return null;
  }
  return null;
}

export const LEVELS: Record<Difficulty, LevelConfig> = {
  medium: { rows: 7, cols: 7, density: 0.68, maxRun: 6, bias: 0.6, minTier: 0, maxTier: 1 },
  hard: { rows: 9, cols: 9, density: 0.7, maxRun: 7, bias: 0.6, minTier: 1, maxTier: 2 },
  extraHard: { rows: 11, cols: 11, density: 0.64, maxRun: 8, bias: 0.4, minTier: 2, maxTier: 3 },
  extreme: { rows: 13, cols: 13, density: 0.62, maxRun: 9, bias: 0.3, minTier: 3, maxTier: 4 },
};

/**
 * Generate a puzzle for a difficulty. Each attempt builds a layout, fills it,
 * repairs uniqueness and grades it; returns null after `maxAttempts`.
 */
export function generateLevel(
  difficulty: Difficulty,
  rng: Rng,
  maxAttempts: number,
  gradeFn: (p: KakuroPuzzle) => { solved: boolean; maxTier: number },
): KakuroPuzzle | null {
  const cfg = LEVELS[difficulty];
  for (let a = 0; a < maxAttempts; a++) {
    const r = makeUnique(cfg, rng);
    if (!r) continue;
    const g = gradeFn(r.puzzle);
    if (g.solved && g.maxTier >= cfg.minTier && g.maxTier <= cfg.maxTier) return r.puzzle;
  }
  return null;
}
