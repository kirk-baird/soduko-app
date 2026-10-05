// Human-style Calcudoku techniques.
//
// Each technique inspects a State (placed values + candidate bitmasks) and
// returns the first deduction it can make as a PuzzleStep, or null. All
// deductions are sound given that the candidates contain the solution.

import { CellDigit, KeyCandidate, PuzzleStep, bit, digitsOf, hasBit, popcount, rcName } from '../common';
import { Ctx, cageLabel, colOf, rowOf, sameLine, tupleUnion, validTuples } from './model';

export interface State {
  values: number[];
  cands: number[]; // 0 for filled cells
}

export interface Technique {
  id: string;
  name: string;
  tier: number;
  find: (ctx: Ctx, s: State) => PuzzleStep | null;
}

// ---------- helpers ----------

const uniq = <T,>(xs: T[]): T[] => [...new Set(xs)];
const empty = (s: State, i: number) => s.values[i] === 0;
const withDigit = (s: State, cells: number[], d: number) => cells.filter((i) => empty(s, i) && hasBit(s.cands[i], d));

function* combinations<T>(arr: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield acc.slice();
    return;
  }
  for (let i = start; i <= arr.length - (k - acc.length); i++) {
    acc.push(arr[i]);
    yield* combinations(arr, k, i + 1, acc);
    acc.pop();
  }
}

function joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

const nm = (ctx: Ctx, i: number) => rcName(i, ctx.n);
const cellList = (ctx: Ctx, cells: number[]) => joinAnd(cells.map((c) => nm(ctx, c)));
const digitList = (ds: number[]) => joinAnd(ds.map(String));

function elimText(ctx: Ctx, elims: CellDigit[]): string {
  const byDigit = new Map<number, number[]>();
  for (const e of elims) byDigit.set(e.digit, [...(byDigit.get(e.digit) ?? []), e.cell]);
  return [...byDigit.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([d, cells]) => `${d} from ${cellList(ctx, cells)}`)
    .join('; ');
}

const lineName = (ctx: Ctx, li: number) => (li < ctx.n ? `row ${li + 1}` : `column ${li - ctx.n + 1}`);

/** "the 12× cage R1C1–R1C2–R2C1" */
function cageName(ctx: Ctx, ci: number): string {
  const c = ctx.cages[ci];
  return `the ${cageLabel(c)} cage ${c.cells.map((x) => nm(ctx, x)).join('–')}`;
}

/** Digit combinations (sorted multisets) used by the tuples, as text: '1/3 and 2/6'. */
function comboText(tuples: number[][], max = 6): string {
  const combos = uniq(tuples.map((t) => t.slice().sort((a, b) => a - b).join('/'))).sort();
  if (combos.length > max) return `${combos.length} digit combinations`;
  return joinAnd(combos);
}

function step(
  technique: string,
  name: string,
  tier: number,
  f: Partial<Omit<PuzzleStep, 'technique' | 'name' | 'tier' | 'explanation'>> & { explanation: string },
): PuzzleStep {
  return {
    technique,
    name,
    tier,
    placements: f.placements ?? [],
    eliminations: f.eliminations ?? [],
    pattern: f.pattern ?? [],
    keys: f.keys ?? [],
    unitCells: f.unitCells ?? [],
    explanation: f.explanation,
  };
}

const keysOf = (s: State, cells: number[], mask = ~0): KeyCandidate[] =>
  cells.flatMap((cell) => digitsOf(s.cands[cell] & mask).map((digit) => ({ cell, digit })));

/** Eliminations in a cage's empty cells implied by restricting it to `tuples`. */
function cageElims(ctx: Ctx, s: State, ci: number, tuples: number[][]): CellDigit[] {
  const cells = ctx.cages[ci].cells;
  const u = tupleUnion(cells.length, tuples);
  const out: CellDigit[] = [];
  cells.forEach((c, k) => {
    if (!empty(s, c)) return;
    for (const d of digitsOf(s.cands[c] & ~u[k])) out.push({ cell: c, digit: d });
  });
  return out;
}

/** Cage order for humans: small cages first. */
function cageOrder(ctx: Ctx): number[] {
  return [...ctx.cages.keys()].sort((a, b) => ctx.cages[a].cells.length - ctx.cages[b].cells.length || a - b);
}

