import { describe, expect, it } from 'vitest';
import { generateForDifficulty, generateMinimal } from '../generator';
import { ALL_DIGITS, bit, computeCandidates, gridToString, parseGrid } from '../grid';
import { findHint } from '../hint';
import { applyStep, grade, singlesFinish } from '../logic';
import { makeRng } from '../rng';
import { solve } from '../solver';
import { State, TECHNIQUES, TechniqueId, findStep } from '../techniques';

const CLASSIC = '53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79';
const CLASSIC_SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';

describe('solver', () => {
  it('solves a known puzzle uniquely', () => {
    const r = solve(parseGrid(CLASSIC));
    expect(r.count).toBe(1);
    expect(gridToString(r.solution!)).toBe(CLASSIC_SOLUTION);
  });

  it('detects multiple solutions', () => {
    const g = parseGrid(CLASSIC);
    g[0] = 0;
    g[1] = 0;
    g[4] = 0;
    g[9] = 0;
    expect(solve(g).count).toBeGreaterThanOrEqual(1);
    expect(solve(new Array(81).fill(0)).count).toBe(2);
  });

  it('rejects inconsistent grids', () => {
    const g = parseGrid(CLASSIC);
    g[2] = 5; // duplicate 5 in row 1
    expect(solve(g).count).toBe(0);
  });
});

describe('technique soundness', () => {
  // Walk the solving path of many random puzzles; at each state, run every
  // technique and check its deduction against the known solution.
  const rng = makeRng(2024);
  const fired = new Set<TechniqueId>();
  const PUZZLES = 400;

  it(`never contradicts the solution across ${PUZZLES} puzzles`, () => {
    for (let n = 0; n < PUZZLES; n++) {
      const { puzzle, solution } = generateMinimal(rng);
      let s: State = { values: puzzle.slice(), cands: computeCandidates(puzzle) };
      for (let guard = 0; guard < 200; guard++) {
        if (s.values.every((v) => v)) break;
        for (const t of TECHNIQUES) {
          const st = t.find(s);
          if (!st) continue;
          fired.add(t.id);
          for (const p of st.placements) {
            if (solution[p.cell] !== p.digit) {
              throw new Error(`${t.id} placed ${p.digit} at ${p.cell} (solution ${solution[p.cell]})\n${st.explanation}`);
            }
          }
          for (const e of st.eliminations) {
            if (solution[e.cell] === e.digit) {
              throw new Error(`${t.id} eliminated the solution ${e.digit} at ${e.cell}\n${st.explanation}`);
            }
            if (!(s.cands[e.cell] & bit(e.digit))) throw new Error(`${t.id} eliminated a non-candidate`);
          }
          expect(st.placements.length + st.eliminations.length).toBeGreaterThan(0);
          expect(st.explanation.length).toBeGreaterThan(10);
        }
        const st = findStep(s);
        if (!st) break;
        s = applyStep(s, st);
      }
    }
  });

  it('exercises most techniques', () => {
    const notFired = TECHNIQUES.map((t) => t.id).filter((id) => !fired.has(id));
    // Jellyfish / hidden quads are genuinely rare; everything else should appear.
    expect(notFired.filter((id) => !['jellyfish', 'hiddenQuad', 'nakedQuad'].includes(id))).toEqual([]);
  });
});

describe('grading', () => {
  it('grades the classic puzzle as singles-only', () => {
    const g = grade(parseGrid(CLASSIC));
    expect(g.solved).toBe(true);
    expect(g.maxTier).toBe(0);
  });

  it('generates puzzles for each difficulty', () => {
    const rng = makeRng(7);
    for (const [d, tier] of [
      ['medium', 1],
      ['hard', 2],
      ['extraHard', 3],
      ['extreme', 4],
    ] as const) {
      const p = generateForDifficulty(d, rng, 500);
      expect(p, d).not.toBeNull();
      expect(solve(p!.puzzle).count).toBe(1);
      expect(grade(p!.puzzle).maxTier).toBe(tier);
    }
  });
});

describe('singlesFinish', () => {
  it('finishes a singles-only puzzle', () => {
    const placements = singlesFinish(parseGrid(CLASSIC));
    expect(placements).not.toBeNull();
    const g = parseGrid(CLASSIC);
    for (const p of placements!) g[p.cell] = p.digit;
    expect(gridToString(g)).toBe(CLASSIC_SOLUTION);
  });

  it('returns null when more than singles are needed', () => {
    const p = generateForDifficulty('hard', makeRng(11), 500)!;
    expect(singlesFinish(p.puzzle)).toBeNull();
  });
});

describe('hints', () => {
  const puzzle = parseGrid(CLASSIC);
  const solution = parseGrid(CLASSIC_SOLUTION);
  const noPencil = new Array(81).fill(0);

  it('flags wrong placed digits first', () => {
    const v = puzzle.slice();
    v[2] = 1; // correct is 4
    const h = findHint(v, noPencil, solution);
    expect(h.kind).toBe('wrongValue');
  });

  it('flags pencil marks where the correct digit was removed', () => {
    const pencil = noPencil.slice();
    pencil[2] = bit(1) | bit(2); // correct digit 4 eliminated
    const h = findHint(puzzle, pencil, solution, [2]);
    expect(h.kind).toBe('missingCandidate');
    if (h.kind === 'missingCandidate') expect(h.cells).toEqual([2]);
  });

  it('treats incomplete (never-removed) pencil marks as unmarked', () => {
    const pencil = noPencil.slice();
    pencil[2] = bit(1) | bit(2); // player is still adding marks
    const h = findHint(puzzle, pencil, solution);
    expect(h.kind).toBe('step');
    if (h.kind === 'step') {
      for (const e of h.step.eliminations) expect(solution[e.cell]).not.toBe(e.digit);
      for (const p of h.step.placements) expect(solution[p.cell]).toBe(p.digit);
    }
  });

  it('suggests clean-up of conflicting pencil marks', () => {
    const pencil = noPencil.slice();
    pencil[2] = bit(4) | bit(5); // 5 already in row 1
    const h = findHint(puzzle, pencil, solution);
    expect(h.kind).toBe('step');
    if (h.kind === 'step') {
      expect(h.step.technique).toBe('cleanup');
      expect(h.step.eliminations).toEqual([{ cell: 2, digit: 5 }]);
    }
  });

  it('gives a technique step with no pencil marks', () => {
    const h = findHint(puzzle, noPencil, solution);
    expect(h.kind).toBe('step');
    if (h.kind === 'step') expect(['nakedSingle', 'hiddenSingle']).toContain(h.step.technique);
  });

  it('uses the player candidates: a naked single from pencil marks', () => {
    // Player has reduced R1C3 to just 4 (correct) — pencil marks elsewhere full.
    const pencil = computeCandidates(puzzle);
    pencil[2] = bit(4);
    const h = findHint(puzzle, pencil, solution);
    expect(h.kind).toBe('step');
    if (h.kind === 'step') {
      expect(h.step.technique).toBe('nakedSingle');
      expect(h.step.placements).toEqual([{ cell: 2, digit: 4 }]);
    }
  });

  it('reports solved', () => {
    expect(findHint(solution, noPencil, solution).kind).toBe('solved');
  });

  it('full-candidate cells are handled', () => {
    const pencil = puzzle.map((v) => (v ? 0 : ALL_DIGITS));
    const h = findHint(puzzle, pencil, solution);
    expect(h.kind).toBe('step'); // clean-up of the impossible digits
  });
});
