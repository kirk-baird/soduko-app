// Hints computed from the player's *own* candidate set.
//
// Order of checks:
//   1. a placed digit is wrong
//   2. a cell's pencil marks no longer contain the correct digit
//   3. pencil marks that conflict with a placed digit (clean-up)
//   4. the easiest technique that applies to the player's candidates
//
// Empty cells with no pencil marks at all are treated as holding every digit
// not already used by a peer, so players who haven't pencilled everything
// still get sound hints.

import { Cands, Grid, PEERS, cellList, cellName, computeCandidates, has } from './grid';
import { CellDigit, State, Step, findStep } from './techniques';

export type Hint =
  | { kind: 'wrongValue'; cells: number[]; message: string }
  | { kind: 'missingCandidate'; cells: number[]; message: string }
  | { kind: 'step'; step: Step; cands: Cands }
  | { kind: 'solved'; message: string }
  | { kind: 'reveal'; cell: number; digit: number; message: string };

export function effectiveCandidates(values: Grid, pencil: Cands): Cands {
  const legal = computeCandidates(values);
  return values.map((v, i) => (v ? 0 : pencil[i] ? pencil[i] : legal[i]));
}

/**
 * @param removedCorrect cells where the player explicitly removed the correct
 *   candidate and it is still missing. Other cells whose marks lack the correct
 *   digit are treated as unfinished (e.g. marks being added one at a time) and
 *   reasoned about as if they had every legal candidate.
 */
export function findHint(values: Grid, pencil: Cands, solution: Grid, removedCorrect: number[] = []): Hint {
  if (values.every((v, i) => v === solution[i])) return { kind: 'solved', message: 'The puzzle is solved!' };

  const wrong = values.map((v, i) => (v && v !== solution[i] ? i : -1)).filter((i) => i >= 0);
  if (wrong.length) {
    return {
      kind: 'wrongValue',
      cells: wrong,
      message:
        wrong.length === 1
          ? `${cellName(wrong[0])} contains the wrong digit. Fix that first — logic built on it will go astray.`
          : `${wrong.length} placed digits are wrong (${cellList(wrong)}). Fix those first.`,
    };
  }

  const legal = computeCandidates(values);
  const cands = effectiveCandidates(values, pencil);
  const missing = cands.map((m, i) => (!values[i] && !has(m, solution[i]) ? i : -1)).filter((i) => i >= 0);
  const removed = missing.filter((i) => removedCorrect.includes(i));
  if (removed.length) {
    return {
      kind: 'missingCandidate',
      cells: removed,
      message:
        `You removed the correct digit from the pencil marks in ${cellList(removed)}. ` +
        `Rewind to the first mistake, or re-check the candidates in ${removed.length === 1 ? 'that cell' : 'those cells'}.`,
    };
  }
  // Incomplete marks: reason about those cells as if they were unmarked.
  for (const i of missing) cands[i] = legal[i];

  // Clean-up: pencil marks that a placed peer already rules out.
  const conflicts: CellDigit[] = [];
  const examples: string[] = [];
  for (let i = 0; i < 81; i++) {
    if (values[i] || !pencil[i]) continue;
    for (const p of PEERS[i]) {
      const d = values[p];
      if (d && has(pencil[i], d) && !conflicts.some((c) => c.cell === i && c.digit === d)) {
        conflicts.push({ cell: i, digit: d });
        if (examples.length < 3) examples.push(`${d} from ${cellName(i)} (${cellName(p)} is ${d})`);
      }
    }
  }
  if (conflicts.length) {
    return {
      kind: 'step',
      step: {
        technique: 'cleanup',
        placements: [],
        eliminations: conflicts,
        pattern: [...new Set(conflicts.map((c) => c.cell))],
        keys: [],
        units: [],
        explanation:
          `Some pencil marks clash with digits already placed in the same row, column or box. ` +
          `Remove ${examples.join('; ')}${conflicts.length > examples.length ? ` and ${conflicts.length - examples.length} more` : ''}.`,
      },
      cands,
    };
  }

  const state: State = { values, cands };
  const st = findStep(state);
  if (st) return { kind: 'step', step: st, cands };

  // No technique applies (beyond the engine's repertoire): reveal a cell.
  const cell = values.findIndex((v) => v === 0);
  return {
    kind: 'reveal',
    cell,
    digit: solution[cell],
    message: `No logical step found with the techniques I know. ${cellName(cell)} is ${solution[cell]}.`,
  };
}
