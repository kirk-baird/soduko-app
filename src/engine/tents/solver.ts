// Backtracking solver that counts distinct tent layouts (up to `limit`).
//
// A layout is valid when: tents never touch (even diagonally), row/column
// counts match, and trees and tents can be paired one-to-one along orthogonal
// adjacency (checked as a bipartite matching, not just "every tree has a tent
// next to it").

import { Frame, GRASS, PuzzleShape, TENT, UNK, blankCells, hallCheck, makeFrame } from './board';

export function solveShape(p: PuzzleShape, limit = 2): { count: number; solution: number[] | null } {
  const f = makeFrame(p);
  const total = p.rowCounts.reduce((a, b) => a + b, 0);
  if (total !== p.trees.length || p.colCounts.reduce((a, b) => a + b, 0) !== total) return { count: 0, solution: null };
  const cells = blankCells(f);
  for (let i = 0; i < f.g.n; i++) if (cells[i] === UNK && f.treeNbrs[i].length === 0) cells[i] = GRASS;
  let count = 0;
  let solution: number[] | null = null;

  const dfs = (cs: number[]) => {
    if (count >= limit) return;
    if (!propagate(f, cs)) return;
    const pick = choose(f, cs);
    if (pick < 0) {
      count++;
      if (!solution) solution = cs.map((v) => (v === TENT ? 1 : 0));
      return;
    }
    const a = cs.slice();
    a[pick] = TENT;
    dfs(a);
    const b = cs.slice();
    b[pick] = GRASS;
    dfs(b);
  };
  dfs(cells);
  return { count, solution };
}

/** Choose an undecided cell to branch on (-1 when none). */
function choose(f: Frame, cs: number[]): number {
  let best = -1;
  let bestN = 99;
  for (const t of f.trees) {
    let u = 0;
    let tents = 0;
    let first = -1;
    for (const j of f.g.orth[t]) {
      if (cs[j] === UNK) {
        u++;
        if (first < 0) first = j;
      } else if (cs[j] === TENT) tents++;
    }
    if (!tents && u > 0 && u < bestN) {
      bestN = u;
      best = first;
    }
  }
  if (best >= 0) return best;
  for (let i = 0; i < cs.length; i++) if (cs[i] === UNK) return i;
  return -1;
}

/** Unit propagation to a fixpoint. Returns false on contradiction. Mutates `cs`. */
export function propagate(f: Frame, cs: number[]): boolean {
  const { g } = f;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < g.n; i++) {
      if (cs[i] !== TENT) continue;
      for (const j of g.adj8[i]) {
        if (cs[j] === TENT) return false;
        if (cs[j] === UNK) {
          cs[j] = GRASS;
          changed = true;
        }
      }
    }
    for (const line of f.lines) {
      let t = 0;
      let u = 0;
      let maxRun = 0;
      let run = 0;
      for (const c of line.cells) {
        if (cs[c] === UNK) {
          u++;
          run++;
        } else {
          if (cs[c] === TENT) t++;
          maxRun += (run + 1) >> 1;
          run = 0;
        }
      }
      maxRun += (run + 1) >> 1;
      if (t > line.need || t + maxRun < line.need) return false;
      if (!u) continue;
      if (t === line.need) {
        for (const c of line.cells) if (cs[c] === UNK) cs[c] = GRASS;
        changed = true;
      } else if (t + u === line.need) {
        for (const c of line.cells) if (cs[c] === UNK) cs[c] = TENT;
        changed = true;
      }
    }
    for (const tr of f.trees) {
      let u = 0;
      let tents = 0;
      let last = -1;
      for (const j of g.orth[tr]) {
        if (cs[j] === UNK) {
          u++;
          last = j;
        } else if (cs[j] === TENT) tents++;
      }
      if (!tents && !u) return false;
      if (!tents && u === 1) {
        cs[last] = TENT;
        changed = true;
      }
    }
    for (let i = 0; i < g.n; i++) {
      if (cs[i] === TENT && f.treeNbrs[i].length === 0) return false;
    }
  }
  return hallCheck(f, cs) === null;
}