// ---------- tier 0: singles ----------

const T = {
  singleCage: { name: 'Single-cell Cage', tier: 0 },
  nakedSingle: { name: 'Naked Single', tier: 0 },
  hiddenSingle: { name: 'Hidden Single', tier: 0 },
  lastCageCell: { name: 'Last Cell in Cage', tier: 0 },
  cageCombination: { name: 'Cage Combinations', tier: 1 },
  nakedPair: { name: 'Naked Pair', tier: 1 },
  hiddenPair: { name: 'Hidden Pair', tier: 1 },
  nakedTriple: { name: 'Naked Triple', tier: 2 },
  hiddenTriple: { name: 'Hidden Triple', tier: 2 },
  cagePointing: { name: 'Cage Pointing', tier: 2 },
  lineCage: { name: 'Line/Cage Interaction', tier: 2 },
  xWing: { name: 'X-Wing', tier: 3 },
  nakedQuad: { name: 'Naked Quad', tier: 3 },
  hiddenQuad: { name: 'Hidden Quad', tier: 3 },
  cageSum: { name: 'Line Sum (Innies/Outies)', tier: 3 },
  cageProduct: { name: 'Line Product', tier: 3 },
  cageSumSets: { name: 'Line Sum (advanced)', tier: 3 },
  cageProductSets: { name: 'Line Product (advanced)', tier: 3 },
  xyWing: { name: 'XY-Wing', tier: 4 },
  swordfish: { name: 'Swordfish', tier: 4 },
} as const;
type Id = keyof typeof T;
const mk = (id: Id, f: Parameters<typeof step>[3]) => step(id, T[id].name, T[id].tier, f);

function singleCage(ctx: Ctx, s: State): PuzzleStep | null {
  for (const cage of ctx.cages) {
    if (cage.op !== '=') continue;
    const c = cage.cells[0];
    if (!empty(s, c) || !hasBit(s.cands[c], cage.target)) continue;
    return mk('singleCage', {
      placements: [{ cell: c, digit: cage.target }],
      pattern: [c],
      keys: [{ cell: c, digit: cage.target }],
      unitCells: [c],
      explanation: `${nm(ctx, c)} is a cage on its own showing ${cage.target}, so it must be ${cage.target}. Place ${cage.target} there.`,
    });
  }
  return null;
}

function nakedSingle(ctx: Ctx, s: State): PuzzleStep | null {
  for (let i = 0; i < s.values.length; i++) {
    if (!empty(s, i) || popcount(s.cands[i]) !== 1) continue;
    const d = digitsOf(s.cands[i])[0];
    return mk('nakedSingle', {
      placements: [{ cell: i, digit: d }],
      pattern: [i],
      keys: [{ cell: i, digit: d }],
      explanation: `${nm(ctx, i)} has only one candidate left: ${d}. Place ${d} there.`,
    });
  }
  return null;
}

function hiddenSingle(ctx: Ctx, s: State): PuzzleStep | null {
  for (let li = 0; li < ctx.lines.length; li++) {
    const line = ctx.lines[li];
    for (let d = 1; d <= ctx.n; d++) {
      if (line.some((i) => s.values[i] === d)) continue;
      const pos = withDigit(s, line, d);
      if (pos.length !== 1) continue;
      const c = pos[0];
      return mk('hiddenSingle', {
        placements: [{ cell: c, digit: d }],
        pattern: [c],
        keys: [{ cell: c, digit: d }],
        unitCells: line,
        explanation: `In ${lineName(ctx, li)}, ${d} can only go in ${nm(ctx, c)}. Place ${d} there.`,
      });
    }
  }
  return null;
}

