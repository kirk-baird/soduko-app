// Pips puzzle engine (after the NYT game): generation, solving, grading and hints.
//
// Board: an irregular set of cells, split into coloured regions with rules
// (a total, less than, more than, all equal, all different) plus unconstrained
// cells. The player lays every domino from the tray (pips 0–6, all different)
// so that the dominoes cover every cell and every region's rule holds.
//
// Player state: place[k] = where domino k sits ([cell of its first pip count,
// cell of its second]) or null while it is still in the tray.

import { CellDigit, Difficulty, DifficultyInfo, PuzzleHint, PuzzleStep } from '../common';
import { Rng, shuffle } from '../rng';
import { Frame, MAX_PIP, PipsPuzzle, PipsRegion, Spot, cellName, domName, flipFree, listText, makeFrame, placeFor, placeText, regionSatisfied, spotOf, spotText } from './model';
import { PStep, RULES, SimResult, State, TIER0, TIER1, TIER2, applyStep, cellOpts, cloneState, domOpts, emptyState, findStep, makeCtx, onlyFitStep, onlySpotStep, putDown, simulate } from './rules';
import { solveFrame } from './solver';

export type { PipsPuzzle, PipsRegion, RegionKind, Spot } from './model';
export { regionLabel } from './model';

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

interface Level {
  dominoes: number;
  rows: number;
  cols: number;
  minTier: number;
  maxTier: number;
}

export const LEVELS: Record<Difficulty, Level> = {
  medium: { dominoes: 7, rows: 5, cols: 5, minTier: 0, maxTier: 0 },
  hard: { dominoes: 9, rows: 6, cols: 6, minTier: 1, maxTier: 2 },
  extraHard: { dominoes: 11, rows: 6, cols: 6, minTier: 3, maxTier: 3 },
  extreme: { dominoes: 13, rows: 7, cols: 7, minTier: 3, maxTier: 4 },
};

export const DIFFICULTY_INFO: Record<Difficulty, DifficultyInfo> = {
  medium: { label: 'Medium', description: `${LEVELS.medium.dominoes} dominoes, region rules only` },
  hard: { label: 'Hard', description: `${LEVELS.hard.dominoes} dominoes, counting halves and dead ends` },
  extraHard: { label: 'Extra Hard', description: `${LEVELS.extraHard.dominoes} dominoes, tiling splits and pairs` },
  extreme: { label: 'Extreme', description: `${LEVELS.extreme.dominoes} dominoes, what-if reasoning` },
};

const ALL_DOMINOES: [number, number][] = [];
for (let a = 0; a <= MAX_PIP; a++) for (let b = a; b <= MAX_PIP; b++) ALL_DOMINOES.push([a, b]);

// ---------- solving ----------

/** Counts solutions up to `limit`. */
export function solve(p: PipsPuzzle, limit = 2): { count: number; solution: Spot[] | null } {
  const f = makeFrame(p);
  const r = solveFrame(f, limit);
  if (!r.solution) return { count: r.count, solution: null };
  const out: Spot[] = new Array(p.dominoes.length);
  for (const pid of r.solution) out[f.places[pid].d] = spotOf(f, pid);
  return { count: r.count, solution: out };
}

/** Logical solve from an empty board using rules up to maxTier. */
export function grade(p: PipsPuzzle, maxTier = 4): { solved: boolean; maxTier: number; steps: number; counts: Record<string, number> } {
  const f = makeFrame(p);
  const s = emptyState(f);
  const counts: Record<string, number> = {};
  let top = 0;
  let steps = 0;
  for (let guard = 0; guard < 4 * f.places.length && !s.domAt.every((x) => x >= 0); guard++) {
    const st = findStep(f, s, maxTier);
    if (!st) break;
    steps++;
    top = Math.max(top, st.tier);
    counts[st.technique] = (counts[st.technique] ?? 0) + 1;
    applyStep(f, s, st);
  }
  return { solved: s.domAt.every((x) => x >= 0), maxTier: top, steps, counts };
}

// ---------- generation ----------

const DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** Grows a connected board one domino at a time inside the level's box; the dominoes grown are the solution's tiling. */
function randomTiling(level: Level, rng: Rng): [number, number][] | null {
  const { rows, cols, dominoes: k } = level;
  const used = new Set<number>();
  const pairs: [number, number][] = [];
  const nb = (i: number) =>
    DIRS.map(([dr, dc]) => [Math.floor(i / cols) + dr, (i % cols) + dc])
      .filter(([r, c]) => r >= 0 && c >= 0 && r < rows && c < cols)
      .map(([r, c]) => r * cols + c);
  const r0 = Math.floor(rows / 2);
  const c0 = Math.floor((cols - 1) / 2);
  const first: [number, number] = rng() < 0.5 ? [r0 * cols + c0, r0 * cols + c0 + 1] : [(r0 - 1) * cols + c0, r0 * cols + c0];
  pairs.push(first);
  used.add(first[0]);
  used.add(first[1]);
  while (pairs.length < k) {
    const cands: [number, number][] = [];
    for (const x of used) {
      for (const y of nb(x)) {
        if (used.has(y)) continue;
        for (const z of nb(y)) if (!used.has(z)) cands.push([y, z]);
      }
    }
    if (!cands.length) return null;
    const pick = cands[Math.floor(rng() * cands.length)];
    pairs.push(pick);
    used.add(pick[0]);
    used.add(pick[1]);
  }
  return pairs;
}

const SIZE_WEIGHTS = [0, 26, 34, 22, 13, 5]; // region sizes 1..5

function randomSize(rng: Rng): number {
  const total = SIZE_WEIGHTS.reduce((a, b) => a + b, 0);
  let x = rng() * total;
  for (let s = 1; s < SIZE_WEIGHTS.length; s++) {
    x -= SIZE_WEIGHTS[s];
    if (x < 0) return s;
  }
  return 1;
}

/** Random connected regions covering every cell, each with the strongest rule its values allow. */
function randomRegions(cells: number[], cols: number, value: Map<number, number>, rng: Rng): PipsRegion[] {
  const left = new Set(cells);
  const regions: PipsRegion[] = [];
  const nb = (i: number) => [i - cols, i + cols, i % cols ? i - 1 : -1, (i + 1) % cols ? i + 1 : -1].filter((j) => left.has(j));
  for (const start of shuffle(cells.slice(), rng)) {
    if (!left.has(start)) continue;
    const size = randomSize(rng);
    const reg = [start];
    left.delete(start);
    while (reg.length < size) {
      const frontier = [...new Set(reg.flatMap(nb))];
      if (!frontier.length) break;
      const j = frontier[Math.floor(rng() * frontier.length)];
      reg.push(j);
      left.delete(j);
    }
    reg.sort((a, b) => a - b);
    regions.push(ruleFor(reg, value, rng));
  }
  return regions;
}

function ruleFor(cells: number[], value: Map<number, number>, rng: Rng): PipsRegion {
  const vals = cells.map((c) => value.get(c)!);
  const sum = vals.reduce((a, b) => a + b, 0);
  if (cells.length >= 2 && vals.every((v) => v === vals[0]) && rng() < 0.75) return { cells, kind: 'equal' };
  if (cells.length >= 3 && new Set(vals).size === vals.length && rng() < 0.35) return { cells, kind: 'unequal' };
  return { cells, kind: 'sum', target: sum };
}

/** Looser versions of region k (or of the whole set), each a full region list. */
function weakenings(p: PipsPuzzle, k: number, value: Map<number, number>, cols: number, rng: Rng): PipsRegion[][] {
  const r = p.regions[k];
  const others = p.regions.filter((_, j) => j !== k);
  const out: PipsRegion[][] = [];
  const blankCells = p.cells.length - p.regions.reduce((a, x) => a + x.cells.length, 0);
  if (blankCells + r.cells.length <= p.cells.length * 0.45) out.push(others);
  if (r.kind === 'sum') {
    const sum = r.target!;
    const maxSum = MAX_PIP * r.cells.length;
    const slack = 1 + Math.floor(rng() * 3);
    if (sum + slack <= maxSum) out.push([...others, { cells: r.cells, kind: 'less', target: sum + slack }]);
    if (sum - slack >= 0) out.push([...others, { cells: r.cells, kind: 'greater', target: sum - slack }]);
    // merge with a neighbouring sum region
    const mine = new Set(r.cells);
    const touching = p.regions
      .map((x, j) => ({ x, j }))
      .filter(({ x, j }) => j !== k && x.kind === 'sum' && x.cells.length + r.cells.length <= 6)
      .filter(({ x }) => x.cells.some((c) => mine.has(c - cols) || mine.has(c + cols) || (c % cols && mine.has(c - 1)) || ((c + 1) % cols && mine.has(c + 1))));
    if (touching.length) {
      const { x, j } = touching[Math.floor(rng() * touching.length)];
      const cells = [...r.cells, ...x.cells].sort((a, b) => a - b);
      const merged: PipsRegion = { cells, kind: 'sum', target: cells.reduce((a, c) => a + value.get(c)!, 0) };
      out.push([...p.regions.filter((_, i) => i !== k && i !== j), merged]);
    }
  }
  return shuffle(out, rng);
}

