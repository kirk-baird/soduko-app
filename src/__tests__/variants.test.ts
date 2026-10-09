import { describe, expect, it } from 'vitest';
import { DIFFICULTY_ORDER, Difficulty } from '../engine/common';
import { DIFFICULTY_TIER, applyStep, grade } from '../engine/logic';
import { makeRng } from '../engine/rng';
import { solve } from '../engine/solver';
import { legalCandidates } from '../engine/sudoku/core';
import { geometryFor } from '../engine/sudoku/geometry';
import { generateVariant, randomJigsawRegions } from '../engine/generator';
import { State, TECHNIQUES, findStep } from '../engine/techniques';
import { PipsPuzzle, findHint as pipsHint, isSolved as pipsSolved } from '../engine/pips';
import { TENT, GRASS, TentsPuzzle } from '../engine/tents';
import { gameReducer, makeGameReducer, newGame } from '../game/gameState';
import { dropSpot, firstPipsMistake, newPipsGame, occupancy, pipsReducer, turnSpot } from '../game/pipsState';
import { firstTentsMistake, newTentsGame, tentsReducer } from '../game/tentsState';
import { GAMES, SudokuPayload } from '../games/registry';
import { GAME_TYPES } from '../games/types';

describe('geometry', () => {
  it('builds the expected units and peers', () => {
    const classic = geometryFor('classic');
    expect(classic.units.length).toBe(27);
    expect(classic.peers.every((p) => p.length === 20)).toBe(true);

    const windoku = geometryFor('windoku');
    expect(windoku.units.length).toBe(31);
    expect(windoku.shaded.filter(Boolean).length).toBe(36);

    const sixteen = geometryFor('sixteen');
    expect(sixteen.cellCount).toBe(256);
    expect(sixteen.peers[0].length).toBe(15 + 15 + 9);
    expect(sixteen.symbol(10)).toBe('A');
    expect(sixteen.symbol(16)).toBe('G');

    const samurai = geometryFor('samurai');
    expect(samurai.cellCount).toBe(369);
    expect(samurai.units.length).toBe(5 * 27 - 4); // shared corner boxes counted once
    expect(samurai.lineGroups.length).toBe(5);

    const regions = randomJigsawRegions(makeRng(3));
    const jig = geometryFor('jigsaw', regions);
    expect(jig.units.filter((_, u) => jig.unitKind[u] === 'region').every((u) => true)).toBe(true);
    for (let k = 0; k < 9; k++) expect(regions.filter((r) => r === k).length).toBe(9);
  });
});

/** Walk the logical solve; at every state check every technique against the solution. */
function checkSoundness(payload: SudokuPayload) {
  const g = geometryFor(payload.variant, payload.regions);
  let s: State = { values: payload.givens.slice(), cands: legalCandidates(g, payload.givens) };
  for (let guard = 0; guard < 400; guard++) {
    if (s.values.every((v) => v)) break;
    for (const t of TECHNIQUES) {
      const st = t.find(s, g);
      if (!st) continue;
      for (const p of st.placements) expect(payload.solution[p.cell], `${t.id} placement`).toBe(p.digit);
      for (const e of st.eliminations) expect(payload.solution[e.cell], `${t.id} elimination`).not.toBe(e.digit);
    }
    const st = findStep(s, 4, g);
    if (!st) break;
    s = applyStep(s, st, g);
  }
}

describe('variant technique soundness', () => {
  for (const [variant, n] of [
    ['windoku', 12],
    ['jigsaw', 12],
    ['sixteen', 3],
    ['samurai', 2],
  ] as const) {
    it(`never contradicts the solution on ${variant}`, () => {
      const def = GAMES[variant];
      const bank = def.bank();
      for (const d of DIFFICULTY_ORDER) {
        for (const e of (bank[d] ?? []).slice(0, n)) checkSoundness(def.fromBank(e) as SudokuPayload);
      }
    });
  }
});

describe('variant banks', () => {
  for (const variant of ['windoku', 'jigsaw', 'sixteen', 'samurai'] as const) {
    it(`${variant} bank puzzles are unique and graded to their level`, () => {
      const def = GAMES[variant];
      const bank = def.bank();
      for (const d of DIFFICULTY_ORDER) {
        const list = (bank[d] ?? []).slice(0, variant === 'samurai' ? 3 : 8);
        for (const e of list) {
          const p = def.fromBank(e) as SudokuPayload;
          const g = geometryFor(p.variant, p.regions);
          const gr = grade(p.givens, 4, g);
          expect(gr.solved).toBe(true);
          expect(gr.maxTier).toBe(DIFFICULTY_TIER[d as Difficulty]);
          if (g.cellCount === 81) expect(solve(p.givens, 2, undefined, g).count).toBe(1);
          // the stored solution satisfies the givens
          p.givens.forEach((v, i) => v && expect(p.solution[i]).toBe(v));
        }
      }
    });
  }

  it('generates a windoku puzzle on demand', () => {
    const rng = makeRng(99);
    let p = null;
    for (let i = 0; i < 20 && !p; i++) p = generateVariant('windoku', 'medium', rng);
    expect(p).not.toBeNull();
  });
});