function lastCageCell(ctx: Ctx, s: State): PuzzleStep | null {
  for (let ci = 0; ci < ctx.cages.length; ci++) {
    const cage = ctx.cages[ci];
    if (cage.op === '=') continue;
    const open = cage.cells.filter((c) => empty(s, c));
    if (open.length !== 1) continue;
    const c = open[0];
    const k = cage.cells.indexOf(c);
    // Options from the arithmetic and the placed cage cells alone.
    const full = s.values.map(() => ctx.full);
    const options = uniq(validTuples(ctx, ci, s.values, full).map((t) => t[k])).sort((a, b) => a - b);
    const fits = options.filter((d) => hasBit(s.cands[c], d));
    if (fits.length !== 1) continue;
    const d = fits[0];
    const placed = cage.cells.filter((x) => x !== c);
    const pv = placed.map((x) => s.values[x]);
    let why: string;
    if (placed.length === 1) why = `${nm(ctx, placed[0])} is ${pv[0]}`;
    else if (cage.op === '+') why = `the other cells add up to ${pv.reduce((a, b) => a + b, 0)}`;
    else if (cage.op === '*') why = `the other cells multiply to ${pv.reduce((a, b) => a * b, 1)}`;
    else why = `${nm(ctx, placed[0])} is ${pv[0]}`;
    const choice =
      options.length > 1
        ? `${nm(ctx, c)} would have to be ${joinAnd(options.map(String)).replace(/ and /, ' or ')}, and only ${d} is still possible there`
        : `${nm(ctx, c)} must be ${d}`;
    return mk('lastCageCell', {
      placements: [{ cell: c, digit: d }],
      pattern: [c],
      keys: [{ cell: c, digit: d }],
      unitCells: cage.cells,
      explanation: `${nm(ctx, c)} is the last empty cell of ${cageName(ctx, ci)}. Since ${why}, ${choice}. Place ${d} there.`,
    });
  }
  return null;
}

// ---------- tier 1: cage combinations, pairs ----------

function cageCombination(ctx: Ctx, s: State): PuzzleStep | null {
  for (const ci of cageOrder(ctx)) {
    const cage = ctx.cages[ci];
    if (cage.cells.every((c) => !empty(s, c))) continue;
    const tuples = validTuples(ctx, ci, s.values, s.cands);
    if (!tuples.length) continue;
    const elims = cageElims(ctx, s, ci, tuples);
    if (!elims.length) continue;
    const open = cage.cells.filter((c) => empty(s, c));
    const inAny = tuples.reduce((m, t) => t.reduce((mm, d) => mm | bit(d), m), 0);
    const absent = uniq(elims.map((e) => e.digit).filter((d) => !hasBit(inAny, d))).sort((a, b) => a - b);
    const placed = cage.cells.filter((c) => !empty(s, c));
    const k = cage.cells.length;
    const intro =
      k === 1
        ? `${nm(ctx, cage.cells[0])} is a single-cell cage`
        : `${cage.cells.map((x) => nm(ctx, x)).join('–')} is a ${k}-cell ${cageLabel(cage)} cage`;
    const given = placed.length
      ? ` With ${placed.map((p) => `${nm(ctx, p)} = ${s.values[p]}`).join(', ')} and the candidates in ${cellList(ctx, open)}`
      : ` Using the candidates in its cells (and remembering that cells in the same row or column must differ)`;
    const absentText = absent.length ? ` ${digitList(absent)} ${absent.length > 1 ? 'are' : 'is'} in none of them.` : '';
    const arranged = elims.filter((e) => !absent.includes(e.digit));
    const arrangedText = arranged.length
      ? ` ${absent.length ? 'Also, n' : 'N'}o working arrangement puts ${joinAnd(arranged.map((e) => `${e.digit} in ${nm(ctx, e.cell)}`))}.`
      : '';
    return mk('cageCombination', {
      eliminations: elims,
      pattern: cage.cells,
      keys: keysOf(s, open, tupleUnion(k, tuples).reduce((a, b) => a | b, 0)).filter(
        (kc) => !elims.some((e) => e.cell === kc.cell && e.digit === kc.digit),
      ),
      unitCells: cage.cells,
      explanation:
        `${intro}.${given}, the only combinations that still work are ${comboText(tuples)}.${absentText}${arrangedText} ` +
        `Remove ${elimText(ctx, elims)}.`,
    });
  }
  return null;
}

const SUBSET_WORD = ['', '', 'pair', 'triple', 'quad'];

