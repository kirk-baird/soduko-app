// Human-style Kakuro solving techniques.
//
// Each technique inspects a State (placed values + candidate bitmasks) and
// returns the first deduction it finds as a PuzzleStep (or null). The same
// functions grade puzzles and produce hints from the player's own pencil
// marks, so every technique only assumes that each cell's candidates contain
// its solution digit and that placed digits are correct.

import { CellDigit, KeyCandidate, PuzzleStep, bit, digitsOf, popcount } from '../common';
import { allowedMask, comboMasks, comboText, remainingCombos, runSupport } from './combos';
import { Ctx, KakuroRun, cellListText, cellName, runName } from './types';

export interface State {
  values: number[];
  cands: number[];
}

export interface Technique {
  id: string;
  name: string;
  tier: number;
  find: (ctx: Ctx, s: State) => PuzzleStep | null;
}

// ---------- helpers ----------

interface RunView {
  run: KakuroRun;
  empties: number[];
  placed: number; // mask of placed digits
  placedSum: number;
  rem: number; // sum still needed from the empty cells
  k: number; // number of empty cells
}

function view(ctx: Ctx, s: State, ri: number): RunView {
  const run = ctx.runs[ri];
  const empties: number[] = [];
  let placed = 0;
  let placedSum = 0;
  for (const c of run.cells) {
    const v = s.values[c];
    if (v) {
      placed |= bit(v);
      placedSum += v;
    } else empties.push(c);
  }
  return { run, empties, placed, placedSum, rem: run.sum - placedSum, k: empties.length };
}

const lowDigit = (m: number) => 31 - Math.clz32(m & -m);

export function digitText(m: number): string {
  const ds = digitsOf(m, 9);
  if (ds.length <= 1) return ds.join('');
  return `${ds.slice(0, -1).join(', ')} and ${ds[ds.length - 1]}`;
}

const orDigits = (m: number) => {
  const ds = digitsOf(m, 9);
  if (ds.length <= 1) return ds.join('');
  return `${ds.slice(0, -1).join(', ')} or ${ds[ds.length - 1]}`;
};

function elimText(ctx: Ctx, elims: CellDigit[]): string {
  // Group digits that are removed from exactly the same cells.
  const byDigit = new Map<number, number[]>();
  for (const e of elims) byDigit.set(e.digit, [...(byDigit.get(e.digit) ?? []), e.cell]);
  const byCells = new Map<string, { cells: number[]; digits: number }>();
  for (const [d, cells] of [...byDigit.entries()].sort((a, b) => a[0] - b[0])) {
    const key = cells.join(',');
    const g = byCells.get(key) ?? { cells, digits: 0 };
    g.digits |= bit(d);
    byCells.set(key, g);
  }
  return [...byCells.values()].map((g) => `${digitText(g.digits)} from ${cellListText(ctx, g.cells)}`).join('; ');
}

const an = (d: number) => (d === 8 ? `an ${d}` : `a ${d}`);

function elimsOutside(s: State, cells: number[], keep: number): CellDigit[] {
  const out: CellDigit[] = [];
  for (const c of cells) {
    if (s.values[c]) continue;
    for (const d of digitsOf(s.cands[c] & ~keep, 9)) out.push({ cell: c, digit: d });
  }
  return out;
}

function keysWithin(s: State, cells: number[], mask: number): KeyCandidate[] {
  const out: KeyCandidate[] = [];
  for (const c of cells) if (!s.values[c]) for (const d of digitsOf(s.cands[c] & mask, 9)) out.push({ cell: c, digit: d });
  return out;
}

function combosText(cs: number[]): string {
  if (cs.length <= 1) return cs.map(comboText).join('');
  return `${cs.slice(0, -1).map(comboText).join(', ')} or ${comboText(cs[cs.length - 1])}`;
}

/** "the 3 empty cells must add to 12" (+ context about placed digits). */
function needText(v: RunView): string {
  if (!v.placed) return `its ${v.k} cells must add up to ${v.run.sum} with different digits`;
  return `with ${digitText(v.placed)} already placed, its ${v.k} empty cell${v.k === 1 ? '' : 's'} must add up to ${v.rem} using other digits`;
}

const unionOf = (s: State, cells: number[]) => cells.reduce((m, c) => m | s.cands[c], 0);