describe('registry', () => {
  for (const type of GAME_TYPES) {
    it(`${type}: bank loads and the first puzzle works end to end`, () => {
      const def = GAMES[type];
      const bank = def.bank();
      for (const d of DIFFICULTY_ORDER) expect((bank[d] ?? []).length, `${type} ${d}`).toBeGreaterThan(0);
      const payload = def.fromBank(bank.medium[0]);
      if (def.kind === 'tents') {
        const g = newTentsGame('t', 'medium', payload as TentsPuzzle);
        expect(g.marks.length).toBe((payload as TentsPuzzle).rows * (payload as TentsPuzzle).cols);
        return;
      }
      if (def.kind === 'pips') {
        const pp = payload as PipsPuzzle;
        const g = newPipsGame('p', 'medium', pp);
        expect(g.place.every((x) => x === null)).toBe(true);
        expect(pipsSolved(pp, pp.solution)).toBe(true);
        expect(pipsHint(pp, g.place).kind).toBe('step');
        return;
      }
      const a = def.adapter!(payload);
      expect(a.layout.pos.length).toBe(a.rules.cellCount);
      const legal = a.rules.legalCandidates(a.givens);
      a.solution.forEach((v, i) => {
        if (a.rules.playable[i] && !a.givens[i]) expect((legal[i] >> v) & 1, `cell ${i}`).toBe(1);
      });
      const h = a.hint(a.givens, new Array(a.rules.cellCount).fill(0), []);
      expect(['step', 'reveal']).toContain(h.kind);
      if (h.kind === 'step') {
        for (const p of h.step.placements) expect(a.solution[p.cell]).toBe(p.digit);
        for (const e of h.step.eliminations) expect(a.solution[e.cell]).not.toBe(e.digit);
        expect(h.step.name.length).toBeGreaterThan(2);
      }
      // reducer works with this puzzle's rules
      const reducer = makeGameReducer(a.rules);
      let s = newGame('x', 'medium', a.givens, a.solution, true, { type, payload, rules: a.rules });
      const cell = a.solution.findIndex((v, i) => v && !a.givens[i] && a.rules.playable[i]);
      s = reducer(s, { type: 'input', cell, digit: a.solution[cell], pencil: false });
      expect(s.values[cell]).toBe(a.solution[cell]);
      for (const q of a.rules.peers[cell]) expect((s.pencil[q] >> a.solution[cell]) & 1).toBe(0);
      expect(s.mistakes).toBe(0);
    });
  }

  it('classic reducer still defaults to classic rules', () => {
    const def = GAMES.classic;
    const payload = def.fromBank(def.bank().medium[0]) as SudokuPayload;
    const s = newGame('c', 'medium', payload.givens, payload.solution, false);
    const cell = payload.givens.findIndex((v) => !v);
    expect(gameReducer(s, { type: 'input', cell, digit: payload.solution[cell], pencil: false }).values[cell]).toBe(payload.solution[cell]);
  });
});

describe('tents game state', () => {
  const def = GAMES.tents;
  const p = def.fromBank(def.bank().medium[0]) as TentsPuzzle;
  const tentCell = p.solution.findIndex((x) => x === 1);
  const emptyCell = p.solution.findIndex((x, i) => x === 0 && !p.trees.includes(i));

  it('cycles tent -> grass -> empty and tracks mistakes', () => {
    let s = newTentsGame('t', 'medium', p);
    s = tentsReducer(s, { type: 'cycle', cell: tentCell });
    expect(s.marks[tentCell]).toBe(TENT);
    expect(s.mistakes).toBe(0);
    s = tentsReducer(s, { type: 'cycle', cell: tentCell });
    expect(s.marks[tentCell]).toBe(GRASS); // grass on a tent cell is a mistake
    expect(s.mistakes).toBe(1);
    expect(firstTentsMistake(s)).toBe(1);
    s = tentsReducer(s, { type: 'rewind' });
    expect(s.marks[tentCell]).toBe(TENT);
    s = tentsReducer(s, { type: 'cycle', cell: emptyCell });
    expect(s.mistakes).toBe(2); // tent where there is none
    s = tentsReducer(s, { type: 'undo' });
    expect(s.marks[emptyCell]).toBe(0);
  });

  it('ignores taps on trees and completes when all tents are placed', () => {
    let s = newTentsGame('t', 'medium', p);
    s = tentsReducer(s, { type: 'cycle', cell: p.trees[0] });
    expect(s.history.length).toBe(0);
    const tents = p.solution.map((x, i) => (x === 1 ? i : -1)).filter((i) => i >= 0);
    s = tentsReducer(s, { type: 'apply', placements: tents.map((cell) => ({ cell, digit: TENT })) });
    expect(s.completed).toBe(true);
  });
});