function nakedSubset(n: number, id: Id) {
  return (ctx: Ctx, s: State): PuzzleStep | null => {
    for (let li = 0; li < ctx.lines.length; li++) {
      const cells = ctx.lines[li].filter((i) => empty(s, i));
      if (cells.length <= n) continue;
      const small = cells.filter((i) => {
        const p = popcount(s.cands[i]);
        return p >= 2 && p <= n;
      });
      if (small.length < n) continue;
      for (const combo of combinations(small, n)) {
        const union = combo.reduce((m, i) => m | s.cands[i], 0);
        if (popcount(union) !== n) continue;
        const ds = digitsOf(union);
        const elims: CellDigit[] = [];
        for (const i of cells) {
          if (combo.includes(i)) continue;
          for (const d of ds) if (hasBit(s.cands[i], d)) elims.push({ cell: i, digit: d });
        }
        if (!elims.length) continue;
        const ln = lineName(ctx, li);
        return mk(id, {
          eliminations: elims,
          pattern: combo,
          keys: keysOf(s, combo),
          unitCells: ctx.lines[li],
          explanation:
            `Naked ${SUBSET_WORD[n]}: in ${ln}, the ${n} cells ${cellList(ctx, combo)} only contain the candidates ${digitList(ds)}. ` +
            `Those cells must hold exactly those ${n} digits, so they can't appear anywhere else in ${ln}. Remove ${elimText(ctx, elims)}.`,
        });
      }
    }
    return null;
  };
}

function hiddenSubset(n: number, id: Id) {
  return (ctx: Ctx, s: State): PuzzleStep | null => {
    for (let li = 0; li < ctx.lines.length; li++) {
      const line = ctx.lines[li];
      const positions = new Map<number, number[]>();
      for (let d = 1; d <= ctx.n; d++) {
        if (line.some((i) => s.values[i] === d)) continue;
        const pos = withDigit(s, line, d);
        if (pos.length >= 2 && pos.length <= n) positions.set(d, pos);
      }
      const digits = [...positions.keys()];
      if (digits.length < n) continue;
      for (const combo of combinations(digits, n)) {
        const where = uniq(combo.flatMap((d) => positions.get(d)!));
        if (where.length !== n) continue;
        const keep = combo.reduce((m, d) => m | bit(d), 0);
        const elims: CellDigit[] = [];
        for (const i of where) for (const d of digitsOf(s.cands[i] & ~keep)) elims.push({ cell: i, digit: d });
        if (!elims.length) continue;
        return mk(id, {
          eliminations: elims,
          pattern: where,
          keys: keysOf(s, where, keep),
          unitCells: line,
          explanation:
            `Hidden ${SUBSET_WORD[n]}: in ${lineName(ctx, li)}, the digits ${digitList(combo)} can only go in ${cellList(ctx, where)}. ` +
            `Those ${n} cells must therefore hold exactly those digits, so every other candidate in them can be removed: ${elimText(ctx, elims)}.`,
        });
      }
    }
    return null;
  };
}

// ---------- tier 2: cage/line interactions ----------

/** If every valid completion of a cage puts d in line L (inside the cage), d leaves the rest of L. */
function cagePointing(ctx: Ctx, s: State): PuzzleStep | null {
  const { n } = ctx;
  for (const ci of cageOrder(ctx)) {
    const cage = ctx.cages[ci];
    if (cage.cells.length < 2 || cage.cells.every((c) => !empty(s, c))) continue;
    const tuples = validTuples(ctx, ci, s.values, s.cands);
    if (!tuples.length) continue;
    const lineIds = uniq(cage.cells.flatMap((c) => [rowOf(n, c), n + colOf(n, c)]));
    for (const li of lineIds) {
      const line = ctx.lines[li];
      const inLine = cage.cells.map((c) => line.includes(c));
      for (let d = 1; d <= n; d++) {
        if (line.some((i) => s.values[i] === d)) continue;
        // Placed-in-cage occurrences are covered by "line already has d".
        if (!tuples.every((t) => t.some((x, k) => inLine[k] && x === d))) continue;
        const outside = line.filter((i) => !cage.cells.includes(i));
        const elims = withDigit(s, outside, d).map((cell) => ({ cell, digit: d }));
        if (!elims.length) continue;
        const where = cage.cells.filter((c, k) => inLine[k] && empty(s, c) && hasBit(s.cands[c], d));
        const ln = lineName(ctx, li);
        const confined = cage.cells.every((_, k) => inLine[k]);
        return mk('cagePointing', {
          eliminations: elims,
          pattern: cage.cells,
          keys: where.map((cell) => ({ cell, digit: d })),
          unitCells: uniq([...line, ...cage.cells]),
          explanation:
            `${confined ? `${cageName(ctx, ci)[0].toUpperCase()}${cageName(ctx, ci).slice(1)} lies entirely in ${ln}. ` : ''}` +
            `Every combination that still works for ${cageName(ctx, ci)} (${comboText(tuples)}) puts a ${d} in ${ln}` +
            `${where.length ? ` (in ${cellList(ctx, where)})` : ''}. ` +
            `So ${ln} gets its ${d} from this cage, and ${d} can be removed from the rest of ${ln}: ${cellList(ctx, elims.map((e) => e.cell))}.`,
        });
      }
    }
  }
  return null;
}

