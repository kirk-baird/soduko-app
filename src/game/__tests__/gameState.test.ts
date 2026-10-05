import { describe, expect, it } from 'vitest';
import { bit, computeCandidates, has, parseGrid } from '../../engine/grid';
import { findHint } from '../../engine/hint';
import { GameAction, GameState, firstMistakeIndex, gameReducer, newGame } from '../gameState';

const PUZZLE = parseGrid('53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79');
const SOLUTION = parseGrid('534678912672195348198342567859761423426853791713924856961537284287419635345286179');

const run = (s: GameState, ...actions: GameAction[]) => actions.reduce(gameReducer, s);
const fresh = (auto = false) => newGame('t', 'medium', PUZZLE, SOLUTION, auto);

// R1C3 (index 2) = 4, R1C4 (3) = 6, R2C2 (10) = 7
describe('game state', () => {
  it('places digits, removes them from peer pencil marks, and counts mistakes', () => {
    let s = fresh(true);
    expect(has(s.pencil[11], 4)).toBe(true); // R2C3 shares box with R1C3
    s = run(s, { type: 'input', cell: 2, digit: 4, pencil: false });
    expect(s.values[2]).toBe(4);
    expect(has(s.pencil[11], 4)).toBe(false);
    expect(s.mistakes).toBe(0);
    s = run(s, { type: 'input', cell: 3, digit: 2, pencil: false }); // wrong (6)
    expect(s.mistakes).toBe(1);
  });

  it('does not let givens change', () => {
    const s = run(fresh(), { type: 'input', cell: 0, digit: 9, pencil: false }, { type: 'erase', cell: 0, autoCandidates: false });
    expect(s.values[0]).toBe(5);
    expect(s.history.length).toBe(0);
  });

  it('undo steps back one action', () => {
    const s = run(fresh(), { type: 'input', cell: 2, digit: 4, pencil: false }, { type: 'input', cell: 3, digit: 6, pencil: false }, { type: 'undo' });
    expect(s.values[2]).toBe(4);
    expect(s.values[3]).toBe(0);
  });

  it('rewinds to just before the first mistake still on the board', () => {
    let s = run(
      fresh(),
      { type: 'input', cell: 2, digit: 4, pencil: false }, // ok
      { type: 'input', cell: 3, digit: 2, pencil: false }, // mistake (should be 6)
      { type: 'input', cell: 10, digit: 7, pencil: false }, // ok
      { type: 'input', cell: 5, digit: 1, pencil: false }, // mistake (should be 8)
    );
    expect(firstMistakeIndex(s)).toBe(1);
    s = run(s, { type: 'rewind' });
    expect(s.values[2]).toBe(4);
    expect(s.values[3]).toBe(0);
    expect(s.values[10]).toBe(0);
    expect(s.mistakes).toBe(2); // the counter keeps its history
    expect(firstMistakeIndex(s)).toBe(-1);
  });

  it('ignores mistakes the player already fixed', () => {
    const s = run(
      fresh(),
      { type: 'input', cell: 3, digit: 2, pencil: false }, // mistake
      { type: 'input', cell: 3, digit: 6, pencil: false }, // fixed
      { type: 'input', cell: 10, digit: 3, pencil: false }, // mistake (should be 7)
    );
    expect(firstMistakeIndex(s)).toBe(2);
  });

  it('treats removing the correct candidate as a mistake', () => {
    let s = fresh(true);
    expect(has(s.pencil[2], 4)).toBe(true);
    s = run(s, { type: 'input', cell: 2, digit: 4, pencil: true }); // toggles the correct 4 off
    expect(firstMistakeIndex(s)).toBe(0);
    expect(s.mistakes).toBe(1); // counts as a mistake
    s = run(s, { type: 'input', cell: 2, digit: 4, pencil: true }); // back on
    expect(firstMistakeIndex(s)).toBe(-1);
  });

  it('adding pencil marks one at a time is never a mistake', () => {
    const s = run(fresh(false), { type: 'input', cell: 2, digit: 1, pencil: true }, { type: 'input', cell: 2, digit: 2, pencil: true });
    expect(firstMistakeIndex(s)).toBe(-1);
  });

  it('applies a hint step even when the cell had no pencil marks', () => {
    const s0 = fresh(false);
    const h = findHint(s0.values, s0.pencil, SOLUTION);
    expect(h.kind).toBe('step');
    if (h.kind !== 'step') return;
    const s = run(s0, { type: 'applyStep', step: h.step });
    for (const p of h.step.placements) expect(s.values[p.cell]).toBe(p.digit);
  });

  it('elimination hints materialise effective candidates', () => {
    const s0 = fresh(false);
    const step = {
      technique: 'pointing' as const,
      placements: [],
      eliminations: [{ cell: 2, digit: 1 }],
      pattern: [],
      keys: [],
      units: [],
      explanation: '',
    };
    const s = run(s0, { type: 'applyStep', step });
    expect(s.pencil[2]).toBe(computeCandidates(PUZZLE)[2] & ~bit(1));
  });

  it('erasing a digit in auto-candidate mode restores candidates', () => {
    let s = fresh(true);
    s = run(s, { type: 'input', cell: 2, digit: 4, pencil: false });
    expect(has(s.pencil[11], 4)).toBe(false);
    s = run(s, { type: 'erase', cell: 2, autoCandidates: true });
    expect(s.values[2]).toBe(0);
    expect(has(s.pencil[2], 4)).toBe(true);
    expect(has(s.pencil[11], 4)).toBe(true);
  });

  it('completes and then locks the game', () => {
    let s = fresh();
    for (let i = 0; i < 81; i++) if (!s.values[i]) s = run(s, { type: 'autoPlace', placement: { cell: i, digit: SOLUTION[i] } });
    expect(s.completed).toBe(true);
    const after = run(s, { type: 'undo' });
    expect(after).toBe(s);
  });

  it('fillCandidates fills empty cells and trims existing marks', () => {
    let s = run(fresh(false), { type: 'input', cell: 2, digit: 5, pencil: true }, { type: 'input', cell: 2, digit: 4, pencil: true });
    s = run(s, { type: 'fillCandidates' });
    expect(s.pencil[2]).toBe(bit(4)); // 5 is illegal (row has 5); 4 kept
    expect(s.pencil[3]).toBe(computeCandidates(PUZZLE)[3]);
  });

  it('rewinds to the first wrong candidate elimination, even before a later wrong digit', () => {
    let s = run(
      fresh(true),
      { type: 'input', cell: 3, digit: 6, pencil: false }, // ok
      { type: 'input', cell: 2, digit: 4, pencil: true }, // removes the correct candidate 4 from R1C3
      { type: 'input', cell: 10, digit: 7, pencil: false }, // ok
      { type: 'input', cell: 5, digit: 1, pencil: false }, // wrong digit (should be 8)
    );
    expect(s.mistakes).toBe(2);
    expect(firstMistakeIndex(s)).toBe(1);
    s = run(s, { type: 'rewind' });
    expect(s.values[3]).toBe(6); // work before the mistake is kept
    expect(has(s.pencil[2], 4)).toBe(true); // the eliminated candidate is back
    expect(s.values[10]).toBe(0);
    expect(s.values[5]).toBe(0);
    expect(firstMistakeIndex(s)).toBe(-1);
    expect(s.mistakes).toBe(2); // the counter keeps its total
  });
});
