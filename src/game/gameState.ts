// Pure game-state logic: placing digits, pencil marks, undo, rewind-to-first-
// mistake, applying hints. No React here so it can be unit tested.

import { Cands, Grid, PEERS, bit, computeCandidates, has } from '../engine/grid';
import { effectiveCandidates } from '../engine/hint';
import { Difficulty } from '../engine/logic';
import { CellDigit, Step } from '../engine/techniques';

export interface Snapshot {
  values: Grid;
  pencil: Cands;
}

/** A mistake introduced by an action. For 'candidate', digit is the (removed) correct digit. */
export interface Mistake {
  kind: 'value' | 'candidate';
  cell: number;
  digit: number;
}

export interface HistoryEntry {
  before: Snapshot;
  mistakes: Mistake[];
}

export interface GameState {
  id: string;
  difficulty: Difficulty;
  givens: Grid;
  solution: Grid;
  values: Grid;
  pencil: Cands;
  history: HistoryEntry[];
  mistakes: number; // wrong digits placed (counter)
  hintsUsed: number;
  elapsedMs: number;
  completed: boolean;
}

export type GameAction =
  | { type: 'input'; cell: number; digit: number; pencil: boolean }
  | { type: 'erase'; cell: number; autoCandidates: boolean }
  | { type: 'undo' }
  | { type: 'rewind' }
  | { type: 'applyStep'; step: Step }
  | { type: 'autoPlace'; placement: CellDigit }
  | { type: 'fillCandidates' }
  | { type: 'hintShown' }
  | { type: 'setElapsed'; ms: number }
  | { type: 'load'; state: GameState };

export function newGame(id: string, difficulty: Difficulty, givens: Grid, solution: Grid, autoCandidates: boolean): GameState {
  const values = givens.slice();
  return {
    id,
    difficulty,
    givens: givens.slice(),
    solution: solution.slice(),
    values,
    pencil: autoCandidates ? computeCandidates(values) : new Array(81).fill(0),
    history: [],
    mistakes: 0,
    hintsUsed: 0,
    elapsedMs: 0,
    completed: false,
  };
}

const snap = (s: GameState): Snapshot => ({ values: s.values.slice(), pencil: s.pencil.slice() });

const isSolved = (values: Grid, solution: Grid) => values.every((v, i) => v === solution[i]);

/** Place digit (no toggle). Mutates values/pencil; returns mistakes introduced. */
function placeInto(values: Grid, pencil: Cands, solution: Grid, cell: number, digit: number): Mistake[] {
  values[cell] = digit;
  pencil[cell] = 0;
  const b = bit(digit);
  for (const p of PEERS[cell]) pencil[p] &= ~b;
  return digit !== solution[cell] ? [{ kind: 'value', cell, digit }] : [];
}

function commit(s: GameState, before: Snapshot, values: Grid, pencil: Cands, mistakes: Mistake[], extra: Partial<GameState> = {}): GameState {
  return {
    ...s,
    values,
    pencil,
    history: [...s.history, { before, mistakes }],
    mistakes: s.mistakes + mistakes.filter((m) => m.kind === 'value').length,
    completed: isSolved(values, s.solution),
    ...extra,
  };
}

/** Is this recorded mistake still affecting the current board? */
function stillPresent(s: GameState, m: Mistake): boolean {
  if (m.kind === 'value') return s.values[m.cell] === m.digit;
  const p = s.pencil[m.cell];
  return s.values[m.cell] === 0 && p !== 0 && !has(p, m.digit);
}

/** Index of the earliest history entry whose mistake is still on the board, or -1. */
export function firstMistakeIndex(s: GameState): number {
  return s.history.findIndex((h) => h.mistakes.some((m) => stillPresent(s, m)));
}

/** Cells where the player removed the correct candidate and it is still missing. */
export function removedCorrectCells(s: GameState): number[] {
  const out = new Set<number>();
  for (const h of s.history) for (const m of h.mistakes) if (m.kind === 'candidate' && stillPresent(s, m)) out.add(m.cell);
  return [...out];
}