/** Combos (for the empty cells) whose every digit is a candidate somewhere and that give every cell a digit. */
function simpleCombos(s: State, v: RunView): number[] {
  const u = unionOf(s, v.empties);
  return remainingCombos(v.rem, v.k, v.placed).filter(
    (c) => (c & u) === c && v.empties.every((e) => (s.cands[e] & c) !== 0),
  );
}

const META: Record<string, { name: string; tier: number }> = {};

function mk(id: string, f: Partial<Omit<PuzzleStep, 'technique' | 'name' | 'tier' | 'explanation'>> & { explanation: string }): PuzzleStep {
  return {
    technique: id,
    name: META[id].name,
    tier: META[id].tier,
    placements: f.placements ?? [],
    eliminations: f.eliminations ?? [],
    pattern: f.pattern ?? [],
    keys: f.keys ?? [],
    unitCells: f.unitCells ?? [],
    explanation: f.explanation,
  };
}

function* subsets<T>(xs: T[], n: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === n) {
    yield acc.slice();
    return;
  }
  for (let i = start; i <= xs.length - (n - acc.length); i++) {
    acc.push(xs[i]);
    yield* subsets(xs, n, i + 1, acc);
    acc.pop();
  }
}

// ---------- tier 0 ----------

function lastCell(ctx: Ctx, s: State): PuzzleStep | null {
  for (let ri = 0; ri < ctx.runs.length; ri++) {
    const v = view(ctx, s, ri);
    if (v.k !== 1) continue;
    const d = v.rem;
    if (d < 1 || d > 9 || v.placed & bit(d)) continue;
    const c = v.empties[0];
    return mk('lastCell', {
      placements: [{ cell: c, digit: d }],
      pattern: [c],
      keys: [{ cell: c, digit: d }],
      unitCells: v.run.cells,
      explanation:
        `${cellName(ctx, c)} is the only empty cell left in ${runName(ctx, v.run)}. ` +
        `The other cells add up to ${v.placedSum}, so ${cellName(ctx, c)} must be ${v.run.sum} − ${v.placedSum} = ${d}.`,
    });
  }
  return null;
}

function runAllowed(ctx: Ctx, s: State, ri: number): number {
  const v = view(ctx, s, ri);
  return allowedMask(v.rem, v.k, v.placed);
}

function crossingRuns(ctx: Ctx, s: State): PuzzleStep | null {
  for (const c of ctx.whiteCells) {
    if (s.values[c] || ctx.cellRuns[c].length < 2) continue;
    const [ra, rb] = ctx.cellRuns[c];
    const ma = runAllowed(ctx, s, ra);
    const mb = runAllowed(ctx, s, rb);
    const m = ma & mb & s.cands[c];
    if (popcount(m) !== 1) continue;
    const d = lowDigit(m);
    const va = view(ctx, s, ra);
    const vb = view(ctx, s, rb);
    const extra = (s.cands[c] & ~m) !== 0 && (ma & mb) !== m ? ` (the other digits allowed by both are no longer candidates)` : '';
    return mk('crossingRuns', {
      placements: [{ cell: c, digit: d }],
      pattern: [c],
      keys: [{ cell: c, digit: d }],
      unitCells: [...va.run.cells, ...vb.run.cells],
      explanation:
        `${cellName(ctx, c)} sits where two runs cross. In ${runName(ctx, va.run)}, ${needText(va)}, ` +
        `so only ${digitText(ma)} can appear. In ${runName(ctx, vb.run)}, ${needText(vb)}, so only ${digitText(mb)} can appear. ` +
        `The only digit that fits both is ${d}${extra}. Place ${d} in ${cellName(ctx, c)}.`,
    });
  }
  return null;
}

function nakedSingle(ctx: Ctx, s: State): PuzzleStep | null {
  for (const c of ctx.whiteCells) {
    if (s.values[c] || popcount(s.cands[c]) !== 1) continue;
    const d = lowDigit(s.cands[c]);
    return mk('nakedSingle', {
      placements: [{ cell: c, digit: d }],
      pattern: [c],
      keys: [{ cell: c, digit: d }],
      unitCells: ctx.cellRuns[c].flatMap((r) => ctx.runs[r].cells),
      explanation: `${cellName(ctx, c)} has only one candidate left: ${d}. Place ${d} there.`,
    });
  }
  return null;
}