const sortRegions = (rs: PipsRegion[]) => rs.slice().sort((a, b) => a.cells[0] - b.cells[0]);

/** Connected pieces of a set of cells. */
function components(cells: number[], cols: number): number[][] {
  const left = new Set(cells);
  const out: number[][] = [];
  for (const c of cells) {
    if (!left.has(c)) continue;
    const comp = [c];
    left.delete(c);
    for (let i = 0; i < comp.length; i++) {
      const x = comp[i];
      for (const y of [x - cols, x + cols, x % cols ? x - 1 : -1, (x + 1) % cols ? x + 1 : -1]) {
        if (left.has(y)) {
          left.delete(y);
          comp.push(y);
        }
      }
    }
    out.push(comp.sort((a, b) => a - b));
  }
  return out;
}

/**
 * Makes the puzzle unique by repeatedly finding a second solution and giving
 * one cell where it differs from the intended one a region of its own. Null if
 * that can't work (two tilings with the same pips everywhere).
 */
function tighten(p: PipsPuzzle, value: Map<number, number>, rng: Rng): PipsPuzzle | null {
  for (let round = 0; round < 40; round++) {
    const f = makeFrame(p);
    const r = solveFrame(f, 2);
    if (r.count === 0) return null;
    if (r.count === 1) return p;
    const other = r.solutions.find((sol) => sol.some((pid) => isWrongSpot(p, f.places[pid].d, spotOf(f, pid))))!;
    const got = new Map<number, number>();
    for (const pid of other) {
      const pl = f.places[pid];
      got.set(f.grid[pl.u], pl.a);
      got.set(f.grid[pl.v], pl.b);
    }
    const differ = p.cells.filter((c) => got.get(c) !== value.get(c));
    if (!differ.length) return null;
    const cell = differ[Math.floor(rng() * differ.length)];
    const k = p.regions.findIndex((x) => x.cells.includes(cell));
    const regions = p.regions.filter((_, j) => j !== k);
    regions.push({ cells: [cell], kind: 'sum', target: value.get(cell)! });
    if (k >= 0) {
      const rest = p.regions[k].cells.filter((c) => c !== cell);
      for (const comp of components(rest, p.cols)) regions.push(ruleFor(comp, value, rng));
    }
    p = { ...p, regions: sortRegions(regions) };
  }
  return null;
}

/**
 * Generates a puzzle with a unique solution whose logical solve needs rules
 * within the difficulty's tier range, or null if none was found in
 * `maxAttempts` random boards.
 */
