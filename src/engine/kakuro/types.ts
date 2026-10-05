// Kakuro data types and per-puzzle precomputed structure.

import { rcName } from '../common';

export interface KakuroRun {
  cells: number[]; // white cells of the run, left-to-right or top-to-bottom
  sum: number; // the clue
  dir: 'across' | 'down';
  clueCell: number; // black cell holding the clue (left of / above the run)
}

/** index = r * cols + c. solution is 0 on black cells. JSON-serialisable. */
export interface KakuroPuzzle {
  rows: number;
  cols: number;
  white: boolean[];
  runs: KakuroRun[];
  solution: number[];
}

export type KakuroLayout = Pick<KakuroPuzzle, 'rows' | 'cols' | 'white' | 'runs'>;

/** Precomputed lookups shared by the solver, techniques and hints. */
export interface Ctx {
  rows: number;
  cols: number;
  n: number;
  white: boolean[];
  runs: KakuroRun[];
  cellRuns: number[][]; // run indices containing each cell
  peers: number[][]; // cells sharing a run (excluding self)
  whiteCells: number[];
}

const CTX_CACHE = new WeakMap<KakuroRun[], Ctx>();

export function ctxOf(p: KakuroLayout): Ctx {
  const hit = CTX_CACHE.get(p.runs);
  if (hit && hit.rows === p.rows && hit.cols === p.cols) return hit;
  const n = p.rows * p.cols;
  const cellRuns: number[][] = Array.from({ length: n }, () => []);
  p.runs.forEach((r, i) => r.cells.forEach((c) => cellRuns[c].push(i)));
  const peers: number[][] = Array.from({ length: n }, (_, c) => {
    const s = new Set<number>();
    for (const ri of cellRuns[c]) for (const q of p.runs[ri].cells) if (q !== c) s.add(q);
    return [...s].sort((a, b) => a - b);
  });
  const whiteCells: number[] = [];
  for (let i = 0; i < n; i++) if (p.white[i]) whiteCells.push(i);
  const ctx: Ctx = { rows: p.rows, cols: p.cols, n, white: p.white, runs: p.runs, cellRuns, peers, whiteCells };
  CTX_CACHE.set(p.runs, ctx);
  return ctx;
}

/** Compute the runs (with sum 0) of a black/white layout. Across before down per clue cell, reading order. */
export function layoutRuns(rows: number, cols: number, white: boolean[]): KakuroRun[] {
  const runs: KakuroRun[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (white[i]) continue;
      if (c + 1 < cols && white[i + 1]) {
        const cells: number[] = [];
        for (let k = c + 1; k < cols && white[r * cols + k]; k++) cells.push(r * cols + k);
        if (cells.length >= 2) runs.push({ cells, sum: 0, dir: 'across', clueCell: i });
      }
      if (r + 1 < rows && white[i + cols]) {
        const cells: number[] = [];
        for (let k = r + 1; k < rows && white[k * cols + c]; k++) cells.push(k * cols + c);
        if (cells.length >= 2) runs.push({ cells, sum: 0, dir: 'down', clueCell: i });
      }
    }
  }
  return runs;
}

export const cellName = (ctx: { cols: number }, cell: number) => rcName(cell, ctx.cols);

export function cellListText(ctx: { cols: number }, cells: number[]): string {
  const names = cells.map((c) => rcName(c, ctx.cols));
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function runName(ctx: { cols: number }, run: KakuroRun): string {
  const a = rcName(run.cells[0], ctx.cols);
  const b = rcName(run.cells[run.cells.length - 1], ctx.cols);
  return `the ${run.dir} run ${a}–${b} (clue ${run.sum})`;
}