function uniqueCombination(ctx: Ctx, s: State): PuzzleStep | null {
  for (let ri = 0; ri < ctx.runs.length; ri++) {
    const v = view(ctx, s, ri);
    if (v.k < 2) continue;
    const cs = remainingCombos(v.rem, v.k, v.placed);
    if (cs.length !== 1) continue;
    const combo = cs[0];
    const elims = elimsOutside(s, v.empties, combo);
    if (!elims.length) continue;
    const lead = v.placed
      ? `In ${runName(ctx, v.run)}, ${digitText(v.placed)} ${popcount(v.placed) === 1 ? 'is' : 'are'} already placed, so the ${v.k} empty cells must add up to ${v.rem} without repeating ${popcount(v.placed) === 1 ? 'it' : 'them'}. The only way to do that is ${comboText(combo)}.`
      : `${capital(runName(ctx, v.run))} has ${v.k} cells. The only set of ${v.k} different digits adding up to ${v.run.sum} is ${comboText(combo)}.`;
    return mk('uniqueCombination', {
      eliminations: elims,
      pattern: v.empties,
      keys: keysWithin(s, v.empties, combo),
      unitCells: v.run.cells,
      explanation: `${lead} So its cells can only hold ${digitText(combo)}: remove ${elimText(ctx, elims)}.`,
    });
  }
  return null;
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function runLimits(ctx: Ctx, s: State): PuzzleStep | null {
  for (let ri = 0; ri < ctx.runs.length; ri++) {
    const v = view(ctx, s, ri);
    if (!v.k) continue;
    const cs = remainingCombos(v.rem, v.k, v.placed);
    if (!cs.length) continue;
    const u = cs.reduce((m, c) => m | c, 0);
    const elims = elimsOutside(s, v.empties, u);
    if (!elims.length) continue;
    const bad = elims.reduce((m, e) => m | bit(e.digit), 0);
    const why =
      cs.length <= 4
        ? `The possible sets are ${combosText(cs)}, so ${orDigits(bad)} can't appear.`
        : `No such set uses ${orDigits(bad)}.`;
    return mk('runLimits', {
      eliminations: elims,
      pattern: v.empties,
      unitCells: v.run.cells,
      explanation: `In ${runName(ctx, v.run)}, ${needText(v)}. ${why} Remove ${elimText(ctx, elims)}.`,
    });
  }
  return null;
}

// ---------- tier 1 ----------

function hiddenSingle(ctx: Ctx, s: State): PuzzleStep | null {
  for (let ri = 0; ri < ctx.runs.length; ri++) {
    const v = view(ctx, s, ri);
    if (v.k < 2) continue;
    const cs = simpleCombos(s, v);
    if (!cs.length) continue;
    const req = cs.reduce((m, c) => m & c, 0x3fe);
    for (const d of digitsOf(req, 9)) {
      const pos = v.empties.filter((c) => s.cands[c] & bit(d));
      if (pos.length !== 1) continue;
      const c = pos[0];
      const why =
        cs.length === 1
          ? `the only set that fits its candidates is ${comboText(cs[0])}`
          : `every set that fits its candidates (${combosText(cs)}) includes ${d}`;
      return mk('hiddenSingle', {
        placements: [{ cell: c, digit: d }],
        pattern: [c],
        keys: [{ cell: c, digit: d }],
        unitCells: v.run.cells,
        explanation:
          `${capital(runName(ctx, v.run))} must contain ${an(d)}: ${needText(v)}, and ${why}. ` +
          `Only ${cellName(ctx, c)} can hold ${d}, so place it there.`,
      });
    }
  }
  return null;
}

function runCombinations(ctx: Ctx, s: State): PuzzleStep | null {
  for (let ri = 0; ri < ctx.runs.length; ri++) {
    const v = view(ctx, s, ri);
    if (v.k < 2) continue;
    const all = remainingCombos(v.rem, v.k, v.placed);
    const cs = simpleCombos(s, v);
    if (!cs.length || cs.length === all.length) continue;
    const u = cs.reduce((m, c) => m | c, 0);
    const elims = elimsOutside(s, v.empties, u);
    if (!elims.length) continue;
    const cu = unionOf(s, v.empties);
    const reasons: string[] = [];
    for (const c of all) {
      if (cs.includes(c)) continue;
      const missing = c & ~cu;
      if (missing) {
        const d = lowDigit(missing);
        reasons.push(`${comboText(c)} needs ${an(d)}, but no empty cell can take ${d}`);
      } else {
        const e = v.empties.find((x) => !(s.cands[x] & c))!;
        reasons.push(`${comboText(c)} has no digit that ${cellName(ctx, e)} can take`);
      }
    }
    const shown = reasons.slice(0, 3).join('; ');
    const more = reasons.length > 3 ? `; and ${reasons.length - 3} more sets fail the same way` : '';
    return mk('runCombinations', {
      eliminations: elims,
      pattern: v.empties,
      keys: keysWithin(s, v.empties, u),
      unitCells: v.run.cells,
      explanation:
        `In ${runName(ctx, v.run)}, ${needText(v)}. Check each possible set against the candidates: ${shown}${more}. ` +
        `That leaves ${combosText(cs)}, so remove ${elimText(ctx, elims)}.`,
    });
  }
  return null;
}

function twoCellSum(ctx: Ctx, s: State): PuzzleStep | null {
  for (let ri = 0; ri < ctx.runs.length; ri++) {
    const v = view(ctx, s, ri);
    if (v.k !== 2) continue;
    const [x, y] = v.empties;
    const elims: CellDigit[] = [];
    const why: string[] = [];
    for (const [a, b] of [
      [x, y],
      [y, x],
    ]) {
      for (const d of digitsOf(s.cands[a], 9)) {
        const p = v.rem - d;
        const ok = p >= 1 && p <= 9 && p !== d && !(v.placed & bit(p)) && (s.cands[b] & bit(p)) !== 0;
        if (ok) continue;
        elims.push({ cell: a, digit: d });
        if (why.length < 2) {
          why.push(
            p >= 1 && p <= 9 && p !== d && !(v.placed & bit(p))
              ? `${d} in ${cellName(ctx, a)} would need ${p} in ${cellName(ctx, b)}, which isn't a candidate there`
              : `${d} in ${cellName(ctx, a)} would need ${p < 1 || p > 9 ? `a ${p}` : `a second ${p}`} in ${cellName(ctx, b)}, which is impossible`,
          );
        }
      }
    }
    if (!elims.length) continue;
    return mk('twoCellSum', {
      eliminations: elims,
      pattern: [x, y],
      keys: keysWithin(s, [x, y], 0x3fe).filter((k) => !elims.some((e) => e.cell === k.cell && e.digit === k.digit)),
      unitCells: v.run.cells,
      explanation:
        `${cellName(ctx, x)} and ${cellName(ctx, y)} are the last two empty cells of ${runName(ctx, v.run)}, so they must add up to ${v.rem}. ` +
        `Each digit in one needs its partner (${v.rem} minus it) in the other: ${why.join('; ')}${elims.length > 2 ? ', and so on' : ''}. ` +
        `Remove ${elimText(ctx, elims)}.`,
    });
  }
  return null;
}

// ---------- tier 2 / 3: subsets within a run ----------

function nakedSubset(id: string, n: number) {
  return (ctx: Ctx, s: State): PuzzleStep | null => {
    const label = n === 2 ? 'pair' : 'triple';
    for (let ri = 0; ri < ctx.runs.length; ri++) {
      const v = view(ctx, s, ri);
      if (v.k <= n) continue;
      const pool = v.empties.filter((c) => {
        const k = popcount(s.cands[c]);
        return k >= 2 && k <= n;
      });
      if (pool.length < n) continue;
      for (const set of subsets(pool, n)) {
        const u = unionOf(s, set);
        if (popcount(u) !== n) continue;
        const others = v.empties.filter((c) => !set.includes(c));
        const elims: CellDigit[] = [];
        for (const c of others) for (const d of digitsOf(s.cands[c] & u, 9)) elims.push({ cell: c, digit: d });
        if (!elims.length) continue;
        return mk(id, {
          eliminations: elims,
          pattern: set,
          keys: keysWithin(s, set, u),
          unitCells: v.run.cells,
          explanation:
            `In ${runName(ctx, v.run)}, ${cellListText(ctx, set)} can only hold ${digitText(u)} between them (a naked ${label}). ` +
            `Those ${n} cells use up those ${n} digits, and digits can't repeat in a run, so remove ${elimText(ctx, elims)}.`,
        });
      }
    }
    return null;
  };
}

function hiddenSubset(id: string, n: number) {
  return (ctx: Ctx, s: State): PuzzleStep | null => {
    const label = n === 2 ? 'pair' : 'triple';
    for (let ri = 0; ri < ctx.runs.length; ri++) {
      const v = view(ctx, s, ri);
      if (v.k <= n) continue;
      const cs = simpleCombos(s, v);
      if (!cs.length) continue;
      const req = cs.reduce((m, c) => m & c, 0x3fe);
      const reqDigits = digitsOf(req, 9).filter((d) => {
        const k = v.empties.filter((c) => s.cands[c] & bit(d)).length;
        return k >= 1 && k <= n;
      });
      if (reqDigits.length < n) continue;
      for (const ds of subsets(reqDigits, n)) {
        const dm = ds.reduce((m, d) => m | bit(d), 0);
        const cells = v.empties.filter((c) => s.cands[c] & dm);
        if (cells.length !== n) continue;
        const elims = elimsOutside(s, cells, dm);
        if (!elims.length) continue;
        const why = cs.length === 1 ? `the only set that fits is ${comboText(cs[0])}` : `every set that fits (${combosText(cs)}) contains them`;
        return mk(id, {
          eliminations: elims,
          pattern: cells,
          keys: keysWithin(s, cells, dm),
          unitCells: v.run.cells,
          explanation:
            `${capital(runName(ctx, v.run))} must contain ${digitText(dm)}: ${why}. ` +
            `In this run they can only go in ${cellListText(ctx, cells)} (a hidden ${label}), so those cells hold exactly ${digitText(dm)}. ` +
            `Remove ${elimText(ctx, elims)}.`,
        });
      }
    }
    return null;
  };
}

/** Smallest set of empty cells that together can only take fewer digits of `combo` than there are cells. */
function hallViolation(s: State, empties: number[], combo: number): { cells: number[]; digits: number } | null {
  const k = empties.length;
  let best: { cells: number[]; digits: number } | null = null;
  for (let m = 1; m < 1 << k; m++) {
    const cells = empties.filter((_, i) => m & (1 << i));
    if (best && cells.length >= best.cells.length) continue;
    const u = cells.reduce((acc, c) => acc | (s.cands[c] & combo), 0);
    if (popcount(u) < cells.length) best = { cells, digits: u };
  }
  return best;
}

function comboArrangement(ctx: Ctx, s: State): PuzzleStep | null {
  const out: number[] = [];
  for (let ri = 0; ri < ctx.runs.length; ri++) {
    const v = view(ctx, s, ri);
    if (v.k < 2) continue;
    const simple = simpleCombos(s, v);
    if (simple.length < 2) continue;
    const ok: number[] = [];
    runSupport(
      v.empties.map((c) => s.cands[c]),
      simple,
      out,
      ok,
    );
    if (!ok.length || ok.length === simple.length) continue;
    const u = ok.reduce((m, c) => m | c, 0);
    const elims = elimsOutside(s, v.empties, u);
    if (!elims.length) continue;
    const reasons: string[] = [];
    let pattern: number[] = [];
    for (const c of simple) {
      if (ok.includes(c)) continue;
      const h = hallViolation(s, v.empties, c);
      if (!h) continue;
      if (!pattern.length) pattern = h.cells;
      reasons.push(
        h.digits
          ? `${comboText(c)} fails because ${cellListText(ctx, h.cells)} could only take ${digitText(h.digits)} from it — ${h.cells.length} cells but only ${popcount(h.digits)} digit${popcount(h.digits) === 1 ? '' : 's'}`
          : `${comboText(c)} fails because ${cellListText(ctx, h.cells)} can't take any of its digits`,
      );
    }
    const shown = reasons.slice(0, 2).join('; ');
    const more = reasons.length > 2 ? `; ${reasons.length - 2} more sets fail similarly` : '';
    return mk('comboArrangement', {
      eliminations: elims,
      pattern: pattern.length ? pattern : v.empties,
      keys: keysWithin(s, v.empties, u),
      unitCells: v.run.cells,
      explanation:
        `In ${runName(ctx, v.run)}, ${needText(v)}. The candidates allow the sets ${combosText(simple)}, ` +
        `but each cell needs its own digit from the set: ${shown}${more}. ` +
        `That leaves ${combosText(ok)}, so remove ${elimText(ctx, elims)}.`,
    });
  }
  return null;
}

// ---------- tier 3 ----------

function comboFit(ctx: Ctx, s: State): PuzzleStep | null {
  const out: number[] = [];
  for (let ri = 0; ri < ctx.runs.length; ri++) {
    const v = view(ctx, s, ri);
    if (v.k < 2) continue;
    const doms = v.empties.map((c) => s.cands[c]);
    if (!runSupport(doms, remainingCombos(v.rem, v.k, v.placed), out)) continue;
    const elims: CellDigit[] = [];
    v.empties.forEach((c, i) => {
      for (const d of digitsOf(s.cands[c] & ~out[i], 9)) elims.push({ cell: c, digit: d });
    });
    if (!elims.length) continue;
    const e = elims[0];
    const others = v.empties.filter((c) => c !== e.cell);
    const otherText = others.map((c) => `${cellName(ctx, c)}: ${digitsOf(s.cands[c], 9).join(',')}`).join('; ');
    return mk('comboFit', {
      eliminations: elims,
      pattern: [e.cell],
      keys: keysWithin(s, others, 0x3fe),
      unitCells: v.run.cells,
      explanation:
        `In ${runName(ctx, v.run)}, ${needText(v)}. If ${cellName(ctx, e.cell)} were ${e.digit}, the other empty cell${others.length === 1 ? '' : 's'} ` +
        `(${otherText}) would have to make ${v.rem - e.digit} with different digits from ${others.length === 1 ? 'its' : 'their'} candidates, and that's impossible. ` +
        (elims.length > 1 ? `Trying every candidate the same way rules out ${elimText(ctx, elims)}.` : `Remove ${e.digit} from ${cellName(ctx, e.cell)}.`),
    });
  }
  return null;
}

interface Rect {
  r1: number;
  r2: number;
  c1: number;
  c2: number;
}
const RECTS = new WeakMap<Ctx, Rect[]>();

function rectsOf(ctx: Ctx): Rect[] {
  let rs = RECTS.get(ctx);
  if (rs) return rs;
  rs = [];
  for (let r1 = 1; r1 < ctx.rows; r1++)
    for (let r2 = r1; r2 < ctx.rows; r2++)
      for (let c1 = 1; c1 < ctx.cols; c1++) for (let c2 = c1; c2 < ctx.cols; c2++) rs.push({ r1, r2, c1, c2 });
  rs.sort((a, b) => (a.r2 - a.r1 + 1) * (a.c2 - a.c1 + 1) - (b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1));
  RECTS.set(ctx, rs);
  return rs;
}

function sumBlock(ctx: Ctx, s: State): PuzzleStep | null {
  const { cols } = ctx;
  const across = ctx.runs.filter((r) => r.dir === 'across');
  const down = ctx.runs.filter((r) => r.dir === 'down');
  for (const R of rectsOf(ctx)) {
    let sumA = 0;
    let sumD = 0;
    let knownA = 0;
    let knownD = 0;
    let unknown = -1;
    let unknownInA = false;
    let nUnknown = 0;
    let regionEmpty = 0;
    const outA: number[] = [];
    const outD: number[] = [];
    const runCells: number[] = [];
    let nA = 0;
    let nD = 0;
    for (const run of across) {
      const r = Math.floor(run.cells[0] / cols);
      if (r < R.r1 || r > R.r2) continue;
      const ca = run.cells[0] % cols;
      const cb = ca + run.cells.length - 1;
      if (ca > R.c2 || cb < R.c1) continue;
      nA++;
      sumA += run.sum;
      runCells.push(...run.cells);
      for (const c of run.cells) {
        const cc = c % cols;
        if (cc >= R.c1 && cc <= R.c2) {
          if (!s.values[c]) regionEmpty++;
          continue;
        }
        outA.push(c);
        if (s.values[c]) knownA += s.values[c];
        else {
          nUnknown++;
          unknown = c;
          unknownInA = true;
        }
      }
    }
    if (!nA || nUnknown > 1 || !regionEmpty) continue;
    for (const run of down) {
      const c0 = run.cells[0] % cols;
      if (c0 < R.c1 || c0 > R.c2) continue;
      const ra = Math.floor(run.cells[0] / cols);
      const rb = ra + run.cells.length - 1;
      if (ra > R.r2 || rb < R.r1) continue;
      nD++;
      sumD += run.sum;
      runCells.push(...run.cells);
      for (const c of run.cells) {
        const rr = Math.floor(c / cols);
        if (rr >= R.r1 && rr <= R.r2) continue;
        outD.push(c);
        if (s.values[c]) knownD += s.values[c];
        else {
          nUnknown++;
          unknown = c;
          unknownInA = false;
        }
      }
      if (nUnknown > 1) break;
    }
    if (!nD || nUnknown !== 1) continue;
    // sumA - sumD = (knownA + [x in A]) - (knownD + [x in D])
    const x = unknownInA ? sumA - sumD - knownA + knownD : sumD - sumA - knownD + knownA;
    if (x < 1 || x > 9 || !(s.cands[unknown] & bit(x))) continue;
    const region: number[] = [];
    for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) if (ctx.white[r * cols + c]) region.push(r * cols + c);
    const outText = (cells: number[]) =>
      cells.length ? cells.map((c) => (s.values[c] ? `${cellName(ctx, c)} (${s.values[c]})` : cellName(ctx, c))).join(', ') : 'nothing';
    const blockName =
      R.r1 === R.r2 && R.c1 === R.c2
        ? `the single cell ${cellName(ctx, R.r1 * cols + R.c1)}`
        : `the block from ${cellName(ctx, R.r1 * cols + R.c1)} to ${cellName(ctx, R.r2 * cols + R.c2)}`;
    const xn = cellName(ctx, unknown);
    const [big, small, sameKnown, otherKnown, sameDir, otherDir] = unknownInA
      ? [sumA, sumD, knownA, knownD, 'across', 'down']
      : [sumD, sumA, knownD, knownA, 'down', 'across'];
    const arith =
      `${xn} = ${big} − ${small}` +
      (sameKnown ? ` − ${sameKnown} (the other ${sameDir} cells sticking out)` : '') +
      (otherKnown ? ` + ${otherKnown} (the ${otherDir} cells sticking out)` : '') +
      ` = ${x}`;
    return mk('sumBlock', {
      placements: [{ cell: unknown, digit: x }],
      pattern: region,
      keys: [{ cell: unknown, digit: x }],
      unitCells: [...new Set(runCells)],
      explanation:
        `Look at ${blockName}. The across runs that cross it have clues totalling ${sumA}, and the down runs total ${sumD}. ` +
        `Both totals count every white cell of the block exactly once, plus the cells of those runs that stick out of the block: ` +
        `across ${outText(outA)}; down ${outText(outD)}. ` +
        `So the difference between the totals comes only from the cells sticking out: ${arith}.`,
    });
  }
  return null;
}

