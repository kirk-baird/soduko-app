// "Only singles left" checks for Calcudoku and Kakuro, kept deliberately
// strict so Auto-finish appears only at the end of a puzzle (their engines'
// basic tiers include combination logic, which is more than a single).

import { CellDigit } from '../engine/common';
import { CalcudokuPuzzle } from '../engine/calcudoku';
import { cageSatisfied } from '../engine/calcudoku/model';
import { KakuroPuzzle } from '../engine/kakuro';

/**
 * Calcudoku: repeatedly place a digit that is forced by its row and column
 * alone (naked or hidden single), or that completes a cage whose other cells
 * are filled. Returns the placements if this fills the grid, else null.
 */
export function calcudokuSingles(p: CalcudokuPuzzle, values: number[]): CellDigit[] | null {
  const n = p.size;
  const v = values.slice();
  const out: CellDigit[] = [];
  const cageOf = new Array(n * n).fill(-1);
  p.cages.forEach((c, k) => c.cells.forEach((i) => (cageOf[i] = k)));
  const lineCands = (i: number) => {
    const r = Math.floor(i / n);
    const c = i % n;
    let m = 0;
    for (let d = 1; d <= n; d++) m |= 1 << d;
    for (let k = 0; k < n; k++) {
      if (v[r * n + k]) m &= ~(1 << v[r * n + k]);
      if (v[k * n + c]) m &= ~(1 << v[k * n + c]);
    }
    return m;
  };
  const place = (cell: number, digit: number) => {
    v[cell] = digit;
    out.push({ cell, digit });
  };
  for (;;) {
    const empties = v.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
    if (!empties.length) return out;
    let progress = false;
    for (const i of empties) {
      const m = lineCands(i);
      // naked single by row/column
      if (m && (m & (m - 1)) === 0) {
        place(i, 31 - Math.clz32(m));
        progress = true;
        break;
      }
      // last empty cell of its cage (or a one-cell cage)
      const cage = p.cages[cageOf[i]];
      const others = cage.cells.filter((c) => c !== i);
      if (others.every((c) => v[c])) {
        const fits = [];
        for (let d = 1; d <= n; d++) {
          if (!(m & (1 << d))) continue;
          const ds = cage.cells.map((c) => (c === i ? d : v[c]));
          if (cageSatisfied(cage.op, cage.target, ds)) fits.push(d);
        }
        if (fits.length === 1) {
          place(i, fits[0]);
          progress = true;
          break;
        }
      }
    }
    if (!progress) {
      // hidden single in a row or column
      outer: for (let line = 0; line < 2 * n; line++) {
        const cells = Array.from({ length: n }, (_, k) => (line < n ? line * n + k : k * n + (line - n)));
        for (let d = 1; d <= n; d++) {
          if (cells.some((c) => v[c] === d)) continue;
          const spots = cells.filter((c) => !v[c] && lineCands(c) & (1 << d));
          if (spots.length === 1) {
            place(spots[0], d);
            progress = true;
            break outer;
          }
        }
      }
    }
    if (!progress) return null;
  }
}

/**
 * Kakuro: repeatedly fill the last empty cell of a run (its clue minus the
 * digits already in it). Returns the placements if this fills the grid.
 */
export function kakuroSingles(p: KakuroPuzzle, values: number[]): CellDigit[] | null {
  const v = values.slice();
  const out: CellDigit[] = [];
  for (;;) {
    const empty = p.white.some((w, i) => w && !v[i]);
    if (!empty) return out;
    let progress = false;
    for (const run of p.runs) {
      const missing = run.cells.filter((c) => !v[c]);
      if (missing.length !== 1) continue;
      const d = run.sum - run.cells.reduce((a, c) => a + v[c], 0);
      if (d < 1 || d > 9 || run.cells.some((c) => v[c] === d)) return null;
      v[missing[0]] = d;
      out.push({ cell: missing[0], digit: d });
      progress = true;
      break;
    }
    if (!progress) return null;
  }
}
