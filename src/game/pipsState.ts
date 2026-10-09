// Pure game state for Pips: domino placement, turning, undo,
// rewind-to-first-mistake, hints.

import { Difficulty } from '../engine/common';
import { PipsPuzzle, Placement, Spot, isSolved, isWrongSpot } from '../engine/pips';

export interface PipsMistake {
  k: number; // domino
  spot: Spot; // where it was wrongly put
}

export interface PipsGameState {
  id: string;
  type: 'pips';
  payload: PipsPuzzle;
  difficulty: Difficulty;
  place: Placement; // per domino: its spot, or null while in the tray
  history: { before: Placement; mistakes: PipsMistake[] }[];
  mistakes: number;
  hintsUsed: number;
  elapsedMs: number;
  completed: boolean;
  savedAt?: number;
}

export type PipsAction =
  | { type: 'put'; k: number; spot: Spot | null } // null takes it back to the tray
  | { type: 'undo' }
  | { type: 'rewind' }
  | { type: 'hintShown' };

export function newPipsGame(id: string, difficulty: Difficulty, p: PipsPuzzle): PipsGameState {
  return {
    id,
    type: 'pips',
    payload: p,
    difficulty,
    place: p.dominoes.map(() => null),
    history: [],
    mistakes: 0,
    hintsUsed: 0,
    elapsedMs: 0,
    completed: false,
  };
}

const sameCells = (a: Spot | null, b: Spot) => !!a && a[0] === b[0] && a[1] === b[1];

export const wrongPlaced = (s: PipsGameState) =>
  s.place.map((spot, k) => (spot && isWrongSpot(s.payload, k, spot) ? k : -1)).filter((k) => k >= 0);

export function firstPipsMistake(s: PipsGameState): number {
  return s.history.findIndex((h) => h.mistakes.some((m) => sameCells(s.place[m.k], m.spot)));
}

/** Which domino covers each cell (grid index -> domino). */
export function occupancy(place: Placement): Map<number, number> {
  const out = new Map<number, number>();
  place.forEach((spot, k) => {
    if (!spot) return;
    out.set(spot[0], k);
    out.set(spot[1], k);
  });
  return out;
}

export function pipsReducer(s: PipsGameState, a: PipsAction): PipsGameState {
  if (a.type === 'hintShown') return { ...s, hintsUsed: s.hintsUsed + 1 };
  if (s.completed) return s;
  switch (a.type) {
    case 'put': {
      const cur = s.place[a.k];
      if (a.spot === null ? !cur : sameCells(cur, a.spot)) return s;
      const cells = new Set(s.payload.cells);
      if (a.spot && (!cells.has(a.spot[0]) || !cells.has(a.spot[1]) || a.spot[0] === a.spot[1])) return s;
      const place = s.place.slice();
      place[a.k] = a.spot;
      // Anything already on those cells goes back to the tray.
      if (a.spot) {
        place.forEach((sp, j) => {
          if (j !== a.k && sp && (a.spot!.includes(sp[0]) || a.spot!.includes(sp[1]))) place[j] = null;
        });
      }
      const mistakes = a.spot && isWrongSpot(s.payload, a.k, a.spot) ? [{ k: a.k, spot: a.spot }] : [];
      return {
        ...s,
        place,
        history: [...s.history, { before: s.place, mistakes }],
        mistakes: s.mistakes + mistakes.length,
        completed: isSolved(s.payload, place),
      };
    }
    case 'undo': {
      const last = s.history[s.history.length - 1];
      if (!last) return s;
      return { ...s, place: last.before, history: s.history.slice(0, -1) };
    }
    case 'rewind': {
      const idx = firstPipsMistake(s);
      if (idx < 0) return s;
      return { ...s, place: s.history[idx].before, history: s.history.slice(0, idx) };
    }
  }
  return s;
}

// ---------- moving dominoes (pure helpers for the screen) ----------

const DIRS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/** The cell next to `cell` in direction `dir` (right, down, left, up), or -1 off the board. */
function step(p: PipsPuzzle, cell: number, dir: number): number {
  const r = Math.floor(cell / p.cols) + DIRS[dir][0];
  const c = (cell % p.cols) + DIRS[dir][1];
  if (r < 0 || c < 0 || r >= p.rows || c >= p.cols) return -1;
  const j = r * p.cols + c;
  return p.cells.includes(j) ? j : -1;
}

/**
 * Where domino k lands when dropped with its first half on `cell`: the second
 * half goes right, else down, left or up, preferring empty cells. Null if
 * `cell` has no neighbour on the board.
 */
export function dropSpot(s: PipsGameState, k: number, cell: number): Spot | null {
  const occ = occupancy(s.place);
  const free = (j: number) => j >= 0 && (!occ.has(j) || occ.get(j) === k);
  const nbrs = [0, 1, 2, 3].map((d) => step(s.payload, cell, d)).filter((j) => j >= 0);
  const pick = nbrs.find(free) ?? nbrs[0];
  return pick === undefined ? null : [cell, pick];
}

/**
 * Turns a placed domino a quarter turn clockwise, keeping its top-left cell
 * fixed: a|b across, then a over b, then b|a, then b over a. Positions that
 * are off the board or taken by another domino are skipped; flipping in place
 * is always possible.
 */
export function turnSpot(s: PipsGameState, k: number): Spot | null {
  const cur = s.place[k];
  if (!cur) return null;
  const p = s.payload;
  const occ = occupancy(s.place);
  const free = (j: number) => j >= 0 && (!occ.has(j) || occ.get(j) === k);
  const anchor = Math.min(cur[0], cur[1]);
  const other = Math.max(cur[0], cur[1]);
  const across = other === anchor + 1;
  const firstOnAnchor = cur[0] === anchor;
  // Orientation index: 0 a|b, 1 a/b, 2 b|a, 3 b/a (a = first half).
  const now = (across ? 0 : 1) + (firstOnAnchor ? 0 : 2);
  for (let t = 1; t <= 4; t++) {
    const o = (now + t) % 4;
    const second = step(p, anchor, o % 2 === 0 ? 0 : 1);
    if (!free(second)) continue;
    return o < 2 ? [anchor, second] : [second, anchor];
  }
  return [cur[1], cur[0]];
}
