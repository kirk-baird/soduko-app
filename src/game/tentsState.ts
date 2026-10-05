// Pure game state for Tents: marks, undo, rewind-to-first-mistake, hints.

import { CellDigit, Difficulty } from '../engine/common';
import { EMPTY, GRASS, TENT, TentsPuzzle, isSolved } from '../engine/tents';

export interface TentsMistake {
  cell: number;
  mark: number; // the wrong mark placed
}

export interface TentsGameState {
  id: string;
  type: 'tents';
  payload: TentsPuzzle;
  difficulty: Difficulty;
  marks: number[];
  history: { before: number[]; mistakes: TentsMistake[] }[];
  mistakes: number;
  hintsUsed: number;
  elapsedMs: number;
  completed: boolean;
  savedAt?: number;
}

export type TentsAction =
  | { type: 'cycle'; cell: number }
  | { type: 'undo' }
  | { type: 'rewind' }
  | { type: 'apply'; placements: CellDigit[] } // digit 1 = tent, 2 = grass
  | { type: 'hintShown' };

export function newTentsGame(id: string, difficulty: Difficulty, p: TentsPuzzle): TentsGameState {
  return {
    id,
    type: 'tents',
    payload: p,
    difficulty,
    marks: new Array(p.rows * p.cols).fill(EMPTY),
    history: [],
    mistakes: 0,
    hintsUsed: 0,
    elapsedMs: 0,
    completed: false,
  };
}

const isWrong = (p: TentsPuzzle, cell: number, mark: number) =>
  (mark === TENT && p.solution[cell] !== 1) || (mark === GRASS && p.solution[cell] === 1);

export const wrongMarks = (s: TentsGameState) => s.marks.map((m, i) => (m && isWrong(s.payload, i, m) ? i : -1)).filter((i) => i >= 0);

export function firstTentsMistake(s: TentsGameState): number {
  return s.history.findIndex((h) => h.mistakes.some((m) => s.marks[m.cell] === m.mark));
}

function commit(s: TentsGameState, marks: number[], mistakes: TentsMistake[]): TentsGameState {
  return {
    ...s,
    marks,
    history: [...s.history, { before: s.marks, mistakes }],
    mistakes: s.mistakes + mistakes.length,
    completed: isSolved(s.payload, marks),
  };
}

export function tentsReducer(s: TentsGameState, a: TentsAction): TentsGameState {
  if (a.type === 'hintShown') return { ...s, hintsUsed: s.hintsUsed + 1 };
  if (s.completed) return s;
  const trees = new Set(s.payload.trees);
  switch (a.type) {
    case 'cycle': {
      if (trees.has(a.cell)) return s;
      const marks = s.marks.slice();
      marks[a.cell] = (marks[a.cell] + 1) % 3; // empty -> tent -> grass -> empty
      const m = marks[a.cell];
      return commit(s, marks, m && isWrong(s.payload, a.cell, m) ? [{ cell: a.cell, mark: m }] : []);
    }
    case 'apply': {
      const marks = s.marks.slice();
      const mistakes: TentsMistake[] = [];
      for (const p of a.placements) {
        if (trees.has(p.cell)) continue;
        marks[p.cell] = p.digit;
        if (isWrong(s.payload, p.cell, p.digit)) mistakes.push({ cell: p.cell, mark: p.digit });
      }
      return commit(s, marks, mistakes);
    }
    case 'undo': {
      const last = s.history[s.history.length - 1];
      if (!last) return s;
      return { ...s, marks: last.before, history: s.history.slice(0, -1) };
    }
    case 'rewind': {
      const idx = firstTentsMistake(s);
      if (idx < 0) return s;
      return { ...s, marks: s.history[idx].before, history: s.history.slice(0, idx) };
    }
  }
  return s;
}