export const wrongCells = (s: GameState) =>
  s.values.map((v, i) => (v && !s.givens[i] && v !== s.solution[i] ? i : -1)).filter((i) => i >= 0);

export function gameReducer(s: GameState, a: GameAction): GameState {
  if (a.type === 'load') return a.state;
  if (a.type === 'setElapsed') return { ...s, elapsedMs: a.ms };
  if (a.type === 'hintShown') return { ...s, hintsUsed: s.hintsUsed + 1 };
  if (s.completed) return s; // a finished game is final

  switch (a.type) {
    case 'input': {
      const { cell, digit } = a;
      if (s.givens[cell]) return s;
      const before = snap(s);
      const values = s.values.slice();
      const pencil = s.pencil.slice();
      if (a.pencil) {
        if (values[cell]) return s;
        const had = has(pencil[cell], digit);
        pencil[cell] ^= bit(digit);
        const mistakes: Mistake[] =
          had && digit === s.solution[cell] ? [{ kind: 'candidate', cell, digit }] : [];
        return commit(s, before, values, pencil, mistakes);
      }
      if (values[cell] === digit) {
        // tapping the same digit again clears it
        values[cell] = 0;
        return commit(s, before, values, pencil, []);
      }
      const mistakes = placeInto(values, pencil, s.solution, cell, digit);
      return commit(s, before, values, pencil, mistakes);
    }

    case 'erase': {
      const { cell } = a;
      if (s.givens[cell]) return s;
      if (!s.values[cell] && !s.pencil[cell]) return s;
      const before = snap(s);
      const values = s.values.slice();
      const pencil = s.pencil.slice();
      const old = values[cell];
      if (old) {
        values[cell] = 0;
        if (a.autoCandidates) {
          const legal = computeCandidates(values);
          pencil[cell] = legal[cell];
          // give the erased digit back to peers that can hold it again
          for (const p of PEERS[cell]) if (!values[p] && has(legal[p], old)) pencil[p] |= bit(old);
        }
      } else {
        pencil[cell] = 0;
      }
      return commit(s, before, values, pencil, []);
    }

    case 'undo': {
      const last = s.history[s.history.length - 1];
      if (!last) return s;
      return {
        ...s,
        values: last.before.values,
        pencil: last.before.pencil,
        history: s.history.slice(0, -1),
        completed: false,
      };
    }

    case 'rewind': {
      const idx = firstMistakeIndex(s);
      if (idx < 0) return s;
      const target = s.history[idx].before;
      return { ...s, values: target.values, pencil: target.pencil, history: s.history.slice(0, idx), completed: false };
    }

    case 'applyStep': {
      const before = snap(s);
      const values = s.values.slice();
      const eff = effectiveCandidates(s.values, s.pencil);
      const pencil = s.pencil.slice();
      for (const e of a.step.eliminations) {
        if (values[e.cell]) continue;
        pencil[e.cell] = (pencil[e.cell] || eff[e.cell]) & ~bit(e.digit);
      }
      const mistakes: Mistake[] = [];
      for (const p of a.step.placements) mistakes.push(...placeInto(values, pencil, s.solution, p.cell, p.digit));
      return commit(s, before, values, pencil, mistakes);
    }

    case 'autoPlace': {
      const { cell, digit } = a.placement;
      if (s.values[cell]) return s;
      const before = snap(s);
      const values = s.values.slice();
      const pencil = s.pencil.slice();
      const mistakes = placeInto(values, pencil, s.solution, cell, digit);
      return commit(s, before, values, pencil, mistakes);
    }

    case 'fillCandidates': {
      const before = snap(s);
      const legal = computeCandidates(s.values);
      const pencil = s.pencil.map((m, i) => (s.values[i] ? 0 : m ? m & legal[i] : legal[i]));
      if (pencil.every((m, i) => m === s.pencil[i])) return s;
      return commit(s, before, s.values.slice(), pencil, []);
    }
  }
  return s;
}