export function generate(difficulty: Difficulty, rng: Rng, maxAttempts = 60): PipsPuzzle | null {
  const level = LEVELS[difficulty];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const tiling = randomTiling(level, rng);
    if (!tiling) continue;
    const doms = shuffle(ALL_DOMINOES.slice(), rng).slice(0, level.dominoes);
    const placed = tiling.map((pair, i) => {
      const spot: Spot = rng() < 0.5 ? [pair[0], pair[1]] : [pair[1], pair[0]];
      return { dom: doms[i], spot };
    });
    placed.sort((x, y) => x.dom[0] - y.dom[0] || x.dom[1] - y.dom[1]);
    const value = new Map<number, number>();
    for (const { dom, spot } of placed) {
      value.set(spot[0], dom[0]);
      value.set(spot[1], dom[1]);
    }
    const cells = [...value.keys()].sort((a, b) => a - b);
    // Trim empty rows/columns so the board sits in its own bounding box.
    const rs = cells.map((c) => Math.floor(c / level.cols));
    const cs = cells.map((c) => c % level.cols);
    const r0 = Math.min(...rs);
    const c0 = Math.min(...cs);
    const rows = Math.max(...rs) - r0 + 1;
    const cols = Math.max(...cs) - c0 + 1;
    const remap = (g: number) => (Math.floor(g / level.cols) - r0) * cols + ((g % level.cols) - c0);
    const val = new Map<number, number>();
    for (const [g, v] of value) val.set(remap(g), v);
    const base = {
      rows,
      cols,
      cells: cells.map(remap).sort((a, b) => a - b),
      dominoes: placed.map((x) => x.dom),
      solution: placed.map((x) => [remap(x.spot[0]), remap(x.spot[1])] as Spot),
    };
    let p: PipsPuzzle | null = tighten({ ...base, regions: sortRegions(randomRegions(base.cells, cols, val, rng)) }, val, rng);
    if (p && !grade(p, level.maxTier).solved) p = null;
    if (!p) continue;
    // Loosen rules while the puzzle stays unique and solvable within the level.
    for (let pass = 0; pass < 2; pass++) {
      let changed = false;
      for (const k of shuffle(p.regions.map((_, i) => i), rng)) {
        if (k >= p.regions.length) continue;
        for (const regions of weakenings(p, k, val, cols, rng)) {
          const q: PipsPuzzle = { ...p, regions: sortRegions(regions) };
          if (solve(q, 2).count === 1 && grade(q, level.maxTier).solved) {
            p = q;
            changed = true;
            break;
          }
        }
      }
      if (!changed) break;
    }
    const g = grade(p, level.maxTier);
    if (!g.solved || g.maxTier < level.minTier) continue;
    return p;
  }
  return null;
}

// ---------- player support ----------

export type Placement = (Spot | null)[];

/** Same cells, same way round (or flipped, where flipping makes no difference). */
export const sameSpot = (p: PipsPuzzle, k: number, a: Spot, b: Spot) =>
  (a[0] === b[0] && a[1] === b[1]) ||
  (a[0] === b[1] && a[1] === b[0] && (p.dominoes[k][0] === p.dominoes[k][1] || flipFree(makeFrame(p), a)));

export const isWrongSpot = (p: PipsPuzzle, k: number, spot: Spot) => !sameSpot(p, k, spot, p.solution[k]);

/** Dominoes on the board that aren't where the solution has them. */
export const wrongDominoes = (p: PipsPuzzle, place: Placement) =>
  place.map((s, k) => (s && isWrongSpot(p, k, s) ? k : -1)).filter((k) => k >= 0);

/** Pip count on each covered cell (grid index -> value). */
export function cellValues(p: PipsPuzzle, place: Placement): Map<number, number> {
  const out = new Map<number, number>();
  place.forEach((s, k) => {
    if (!s) return;
    out.set(s[0], p.dominoes[k][0]);
    out.set(s[1], p.dominoes[k][1]);
  });
  return out;
}

/** Every domino down, every cell covered once, every region's rule met. */
export function isSolved(p: PipsPuzzle, place: Placement): boolean {
  if (place.some((s) => !s)) return false;
  const vals = cellValues(p, place);
  if (vals.size !== p.cells.length || p.cells.some((c) => !vals.has(c))) return false;
  return p.regions.every((r) => regionSatisfied(r.kind, r.target ?? 0, r.cells.map((c) => vals.get(c)!)));
}

/** Does a region's rule hold, fail, or is it still open (some cells empty)? */
export function regionStatus(r: PipsRegion, vals: Map<number, number>): 'open' | 'ok' | 'broken' {
  if (r.cells.some((c) => !vals.has(c))) return 'open';
  return regionSatisfied(r.kind, r.target ?? 0, r.cells.map((c) => vals.get(c)!)) ? 'ok' : 'broken';
}

function stateFrom(f: Frame, place: Placement): State {
  const s = emptyState(f);
  place.forEach((spot, k) => {
    if (!spot) return;
    const pid = placeFor(f, k, spot);
    if (pid >= 0 && s.alive[pid]) putDown(f, s, pid);
  });
  return s;
}

const cellNameOf = (p: PipsPuzzle, g: number) => `R${Math.floor(g / p.cols) + 1}C${(g % p.cols) + 1}`;