describe('pips game state', () => {
  const def = GAMES.pips;
  const p = def.fromBank(def.bank().hard[0]) as PipsPuzzle;
  // a domino whose halves differ, so a flipped spot can be wrong
  const k = p.dominoes.findIndex(([a, b], i) => a !== b && !p.regions.some((r) => r.cells.includes(p.solution[i][0]) && r.cells.includes(p.solution[i][1])));

  it('puts dominoes down, tracks mistakes, rewinds and undoes', () => {
    let s = newPipsGame('p', 'hard', p);
    s = pipsReducer(s, { type: 'put', k, spot: p.solution[k] });
    expect(s.place[k]).toEqual(p.solution[k]);
    expect(s.mistakes).toBe(0);
    const flipped: [number, number] = [p.solution[k][1], p.solution[k][0]];
    s = pipsReducer(s, { type: 'put', k, spot: flipped });
    expect(s.mistakes).toBe(1);
    expect(firstPipsMistake(s)).toBe(1);
    s = pipsReducer(s, { type: 'rewind' });
    expect(s.place[k]).toEqual(p.solution[k]);
    s = pipsReducer(s, { type: 'put', k, spot: null });
    expect(s.place[k]).toBeNull();
    s = pipsReducer(s, { type: 'undo' });
    expect(s.place[k]).toEqual(p.solution[k]);
  });

  it('bumps a domino back to the tray when another lands on it', () => {
    let s = newPipsGame('p', 'hard', p);
    s = pipsReducer(s, { type: 'put', k: 0, spot: p.solution[0] });
    s = pipsReducer(s, { type: 'put', k: 1, spot: p.solution[0] });
    expect(s.place[0]).toBeNull();
    expect(occupancy(s.place).get(p.solution[0][0])).toBe(1);
  });

  it('drops next to the tapped cell and turns through every orientation', () => {
    let s = newPipsGame('p', 'hard', p);
    const cell = p.solution[k][0];
    const spot = dropSpot(s, k, cell)!;
    expect(spot[0]).toBe(cell);
    s = pipsReducer(s, { type: 'put', k, spot });
    const seen = new Set<string>([spot.join()]);
    for (let i = 0; i < 4; i++) {
      const next = turnSpot(s, k)!;
      expect(p.cells).toContain(next[0]);
      expect(p.cells).toContain(next[1]);
      seen.add(next.join());
      s = pipsReducer(s, { type: 'put', k, spot: next });
    }
    expect(seen.size).toBeGreaterThanOrEqual(2); // at least a flip in place
  });

  it('completes when every domino is down', () => {
    let s = newPipsGame('p', 'hard', p);
    p.solution.forEach((spot, i) => (s = pipsReducer(s, { type: 'put', k: i, spot })));
    expect(s.completed).toBe(true);
    expect(s.mistakes).toBe(0);
  });
});

describe('auto-finish only near the end', () => {
  for (const type of ['classic', 'windoku', 'calcudoku', 'kakuro'] as const) {
    it(`${type}: not offered on fresh Medium puzzles, offered when nearly solved`, () => {
      const def = GAMES[type];
      const list = def.bank().medium.slice(0, 15);
      let offeredAtStart = 0;
      for (const e of list) {
        const a = def.adapter!(def.fromBank(e));
        if (a.finish(a.givens)) offeredAtStart++;
        // nearly solved: blank out three solution cells
        const near = a.solution.slice();
        const playable = a.solution.map((v, i) => (v && a.rules.playable[i] && !a.givens[i] ? i : -1)).filter((i) => i >= 0);
        for (const i of playable.slice(0, 3)) near[i] = 0;
        const f = a.finish(near);
        expect(f, `${type} near-solved`).not.toBeNull();
        for (const p of f!) expect(a.solution[p.cell]).toBe(p.digit);
      }
      expect(offeredAtStart).toBe(0);
    });
  }
});