// ---------- tier 4: what-if contradiction ----------

interface Trial {
  ok: boolean;
  trace: CellDigit[];
  fail: string;
}

/** Assume cell = d and propagate (single-run consistency + singles). */
function trial(ctx: Ctx, s: State, cell: number, d: number, maxTrace: number): Trial {
  const dom = s.cands.slice();
  for (const c of ctx.whiteCells) if (s.values[c]) dom[c] = bit(s.values[c]);
  dom[cell] = bit(d);
  const trace: CellDigit[] = [];
  const fixed = new Uint8Array(ctx.n);
  for (const c of ctx.whiteCells) if (popcount(dom[c]) === 1) fixed[c] = 1;
  const out: number[] = [];
  const inQ = new Uint8Array(ctx.runs.length);
  const queue: number[] = [];
  for (const r of ctx.cellRuns[cell]) {
    inQ[r] = 1;
    queue.push(r);
  }
  while (queue.length) {
    const ri = queue.shift()!;
    inQ[ri] = 0;
    const run = ctx.runs[ri];
    const doms = run.cells.map((c) => dom[c]);
    if (!runSupport(doms, comboMasks(run.sum, run.cells.length), out)) {
      return { ok: false, trace, fail: `${runName(ctx, run)} could no longer be completed` };
    }
    for (let i = 0; i < run.cells.length; i++) {
      const c = run.cells[i];
      const nd = dom[c] & out[i];
      if (nd === dom[c]) continue;
      if (!nd) return { ok: false, trace, fail: `${cellName(ctx, c)} would have no digit left` };
      dom[c] = nd;
      if (popcount(nd) === 1 && !fixed[c]) {
        fixed[c] = 1;
        trace.push({ cell: c, digit: lowDigit(nd) });
        if (trace.length > maxTrace) return { ok: true, trace, fail: '' };
      }
      for (const rj of ctx.cellRuns[c]) {
        if (!inQ[rj]) {
          inQ[rj] = 1;
          queue.push(rj);
        }
      }
    }
  }
  return { ok: true, trace, fail: '' };
}