/** A domino placement as hint placements: its two cells with their pip counts. */
function spotPlacements(p: PipsPuzzle, k: number, spot: Spot): CellDigit[] {
  return [
    { cell: spot[0], digit: p.dominoes[k][0] },
    { cell: spot[1], digit: p.dominoes[k][1] },
  ];
}

/** The tray domino a hint puts down, with its spot. */
export function hintMove(p: PipsPuzzle, step: PuzzleStep): { k: number; spot: Spot } | null {
  if (step.placements.length !== 2) return null;
  const [x, y] = step.placements;
  const k = p.dominoes.findIndex(([a, b]) => a === x.digit && b === y.digit);
  if (k >= 0) return { k, spot: [x.cell, y.cell] };
  const j = p.dominoes.findIndex(([a, b]) => a === y.digit && b === x.digit);
  return j >= 0 ? { k: j, spot: [y.cell, x.cell] } : null;
}

export function findHint(p: PipsPuzzle, place: Placement): PuzzleHint {
  const wrong = wrongDominoes(p, place);
  if (wrong.length) {
    const cells = wrong.flatMap((k) => place[k]!).sort((a, b) => a - b);
    const names = wrong.map((k) => `the ${p.dominoes[k][0]}|${p.dominoes[k][1]}`);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return {
      kind: 'wrongValue',
      cells,
      message: `${list.charAt(0).toUpperCase() + list.slice(1)} ${wrong.length === 1 ? "isn't" : "aren't"} in the right place. Fix ${wrong.length === 1 ? 'that' : 'those'} first — logic built on a mistake will go astray.`,
    };
  }
  if (isSolved(p, place)) return { kind: 'solved', message: 'The puzzle is solved!' };

  const f = makeFrame(p);
  const s = stateFrom(f, place);
  const steps: PStep[] = [];
  const killedBy = new Int32Array(f.places.length).fill(-1);

  /**
   * One step up to maxTier. Returns every placement forced at that point if the
   * step puts a domino down, [] after an elimination, or null when stuck.
   */
  const advance = (maxTier: number): PStep[] | null => {
    // Each step keeps a snapshot of the board it was found on, for its premises.
    const snap = cloneState(s);
    const st = findStep(f, snap, maxTier);
    if (!st) return null;
    if (st.place >= 0) {
      const ctx = makeCtx(f, snap);
      const opts = cellOpts(ctx);
      const dopts = domOpts(ctx);
      const finals = [st];
      for (let c = 0; c < f.n; c++) if (snap.cellAt[c] < 0 && opts[c].length === 1) finals.push(onlyFitStep(ctx, c));
      for (let d = 0; d < f.doms.length; d++) if (snap.domAt[d] < 0 && dopts[d].length === 1) finals.push(onlySpotStep(ctx, d));
      return finals.filter((x) => !isWrongSpot(p, f.places[x.place].d, spotOf(f, x.place)));
    }
    for (const q of st.kills) if (killedBy[q] < 0) killedBy[q] = steps.length;
    steps.push(st);
    applyStep(f, s, st);
    return [];
  };

  /** The earlier steps (and which of their eliminations) a conclusion really relies on. */
  const explain = (premise: number[]) => {
    const keep = new Map<number, Set<number>>();
    const seen = new Set<number>();
    const queue = premise.slice();
    while (queue.length) {
      const q = queue.pop()!;
      if (seen.has(q)) continue;
      seen.add(q);
      const i = killedBy[q];
      if (i < 0) continue; // ruled out by the dominoes already on the board
      let set = keep.get(i);
      if (!set) keep.set(i, (set = new Set()));
      set.add(q);
      queue.push(...steps[i].premise(q));
    }
    const order = [...keep.keys()].sort((x, y) => x - y);
    return {
      size: keep.size,
      tier: Math.max(0, ...order.map((i) => steps[i].tier)),
      entries: order.map((i) => ({ step: steps[i], text: steps[i].render ? steps[i].render!([...keep.get(i)!]) : steps[i].explanation })),
    };
  };

  /**
   * The sentences worth reading: one-cell rules ("R2C3 must be 4") are on the
   * board already, and around a what-if only the non-basic steps are spelled
   * out. Very long chains keep their last steps.
   */
  const wording = (why: ReturnType<typeof explain>, minTier: number): string[] => {
    const texts = why.entries
      .filter(({ step }) => !(step.technique === 'region' && step.unit.length === 1) && step.tier >= minTier)
      .map((e) => e.text);
    const BUDGET = 1100;
    let total = 0;
    let from = texts.length;
    while (from > 0 && total + texts[from - 1].length <= BUDGET) total += texts[--from].length;
    if (from === texts.length && texts.length) from--; // always keep at least one
    return from > 0 ? ['This one takes a long chain of reasoning; here are its last steps.', ...texts.slice(from)] : texts;
  };

  const hintStep = (
    pid: number,
    why: ReturnType<typeof explain>,
    texts: string[],
    lead: { technique: string; name: string; tier: number },
    tail: string,
    extra: number[] = [],
  ): PuzzleHint => {
    const k = f.places[pid].d;
    const spot = spotOf(f, pid);
    let name = lead;
    for (const { step } of why.entries) if (step.tier > name.tier) name = step;
    const unit = new Set([...why.entries.flatMap(({ step }) => [...step.unit, ...step.pattern]), ...extra].map((c) => f.grid[c]));
    for (const c of spot) unit.delete(c);
    // On its own, the final sentence doesn't follow from anything: drop its "So".
    const last = texts.length ? tail : tail.replace(/^So (\w)/, (_, ch: string) => ch.toUpperCase());
    return {
      kind: 'step',
      step: {
        technique: name.technique,
        name: name.name,
        tier: Math.max(why.tier, lead.tier),
        placements: spotPlacements(p, k, spot),
        eliminations: [],
        pattern: [...spot],
        keys: [],
        unitCells: [...unit].sort((a, b) => a - b),
        explanation: [...texts, last].join(' '),
      },
    };
  };

  const placementHint = (finals: PStep[]): PuzzleHint => {
    const best = finals
      .map((fin) => ({ fin, why: explain(fin.premise(fin.place)) }))
      .sort((x, y) => Math.max(x.fin.tier, x.why.tier) - Math.max(y.fin.tier, y.why.tier) || x.why.size - y.why.size)[0];
    const minTier = Math.max(best.fin.tier, best.why.tier) >= 3 ? 1 : 0;
    return hintStep(best.fin.place, best.why, wording(best.why, minTier), best.fin, best.fin.explanation);
  };

  const splitHint = (split: CaseSplit): PuzzleHint => {
    const why = explain(split.premise);
    const deep = split.branches.some((b) => b.r.briefs.length > 6);
    const lead = deep ? { technique: 'caseSplit', name: 'Deep What If', tier: 4 } : { technique: 'caseSplit', name: 'What If', tier: 3 };
    const optionList = listText(split.options.map((q) => (split.isDom ? spotText(f, q) : placeText(f, q))), 6, 'or');
    const head = split.isDom ? `${cap(split.label)} can only go on ${optionList}.` : `${cap(split.label)} can only take ${optionList}.`;
    const cases = split.branches.map(({ q, r }) => {
      const what = split.isDom ? `it went on ${spotText(f, q)}` : `it took ${placeText(f, q)}`;
      return r.briefs.length ? `If ${what}, then ${r.briefs.join('; ')}; but then ${r.why}.` : `If ${what}, ${r.why}.`;
    });
    const cells = split.branches.flatMap((b) => [f.places[b.q].u, f.places[b.q].v, ...b.r.cells]);
    const tail = [head, ...cases, `So ${placeText(f, split.survivor)} is the only one that works.`].join(' ');
    return hintStep(split.survivor, why, wording(why, 1), lead, tail, cells);
  };

  // 1. Plain deductions (no what-ifs).
  for (let guard = 0; guard < 400; guard++) {
    const finals = advance(2);
    if (!finals) break;
    if (finals.length) return placementHint(finals);
  }
  // 2. Stuck: try each spot left for a cell or a domino.
  let split = caseSplit(f, s);
  if (split) return splitHint(split);
  // 3. The full engine, what-ifs and all, trying a case split again after each what-if.
  for (let guard = 0; guard < 400; guard++) {
    const finals = advance(4);
    if (!finals) break;
    if (finals.length) return placementHint(finals);
    if (steps[steps.length - 1].tier >= 3 && (split = caseSplit(f, s))) return splitHint(split);
  }
  // 4. Beyond the rules' reach (shouldn't happen for generated puzzles): reveal a domino.
  const k = place.findIndex((x) => !x);
  const spot = p.solution[k];
  const [a, b] = p.dominoes[k];
  return {
    kind: 'step',
    step: {
      technique: 'reveal',
      name: 'Reveal',
      tier: 0,
      placements: spotPlacements(p, k, spot),
      eliminations: [],
      pattern: [...spot],
      keys: [],
      unitCells: [],
      explanation: `No logical step found with the rules I know. The ${a}|${b} goes on ${cellNameOf(p, spot[0])}–${cellNameOf(p, spot[1])}${a === b ? '' : ` (${a} on ${cellNameOf(p, spot[0])})`}.`,
    },
  };
}