/** If all of a line's spots for d are in one cage, that cage must hold d there. */
function lineCage(ctx: Ctx, s: State): PuzzleStep | null {
  for (let li = 0; li < ctx.lines.length; li++) {
    const line = ctx.lines[li];
    for (let d = 1; d <= ctx.n; d++) {
      if (line.some((i) => s.values[i] === d)) continue;
      const pos = withDigit(s, line, d);
      if (pos.length < 2) continue;
      const cis = uniq(pos.map((c) => ctx.cageOf[c]));
      if (cis.length !== 1) continue;
      const ci = cis[0];
      const cage = ctx.cages[ci];
      const inLine = cage.cells.map((c) => line.includes(c));
      const all = validTuples(ctx, ci, s.values, s.cands);
      const tuples = all.filter((t) => t.some((x, k) => inLine[k] && x === d));
      if (!tuples.length || tuples.length === all.length) continue;
      const elims = cageElims(ctx, s, ci, tuples);
      if (!elims.length) continue;
      const ln = lineName(ctx, li);
      return mk('lineCage', {
        eliminations: elims,
        pattern: uniq([...pos, ...cage.cells]),
        keys: pos.map((cell) => ({ cell, digit: d })),
        unitCells: uniq([...line, ...cage.cells]),
        explanation:
          `In ${ln}, ${d} can only go in ${cellList(ctx, pos)}, ${pos.length === 2 ? 'both' : 'all'} inside ${cageName(ctx, ci)}. ` +
          `So that cage must contain a ${d} in ${ln}, which leaves only ${comboText(tuples)} for it. ` +
          `Remove ${elimText(ctx, elims)}.`,
      });
    }
  }
  return null;
}

// ---------- tier 3: fish, line sums ----------

const FISH_NAME = ['', '', 'X-Wing', 'Swordfish'];

function fish(size: number, id: Id) {
  return (ctx: Ctx, s: State): PuzzleStep | null => {
    const { n } = ctx;
    for (let d = 1; d <= n; d++) {
      for (const rowBase of [true, false]) {
        const base = rowBase ? ctx.rows : ctx.cols;
        const cover = rowBase ? ctx.cols : ctx.rows;
        const coverIdx = (i: number) => (rowBase ? colOf(n, i) : rowOf(n, i));
        const baseIdx = (i: number) => (rowBase ? rowOf(n, i) : colOf(n, i));
        const cand: { line: number; covers: number[]; cells: number[] }[] = [];
        for (let l = 0; l < n; l++) {
          const cells = withDigit(s, base[l], d);
          if (cells.length >= 2 && cells.length <= size) cand.push({ line: l, covers: cells.map(coverIdx), cells });
        }
        if (cand.length < size) continue;
        for (const combo of combinations(cand, size)) {
          const covers = uniq(combo.flatMap((c) => c.covers)).sort((a, b) => a - b);
          if (covers.length !== size) continue;
          const baseLines = combo.map((c) => c.line);
          const elims: CellDigit[] = [];
          for (const cl of covers) {
            for (const i of cover[cl]) {
              if (!baseLines.includes(baseIdx(i)) && empty(s, i) && hasBit(s.cands[i], d)) elims.push({ cell: i, digit: d });
            }
          }
          if (!elims.length) continue;
          const cells = combo.flatMap((c) => c.cells);
          const bw = rowBase ? 'rows' : 'columns';
          const cw = rowBase ? 'columns' : 'rows';
          return mk(id, {
            eliminations: elims,
            pattern: cells,
            keys: cells.map((cell) => ({ cell, digit: d })),
            unitCells: uniq([...baseLines.flatMap((l) => base[l]), ...covers.flatMap((l) => cover[l])]),
            explanation:
              `${FISH_NAME[size]} on ${d}: in ${bw} ${digitList(baseLines.map((l) => l + 1))}, ${d} can only go in ${cw} ${digitList(covers.map((l) => l + 1))}. ` +
              `Those ${bw} need their ${size} ${d}s in those ${size} ${cw}, which uses up every ${d} those ${cw} can hold. ` +
              `Remove ${d} from the rest of ${cw} ${digitList(covers.map((l) => l + 1))}: ${cellList(ctx, elims.map((e) => e.cell))}.`,
          });
        }
      }
    }
    return null;
  };
}