function contradiction(ctx: Ctx, s: State): PuzzleStep | null {
  let best: { cell: number; d: number; t: Trial } | null = null;
  const MAX = 12;
  for (const size of [2, 3]) {
    for (const c of ctx.whiteCells) {
      if (s.values[c] || popcount(s.cands[c]) !== size) continue;
      for (const d of digitsOf(s.cands[c], 9)) {
        const t = trial(ctx, s, c, d, best ? Math.min(best.t.trace.length, MAX) : MAX);
        if (t.ok) continue;
        if (!best || t.trace.length < best.t.trace.length) best = { cell: c, d, t };
        if (best.t.trace.length <= 1) break;
      }
      if (best && best.t.trace.length <= 1) break;
    }
    if (best) break;
  }
  if (!best) return null;
  const { cell, d, t } = best;
  const shown = t.trace.slice(0, 5).map((p) => `${cellName(ctx, p.cell)} would be ${p.digit}`);
  const chain = shown.length
    ? `Then ${shown.join(', ')}${t.trace.length > 5 ? `, and ${t.trace.length - 5} more cells would be forced` : ''}, and ${t.fail}.`
    : `Then ${t.fail}.`;
  return mk('contradiction', {
    eliminations: [{ cell, digit: d }],
    pattern: [cell],
    keys: t.trace.map((p) => ({ cell: p.cell, digit: p.digit, color: 1 as const })),
    unitCells: ctx.cellRuns[cell].flatMap((r) => ctx.runs[r].cells),
    explanation:
      `Suppose ${cellName(ctx, cell)} were ${d}. ${chain} ` +
      `(Each forced digit follows from what its runs can still make.) So ${cellName(ctx, cell)} can't be ${d}: remove it.`,
  });
}