interface CaseSplit {
  label: string; // 'R2C3' or 'the 3|3'
  isDom: boolean;
  options: number[];
  premise: number[]; // why the other spots are already out
  survivor: number;
  branches: { q: number; r: SimResult }[];
}

/**
 * A cell or domino with only a few placements left where all but one lead to
 * a contradiction within a few plain steps. Prefers fewer options, then
 * shorter chains.
 */
function caseSplit(f: Frame, s: State, maxOptions = 6, maxSteps = 14): CaseSplit | null {
  const ctx = makeCtx(f, s);
  const opts = cellOpts(ctx);
  const dopts = domOpts(ctx);
  const targets: Omit<CaseSplit, 'survivor' | 'branches'>[] = [];
  for (let c = 0; c < f.n; c++) {
    if (s.cellAt[c] < 0 && opts[c].length >= 2 && opts[c].length <= maxOptions)
      targets.push({ label: cellName(f, c), isDom: false, options: opts[c], premise: f.byCell[c].filter((q) => !s.alive[q]) });
  }
  for (let d = 0; d < f.doms.length; d++) {
    if (s.domAt[d] < 0 && dopts[d].length >= 2 && dopts[d].length <= maxOptions)
      targets.push({ label: `the ${domName(f, d)}`, isDom: true, options: dopts[d], premise: f.byDom[d].filter((q) => !s.alive[q]) });
  }
  targets.sort((x, y) => x.options.length - y.options.length);
  const rules = [...TIER0, ...TIER1, ...TIER2];
  let best: { split: CaseSplit; score: number } | null = null;
  for (const t of targets) {
    // Each option costs at least one sentence: stop once nothing left can beat the best.
    if (best && t.options.length - 1 >= best.score) break;
    const branches: { q: number; r: SimResult }[] = [];
    const survivors: number[] = [];
    let score = 0;
    for (const q of t.options) {
      const s2 = cloneState(s);
      putDown(f, s2, q);
      const r = simulate(f, s2, rules, true, maxSteps);
      if (r) {
        branches.push({ q, r });
        score += r.briefs.length + 1;
      } else survivors.push(q);
      if (survivors.length > 1 || (best && score >= best.score)) break;
    }
    if (survivors.length !== 1 || branches.length !== t.options.length - 1) continue;
    if (!best || score < best.score) best = { split: { ...t, survivor: survivors[0], branches }, score };
  }
  return best?.split ?? null;
}

/**
 * If the rest of the puzzle follows from the basic (tier-0) rules alone, the
 * dominoes still to put down, in deduction order; otherwise null. Assumes the
 * player's dominoes are correct.
 */
export function finishable(p: PipsPuzzle, place: Placement): { k: number; spot: Spot }[] | null {
  const f = makeFrame(p);
  const s = stateFrom(f, place);
  const out: { k: number; spot: Spot }[] = [];
  for (let guard = 0; guard < 4 * f.places.length && !s.domAt.every((x) => x >= 0); guard++) {
    const ctx = makeCtx(f, s);
    let st: PStep | null = null;
    for (const r of TIER0) if ((st = r.find(ctx))) break;
    if (!st) return null;
    applyStep(f, s, st);
    if (st.place >= 0) out.push({ k: f.places[st.place].d, spot: spotOf(f, st.place) });
  }
  if (!s.domAt.every((x) => x >= 0)) return null;
  for (const m of out) if (isWrongSpot(p, m.k, m.spot)) return null;
  return out;
}

/** Ids, names and tiers of every rule (for docs / settings screens). */
export const TECHNIQUES = RULES.map(({ id, name, tier }) => ({ id, name, tier }));