type TotalKind = 'sum' | 'product';

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));
const NUM_WORD = ['zero', 'once', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const orList = (vs: number[]) => joinAnd(vs.map(String)).replace(/ and (?=[^ ]*$)/, ' or ');

/**
 * A block of consecutive rows (or columns) holds 1..N exactly k times, so its
 * digits add up to k·N(N+1)/2 and multiply to (N!)^k. Every cage part inside
 * the block has a set of possible totals (from the cage's remaining
 * combinations). If all parts but one are fixed (or, in the general version,
 * whatever the others can total), the remaining part's total is restricted.
 */
function regionTotal(kind: TotalKind, general: boolean, id: Id) {
  return (ctx: Ctx, s: State): PuzzleStep | null => {
    const { n } = ctx;
    const isSum = kind === 'sum';
    const lineTotal = isSum ? (n * (n + 1)) / 2 : factorial(n);
    const tupleCache = new Map<number, number[][]>();
    const tuplesOf = (ci: number) => {
      let t = tupleCache.get(ci);
      if (!t) tupleCache.set(ci, (t = validTuples(ctx, ci, s.values, s.cands)));
      return t;
    };
    const combine = (a: number, b: number) => (isSum ? a + b : a * b);
    const partValue = (t: number[], mask: boolean[]) =>
      t.reduce((acc, d, j) => (mask[j] ? combine(acc, d) : acc), isSum ? 0 : 1);
    for (const isRow of [true, false]) {
      for (let k = 1; k < n; k++) {
        // Products of several lines get unwieldy for humans: single lines only.
        if (!isSum && k > 1) break;
        const total = isSum ? k * lineTotal : lineTotal;
        for (let a = 0; a + k <= n; a++) {
          const idx = (i: number) => (isRow ? rowOf(n, i) : colOf(n, i));
          const inside = (i: number) => idx(i) >= a && idx(i) < a + k;
          const region = (isRow ? ctx.rows : ctx.cols).slice(a, a + k).flat();
          if (region.every((i) => !empty(s, i))) continue;
          const cis = uniq(region.map((c) => ctx.cageOf[c]));
          const parts = cis.map((ci) => {
            const mask = ctx.cages[ci].cells.map(inside);
            const vals = uniq(tuplesOf(ci).map((t) => partValue(t, mask))).sort((x, y) => x - y);
            return { ci, mask, vals };
          });
          if (parts.some((p) => p.vals.length === 0)) continue;
          const open = parts.filter((p) => p.vals.length > 1);
          if (general ? open.length < 2 : open.length !== 1) continue;
          // prefix[i] / suffix[i]: possible totals of parts[0..i-1] / parts[i..].
          const m = parts.length;
          const conv = (acc: Set<number> | null, vals: number[]): Set<number> | null => {
            if (!acc) return null;
            const next = new Set<number>();
            for (const x of acc) for (const v of vals) next.add(combine(x, v));
            return next.size > 4000 ? null : next;
          };
          const prefix: (Set<number> | null)[] = [new Set([isSum ? 0 : 1])];
          for (let i = 0; i < m; i++) prefix.push(conv(prefix[i], parts[i].vals));
          const suffix: (Set<number> | null)[] = new Array(m + 1);
          suffix[m] = new Set([isSum ? 0 : 1]);
          for (let i = m - 1; i >= 0; i--) suffix[i] = conv(suffix[i + 1], parts[i].vals);
          for (const o of open) {
            const oi = parts.indexOf(o);
            const pre = prefix[oi];
            const suf = suffix[oi + 1];
            if (!pre || !suf) continue;
            // Does some total of the other parts complement v?
            const fits = (v: number) => {
              for (const a of pre) {
                const rest = isSum ? total - v - a : total / (v * a);
                if (Number.isInteger(rest) && suf.has(rest)) return true;
              }
              return false;
            };
            const allowed = new Set(o.vals.filter(fits));
            if (allowed.size === o.vals.length) continue;
            let otherVals: number[] = [];
            if (pre.size * suf.size <= 20000) {
              const ov = new Set<number>();
              for (const a of pre) for (const b of suf) ov.add(combine(a, b));
              otherVals = [...ov].sort((x, y) => x - y);
            }
            const tuples = tuplesOf(o.ci).filter((t) => allowed.has(partValue(t, o.mask)));
            if (!tuples.length || tuples.length === tuplesOf(o.ci).length) continue;
            const elims = cageElims(ctx, s, o.ci, tuples);
            if (!elims.length) continue;
            const cage = ctx.cages[o.ci];
            const partCells = cage.cells.filter((_, j) => o.mask[j]);
            const whole = partCells.length === cage.cells.length;
            const lw = isRow ? 'row' : 'column';
            const blk = k === 1 ? `${lw} ${a + 1}` : `${lw}s ${a + 1}–${a + k}`;
            const verb = isSum ? 'add up to' : 'multiply to';
            const totalText =
              k === 1
                ? `${blk[0].toUpperCase()}${blk.slice(1)} holds 1–${n} once, so its digits ${verb} ${total}`
                : `${blk[0].toUpperCase()}${blk.slice(1)} hold 1–${n} ${k === 2 ? 'twice' : `${NUM_WORD[k] ?? k} times`}, so their digits ${verb} ${total}`;
            const needVals = uniq(tuples.map((t) => partValue(t, o.mask))).sort((x, y) => x - y);
            const single = partCells.length === 1 && !whole;
            const subject = whole
              ? cageName(ctx, o.ci)
              : single
                ? `${nm(ctx, partCells[0])} (part of ${cageName(ctx, o.ci)})`
                : `the part of ${cageName(ctx, o.ci)} inside ${blk} (${cellList(ctx, partCells)})`;
            const pverb = single ? 'be' : verb;
            let reason: string;
            if (otherVals.length === 1) {
              reason = `Every other cage part in ${blk} has a fixed ${isSum ? 'sum' : 'product'}, together ${otherVals[0]}. So ${subject} must ${pverb} ${orList(needVals)}`;
            } else {
              const excluded = o.vals.filter((v) => !allowed.has(v));
              const complements = excluded.filter((v) => isSum || total % v === 0).map((v) => (isSum ? total - v : total / v));
              const nonDiv = excluded.filter((v) => !isSum && total % v !== 0);
              const parts2: string[] = [];
              if (complements.length) {
                parts2.push(
                  `the other cage parts in ${blk} can't ${isSum ? 'total' : 'multiply to'} ${orList(complements)}` +
                    (otherVals.length && otherVals.length <= 6 ? ` (they can only make ${orList(otherVals)})` : ''),
                );
              }
              if (nonDiv.length) parts2.push(`${orList(nonDiv)} doesn't divide ${total}`);
              reason =
                `${subject[0].toUpperCase()}${subject.slice(1)} could ${pverb} ${orList(o.vals)}, but ${parts2.join(', and ')}. ` +
                `So it must ${pverb} ${orList(needVals)}`;
            }
            return mk(id, {
              eliminations: elims,
              pattern: partCells,
              keys: keysOf(s, partCells.filter((c) => empty(s, c))),
              unitCells: region,
              explanation:
                `${totalText}. ${reason}, which leaves only ${comboText(tuples)} for the cage. Remove ${elimText(ctx, elims)}.`,
            });
          }
        }
      }
    }
    return null;
  };
}

// ---------- tier 4 ----------

function xyWing(ctx: Ctx, s: State): PuzzleStep | null {
  const bivalue = s.values.map((_, i) => i).filter((i) => empty(s, i) && popcount(s.cands[i]) === 2);
  const sees = (a: number, b: number) => a !== b && sameLine(ctx.n, a, b);
  for (const pivot of bivalue) {
    const [x, y] = digitsOf(s.cands[pivot]);
    const wings = bivalue.filter((w) => sees(pivot, w));
    for (const w1 of wings) {
      if (!hasBit(s.cands[w1], x) || hasBit(s.cands[w1], y)) continue;
      const z = digitsOf(s.cands[w1] & ~bit(x))[0];
      for (const w2 of wings) {
        if (w2 === w1 || s.cands[w2] !== (bit(y) | bit(z))) continue;
        const elims = s.values
          .map((_, i) => i)
          .filter((i) => i !== pivot && empty(s, i) && hasBit(s.cands[i], z) && sees(i, w1) && sees(i, w2))
          .map((cell) => ({ cell, digit: z }));
        if (!elims.length) continue;
        return mk('xyWing', {
          eliminations: elims,
          pattern: [pivot, w1, w2],
          keys: [
            { cell: pivot, digit: x, color: 1 },
            { cell: pivot, digit: y, color: 1 },
            { cell: w1, digit: z },
            { cell: w2, digit: z },
          ],
          explanation:
            `XY-Wing: ${nm(ctx, pivot)} is ${x} or ${y}. If it is ${x}, ${nm(ctx, w1)} (${x}/${z}) must be ${z}; ` +
            `if it is ${y}, ${nm(ctx, w2)} (${y}/${z}) must be ${z}. Either way one of those two cells is ${z}, ` +
            `so any cell sharing a row or column with both can't be ${z}: remove ${z} from ${cellList(ctx, elims.map((e) => e.cell))}.`,
        });
      }
    }
  }
  return null;
}

// ---------- registry ----------

export const TECHNIQUES: Technique[] = [
  { id: 'singleCage', ...T.singleCage, find: singleCage },
  { id: 'nakedSingle', ...T.nakedSingle, find: nakedSingle },
  { id: 'hiddenSingle', ...T.hiddenSingle, find: hiddenSingle },
  { id: 'lastCageCell', ...T.lastCageCell, find: lastCageCell },
  { id: 'cageCombination', ...T.cageCombination, find: cageCombination },
  { id: 'nakedPair', ...T.nakedPair, find: nakedSubset(2, 'nakedPair') },
  { id: 'hiddenPair', ...T.hiddenPair, find: hiddenSubset(2, 'hiddenPair') },
  { id: 'nakedTriple', ...T.nakedTriple, find: nakedSubset(3, 'nakedTriple') },
  { id: 'hiddenTriple', ...T.hiddenTriple, find: hiddenSubset(3, 'hiddenTriple') },
  { id: 'cagePointing', ...T.cagePointing, find: cagePointing },
  { id: 'lineCage', ...T.lineCage, find: lineCage },
  { id: 'xWing', ...T.xWing, find: fish(2, 'xWing') },
  { id: 'nakedQuad', ...T.nakedQuad, find: nakedSubset(4, 'nakedQuad') },
  { id: 'hiddenQuad', ...T.hiddenQuad, find: hiddenSubset(4, 'hiddenQuad') },
  { id: 'cageSum', ...T.cageSum, find: regionTotal('sum', false, 'cageSum') },
  { id: 'cageProduct', ...T.cageProduct, find: regionTotal('product', false, 'cageProduct') },
  { id: 'cageSumSets', ...T.cageSumSets, find: regionTotal('sum', true, 'cageSumSets') },
  { id: 'cageProductSets', ...T.cageProductSets, find: regionTotal('product', true, 'cageProductSets') },
  { id: 'xyWing', ...T.xyWing, find: xyWing },
  { id: 'swordfish', ...T.swordfish, find: fish(3, 'swordfish') },
];

export const TECHNIQUE_BY_ID: Record<string, Technique> = Object.fromEntries(TECHNIQUES.map((t) => [t.id, t]));

export function findStep(ctx: Ctx, s: State, maxTier = 4): PuzzleStep | null {
  for (const t of TECHNIQUES) {
    if (t.tier > maxTier) continue;
    const st = t.find(ctx, s);
    if (st) return st;
  }
  return null;
}

/** Apply a step: remove eliminations, place digits (clearing them from row/column peers). */
export function applyStep(ctx: Ctx, s: State, st: PuzzleStep): State {
  const values = s.values.slice();
  const cands = s.cands.slice();
  for (const e of st.eliminations) cands[e.cell] &= ~bit(e.digit);
  for (const p of st.placements) {
    values[p.cell] = p.digit;
    cands[p.cell] = 0;
    for (const q of ctx.peers[p.cell]) cands[q] &= ~bit(p.digit);
  }
  return { values, cands };
}