// ---------- registry ----------

export const TECHNIQUES: Technique[] = [
  { id: 'lastCell', name: 'Last Cell of a Run', tier: 0, find: lastCell },
  { id: 'crossingRuns', name: 'Crossing Runs', tier: 0, find: crossingRuns },
  { id: 'nakedSingle', name: 'Naked Single', tier: 0, find: nakedSingle },
  { id: 'uniqueCombination', name: 'Unique Combination', tier: 0, find: uniqueCombination },
  { id: 'runLimits', name: 'Run Limits', tier: 0, find: runLimits },
  { id: 'hiddenSingle', name: 'Hidden Single', tier: 1, find: hiddenSingle },
  { id: 'runCombinations', name: 'Run Combinations', tier: 1, find: runCombinations },
  { id: 'twoCellSum', name: 'Two-Cell Sum', tier: 1, find: twoCellSum },
  { id: 'nakedPair', name: 'Naked Pair', tier: 2, find: nakedSubset('nakedPair', 2) },
  { id: 'hiddenPair', name: 'Hidden Pair', tier: 2, find: hiddenSubset('hiddenPair', 2) },
  { id: 'comboArrangement', name: 'Combination Arrangement', tier: 2, find: comboArrangement },
  { id: 'nakedTriple', name: 'Naked Triple', tier: 3, find: nakedSubset('nakedTriple', 3) },
  { id: 'hiddenTriple', name: 'Hidden Triple', tier: 3, find: hiddenSubset('hiddenTriple', 3) },
  { id: 'comboFit', name: 'Combination Fit', tier: 3, find: comboFit },
  { id: 'sumBlock', name: 'Sum Block', tier: 3, find: sumBlock },
  { id: 'contradiction', name: 'What If', tier: 4, find: contradiction },
];
for (const t of TECHNIQUES) META[t.id] = { name: t.name, tier: t.tier };
META.cleanup = { name: 'Clean-up', tier: 0 };

export const TECHNIQUE_BY_ID: Record<string, Technique> = Object.fromEntries(TECHNIQUES.map((t) => [t.id, t]));

export function findStep(ctx: Ctx, s: State, maxTier = 4): PuzzleStep | null {
  for (const t of TECHNIQUES) {
    if (t.tier > maxTier) continue;
    const st = t.find(ctx, s);
    if (st) return st;
  }
  return null;
}

export { mk as makeStep };
