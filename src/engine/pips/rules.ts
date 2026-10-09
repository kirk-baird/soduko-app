// Human-style deductions for Pips.
//
// The logic works on the set of placements still possible (a domino on two
// neighbouring cells in one orientation). Each rule either puts a domino down
// (when a cell or a domino has a single placement left) or rules placements
// out, and explains why. Rules only use the puzzle's constraints, never its
// uniqueness, so they are also valid inside a "what if" lookahead, where a
// contradiction proves the assumption wrong.
//
// Every step can also say, for each placement it rules out (or puts down),
// which already-ruled-out placements that conclusion relied on. Hints use this
// to explain a domino with only the steps it really needs.

import {
  ALL_VALUES,
  Frame,
  FrameRegion,
  MAX_PIP,
  cellName,
  cellsText,
  domName,
  listText,
  otherCell,
  placeText,
  regionName,
  regionOk,
  ruleText,
  valueAt,
  valuesText,
} from './model';

export interface State {
  alive: Uint8Array; // per placement
  domAt: Int32Array; // per domino: its placement once put down, else -1
  cellAt: Int32Array; // per cell: the placement covering it once put down, else -1
}

export interface PStep {
  technique: string;
  name: string;
  tier: number;
  place: number; // placement put down, or -1
  kills: number[]; // placements ruled out
  pattern: number[]; // compact cells to highlight
  unit: number[]; // compact cells involved (tinted lightly)
  explanation: string;
  brief: string; // short form used inside lookahead chains
  /** Placements (already ruled out before this step) that the conclusion about `q` relies on. */
  premise: (q: number) => number[];
  /** The explanation limited to some of the kills (defaults to the full one). */
  render?: (keep: number[]) => string;
}

export interface Rule {
  id: string;
  name: string;
  tier: number;
  find: (c: Ctx) => PStep | null;
}

export function emptyState(f: Frame): State {
  return {
    alive: new Uint8Array(f.places.length).fill(1),
    domAt: new Int32Array(f.doms.length).fill(-1),
    cellAt: new Int32Array(f.n).fill(-1),
  };
}

export const cloneState = (s: State): State => ({ alive: s.alive.slice(), domAt: s.domAt.slice(), cellAt: s.cellAt.slice() });

/** Placements that clash with putting `pid` down (same cells or same domino). */
export function conflicts(f: Frame, s: State, pid: number): number[] {
  const pl = f.places[pid];
  const out = new Set<number>();
  for (const q of f.byCell[pl.u]) if (q !== pid && s.alive[q]) out.add(q);
  for (const q of f.byCell[pl.v]) if (q !== pid && s.alive[q]) out.add(q);
  for (const q of f.byDom[pl.d]) if (q !== pid && s.alive[q]) out.add(q);
  return [...out];
}

export function putDown(f: Frame, s: State, pid: number): void {
  for (const q of conflicts(f, s, pid)) s.alive[q] = 0;
  const pl = f.places[pid];
  s.domAt[pl.d] = pid;
  s.cellAt[pl.u] = s.cellAt[pl.v] = pid;
}

export function applyStep(f: Frame, s: State, st: PStep): void {
  for (const q of st.kills) s.alive[q] = 0;
  if (st.place >= 0) putDown(f, s, st.place);
}

// ---------- context ----------

export interface Ctx {
  f: Frame;
  s: State;
  _masks?: number[];
  _cellOpts?: number[][];
  _domOpts?: number[][];
}

export const makeCtx = (f: Frame, s: State): Ctx => ({ f, s });

export function cellOpts(c: Ctx): number[][] {
  if (c._cellOpts) return c._cellOpts;
  return (c._cellOpts = c.f.byCell.map((list) => list.filter((q) => c.s.alive[q])));
}

export function domOpts(c: Ctx): number[][] {
  if (c._domOpts) return c._domOpts;
  return (c._domOpts = c.f.byDom.map((list) => list.filter((q) => c.s.alive[q])));
}

/** Values each cell can still take (bit v = v pips). */
export function masks(c: Ctx): number[] {
  if (c._masks) return c._masks;
  const opts = cellOpts(c);
  return (c._masks = opts.map((list, cell) => {
    let m = 0;
    for (const q of list) m |= 1 << valueAt(c.f.places[q], cell);
    return m;
  }));
}

const isOpen = (c: Ctx, cell: number) => c.s.cellAt[cell] < 0;

/** Ruled-out placements on a cell (optionally only some). */
const deadAt = (c: Ctx, cell: number, keep: (q: number) => boolean = () => true) => c.f.byCell[cell].filter((q) => !c.s.alive[q] && keep(q));
const deadOf = (c: Ctx, d: number) => c.f.byDom[d].filter((q) => !c.s.alive[q]);

const uniq = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

const popcount = (m: number) => {
  let n = 0;
  for (; m; m &= m - 1) n++;
  return n;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "must be" / "must both be" / "must all be" */
const mustBe = (n: number) => (n === 1 ? 'must be' : n === 2 ? 'must both be' : 'must all be');

interface StepFields {
  place?: number;
  kills?: number[];
  pattern?: number[];
  unit?: number[];
  explanation: string;
  brief: string;
  premise: (q: number) => number[];
  render?: (keep: number[]) => string;
}

function mk(rule: { id: string; name: string; tier: number }, s: StepFields): PStep {
  return {
    technique: rule.id,
    name: rule.name,
    tier: rule.tier,
    place: s.place ?? -1,
    kills: uniq(s.kills ?? []),
    pattern: uniq(s.pattern ?? []),
    unit: uniq(s.unit ?? []),
    explanation: s.explanation,
    brief: s.brief,
    premise: s.premise,
    render: s.render,
  };
}

/** Masks after removing `kills`, for the cells given. */
function masksWithout(c: Ctx, kills: number[], cells: number[]): Map<number, number> {
  const dead = new Set(kills);
  const opts = cellOpts(c);
  const out = new Map<number, number>();
  for (const cell of cells) {
    let m = 0;
    for (const q of opts[cell]) if (!dead.has(q)) m |= 1 << valueAt(c.f.places[q], cell);
    out.set(cell, m);
  }
  return out;
}

/** "R1C1 must be 6, and R1C2 can only be 0, 1 or 2" for the cells whose values narrowed. */
function narrowedText(c: Ctx, kills: number[], cells: number[]): { text: string; changed: number[] } {
  const before = masks(c);
  const after = masksWithout(c, kills, cells);
  const groups = new Map<number, number[]>();
  for (const cell of cells) {
    const m = after.get(cell)!;
    if (m === before[cell] || !m) continue;
    const g = groups.get(m) ?? [];
    g.push(cell);
    groups.set(m, g);
  }
  const parts: string[] = [];
  const changed: number[] = [];
  // Group by (before, after) so "can't be 6" is only said of cells that lost exactly that.
  const byChange = new Map<string, number[]>();
  for (const [m, g] of groups) {
    for (const cell of g) {
      const key = `${before[cell]}:${m}`;
      byChange.set(key, [...(byChange.get(key) ?? []), cell]);
    }
  }
  for (const [key, g] of byChange) {
    const [was, m] = key.split(':').map(Number);
    changed.push(...g);
    const names = cellsText(c.f, g);
    const lost = was & ~m;
    if ((m & (m - 1)) === 0) parts.push(`${names} ${mustBe(g.length)} ${valuesText(m)}`);
    else if (popcount(lost) < popcount(m)) parts.push(`${names} can't be ${valuesText(lost)}`);
    else parts.push(`${names} can only be ${valuesText(m)}`);
  }
  return { text: listText(parts, 6, 'and'), changed };
}

function killedPlacesText(c: Ctx, kills: number[]): string {
  const shown = kills.slice(0, 3).map((q) => placeText(c.f, q));
  const extra = kills.length - shown.length;
  return `${listText(shown, 3, 'and')}${extra > 0 ? ` (and ${plural(extra, 'other placement')})` : ''} can't work`;
}

// ---------- tier 0 ----------

const onlyFit: Rule = {
  id: 'onlyFit',
  name: 'Only Fit',
  tier: 0,
  find(c) {
    const opts = cellOpts(c);
    for (let cell = 0; cell < c.f.n; cell++) {
      if (!isOpen(c, cell) || opts[cell].length !== 1) continue;
      return onlyFitStep(c, cell);
    }
    return null;
  },
};

export function onlyFitStep(c: Ctx, cell: number): PStep {
  const pid = cellOpts(c)[cell][0];
  const pl = c.f.places[pid];
  return mk(onlyFit, {
    place: pid,
    kills: conflicts(c.f, c.s, pid),
    pattern: [pl.u, pl.v],
    explanation: `So ${cellName(c.f, cell)} has only one possibility left: ${placeText(c.f, pid)}.`,
    brief: `${placeText(c.f, pid)} is the only fit for ${cellName(c.f, cell)}`,
    premise: () => deadAt(c, cell),
  });
}

const onlySpot: Rule = {
  id: 'onlySpot',
  name: 'Only Spot',
  tier: 0,
  find(c) {
    const opts = domOpts(c);
    for (let d = 0; d < c.f.doms.length; d++) {
      if (c.s.domAt[d] >= 0 || opts[d].length !== 1) continue;
      return onlySpotStep(c, d);
    }
    return null;
  },
};

export function onlySpotStep(c: Ctx, d: number): PStep {
  const pid = domOpts(c)[d][0];
  const pl = c.f.places[pid];
  const where = `${cellName(c.f, pl.u)}–${cellName(c.f, pl.v)}${pl.a === pl.b ? '' : ` (${pl.a} on ${cellName(c.f, pl.u)})`}`;
  return mk(onlySpot, {
    place: pid,
    kills: conflicts(c.f, c.s, pid),
    pattern: [pl.u, pl.v],
    explanation: `So the ${domName(c.f, d)} has only one place left: ${where}.`,
    brief: `the ${domName(c.f, d)} can only go on ${where}`,
    premise: () => deadOf(c, d),
  });
}

/** Region masks with one placement's values filled in. */
function regionTrial(c: Ctx, r: FrameRegion, q: number, open: (cell: number) => number): number[] {
  const pl = c.f.places[q];
  const m = masks(c);
  return r.cells.map((cell) => (cell === pl.u ? 1 << pl.a : cell === pl.v ? 1 << pl.b : isOpen(c, cell) ? open(cell) : m[cell]));
}

/** Placements touching region r that would make its rule impossible. */
function regionKills(c: Ctx, r: FrameRegion): number[] {
  const m = masks(c);
  const opts = cellOpts(c);
  const kills: number[] = [];
  const seen = new Set<number>();
  for (const cell of r.cells) {
    if (!isOpen(c, cell)) continue;
    for (const q of opts[cell]) {
      if (seen.has(q)) continue;
      seen.add(q);
      if (!regionOk(r.kind, r.target, regionTrial(c, r, q, (x) => m[x]))) kills.push(q);
    }
  }
  return kills;
}

/** The narrowed cells of r that ruling out q depends on, as the placements that narrowed them. */
function regionPremise(c: Ctx, r: FrameRegion, q: number): number[] {
  const m = masks(c);
  const pl = c.f.places[q];
  const trial = regionTrial(c, r, q, () => ALL_VALUES);
  if (!regionOk(r.kind, r.target, trial)) return [];
  // Narrow cells back one at a time until the rule fails again; keep only those needed.
  const others = r.cells.filter((x) => isOpen(c, x) && x !== pl.u && x !== pl.v);
  const cur = regionTrial(c, r, q, (x) => m[x]);
  const need: number[] = [];
  for (const x of others) {
    const k = r.cells.indexOf(x);
    const save = cur[k];
    cur[k] = ALL_VALUES;
    if (regionOk(r.kind, r.target, cur)) {
      cur[k] = save;
      need.push(x);
    }
  }
  return need.flatMap((x) => deadAt(c, x, (p) => !(m[x] & (1 << valueAt(c.f.places[p], x)))));
}

function regionNote(c: Ctx, r: FrameRegion): string {
  const fixed = r.cells.filter((cell) => !isOpen(c, cell));
  if (!fixed.length || fixed.length === r.cells.length) return '';
  const m = masks(c);
  const vals = fixed.map((cell) => valuesText(m[cell]));
  return fixed.length === 1
    ? ` (${cellName(c.f, fixed[0])} already has ${vals[0]})`
    : ` (${cellsText(c.f, fixed)} already have ${listText(vals)})`;
}

const regionRule: Rule = {
  id: 'region',
  name: 'Region Rule',
  tier: 0,
  find(c) {
    const order = c.f.regions
      .map((r) => ({ r, open: r.cells.filter((cell) => isOpen(c, cell)).length }))
      .filter((x) => x.open > 0)
      .sort((a, b) => a.open - b.open || a.r.index - b.r.index);
    for (const { r } of order) {
      const kills = regionKills(c, r);
      if (!kills.length) continue;
      const open = r.cells.filter((cell) => isOpen(c, cell));
      const single = r.cells.length === 1;
      const name = regionName(c.f, r);
      const render = (keep: number[]) => {
        // Quote the step's full result, but only for the cells the kept eliminations touch.
        const touched = open.filter((x) => keep.some((q) => c.f.places[q].u === x || c.f.places[q].v === x));
        const { text } = narrowedText(c, kills, touched);
        const head = `${cap(name)} ${ruleText(r, single)}${regionNote(c, r)}`;
        // A one-cell "must be 4" says it all.
        if (single && r.kind === 'sum') return `${head}.`;
        if (single && text) {
          const m = masksWithout(c, kills, open).get(open[0])!;
          return `${head}, so it ${(m & (m - 1)) === 0 ? 'must be' : 'can only be'} ${valuesText(m)}.`;
        }
        return text ? `${head}, so ${text}.` : `${head}, so ${killedPlacesText(c, keep)}.`;
      };
      const { text, changed } = narrowedText(c, kills, open);
      return mk(this, {
        kills,
        pattern: changed.length ? changed : open,
        unit: r.cells,
        explanation: render(kills),
        brief: text ? `${text} (${name} ${ruleText(r, single)})` : `${killedPlacesText(c, kills)} (${name})`,
        premise: (q) => regionPremise(c, r, q),
        render,
      });
    }
    return null;
  },
};

const onlyPartner: Rule = {
  id: 'onlyPartner',
  name: 'Only Partner',
  tier: 0,
  find(c) {
    const opts = cellOpts(c);
    for (let cell = 0; cell < c.f.n; cell++) {
      if (!isOpen(c, cell) || !opts[cell].length) continue;
      const partners = uniq(opts[cell].map((q) => otherCell(c.f.places[q], cell)));
      if (partners.length !== 1) continue;
      const v = partners[0];
      const kills = opts[v].filter((q) => otherCell(c.f.places[q], v) !== cell);
      if (!kills.length) continue;
      const openNbrs = c.f.nbrs[cell].filter((j) => isOpen(c, j));
      const a = cellName(c.f, cell);
      const b = cellName(c.f, v);
      const others = openNbrs.filter((j) => j !== v);
      const why = others.length
        ? `No domino left fits ${a} together with ${cellsText(c.f, others)}, so ${a} must pair with ${b}`
        : `${a}'s only open neighbour is ${b}, so they share a domino`;
      const render = (keep: number[]) => {
        const lost = uniq(keep.map((q) => otherCell(c.f.places[q], v)));
        return `${why}: ${b} can't pair with ${listText(lost.map((j) => cellName(c.f, j)), 6, 'or')}.`;
      };
      return mk(this, {
        kills,
        pattern: [cell, v],
        unit: uniq(kills.map((q) => otherCell(c.f.places[q], v))),
        explanation: render(kills),
        brief: `${a} pairs with ${b}`,
        premise: () => deadAt(c, cell, (q) => otherCell(c.f.places[q], cell) !== v),
        render,
      });
    }
    return null;
  },
};

// ---------- tier 1 ----------

/** Halves showing v left on the dominoes not yet put down (a double counts twice). */
function halvesLeft(c: Ctx, v: number): { count: number; doms: number[] } {
  let count = 0;
  const doms: number[] = [];
  c.f.doms.forEach(([a, b], d) => {
    if (c.s.domAt[d] >= 0) return;
    const k = (a === v ? 1 : 0) + (b === v ? 1 : 0);
    if (k) {
      count += k;
      doms.push(d);
    }
  });
  return { count, doms };
}

const supply: Rule = {
  id: 'supply',
  name: 'Counting Halves',
  tier: 1,
  find(c) {
    const m = masks(c);
    const opts = cellOpts(c);
    for (let v = 0; v <= MAX_PIP; v++) {
      const need: number[] = [];
      for (let cell = 0; cell < c.f.n; cell++) if (isOpen(c, cell) && m[cell] === 1 << v) need.push(cell);
      const { count, doms } = halvesLeft(c, v);
      if (!need.length || need.length !== count) continue;
      const needSet = new Set(need);
      const kills: number[] = [];
      for (let cell = 0; cell < c.f.n; cell++) {
        if (!isOpen(c, cell) || needSet.has(cell) || !(m[cell] & (1 << v))) continue;
        for (const q of opts[cell]) if (valueAt(c.f.places[q], cell) === v && !kills.includes(q)) kills.push(q);
      }
      if (!kills.length) continue;
      const halves = count === 1 ? `Only one half with ${v} is left` : `Only ${count} halves with ${v} are left`;
      const onDoms = `on ${listText(doms.map((d) => `the ${domName(c.f, d)}`))}`;
      const must = `${cellsText(c.f, need)} ${mustBe(need.length)} ${v}`;
      const render = (keep: number[]) => {
        const others = uniq(keep.flatMap((q) => [c.f.places[q].u, c.f.places[q].v]).filter((j) => !needSet.has(j) && isOpen(c, j)));
        const { text } = narrowedText(c, kills, others);
        return `${halves} (${onDoms}), and ${must}. So no other cell can be ${v}${text ? `: ${text}` : ''}.`;
      };
      const others = uniq(kills.flatMap((q) => [c.f.places[q].u, c.f.places[q].v]).filter((j) => !needSet.has(j) && isOpen(c, j)));
      return mk(this, {
        kills,
        pattern: need,
        unit: narrowedText(c, kills, others).changed,
        explanation: render(kills),
        brief: `no other cell can be ${v} (${must}, and that uses up every ${v})`,
        premise: () => need.flatMap((x) => deadAt(c, x, (q) => valueAt(c.f.places[q], x) !== v)),
        render,
      });
    }
    return null;
  },
};

const claim: Rule = {
  id: 'claim',
  name: 'Domino Claim',
  tier: 1,
  find(c) {
    const dopts = domOpts(c);
    const opts = cellOpts(c);
    for (let d = 0; d < c.f.doms.length; d++) {
      if (c.s.domAt[d] >= 0 || dopts[d].length < 2) continue;
      let common: number[] | null = null;
      for (const q of dopts[d]) {
        const pl = c.f.places[q];
        common = common ? common.filter((x) => x === pl.u || x === pl.v) : [pl.u, pl.v];
      }
      if (!common || !common.length) continue;
      const cells = common;
      const kills = cells.flatMap((cell) => opts[cell].filter((q) => c.f.places[q].d !== d));
      if (!kills.length) continue;
      const dn = domName(c.f, d);
      const where = cellsText(c.f, cells);
      return mk(this, {
        kills,
        pattern: cells,
        unit: uniq(dopts[d].flatMap((q) => [c.f.places[q].u, c.f.places[q].v])),
        explanation: `Every place left for the ${dn} covers ${where}, so ${cells.length === 1 ? 'that cell belongs' : 'those cells belong'} to the ${dn}: no other domino can go there.`,
        brief: `${where} ${cells.length === 1 ? 'belongs' : 'belong'} to the ${dn}`,
        premise: () => deadOf(c, d),
      });
    }
    // The other way round: a cell that only one domino fits.
    for (let cell = 0; cell < c.f.n; cell++) {
      if (!isOpen(c, cell) || opts[cell].length < 2) continue;
      const d = c.f.places[opts[cell][0]].d;
      if (!opts[cell].every((q) => c.f.places[q].d === d)) continue;
      const mine = new Set(opts[cell]);
      const kills = dopts[d].filter((q) => !mine.has(q));
      if (!kills.length) continue;
      const dn = domName(c.f, d);
      return mk(this, {
        kills,
        pattern: [cell],
        unit: uniq(kills.flatMap((q) => [c.f.places[q].u, c.f.places[q].v])),
        explanation: `Only the ${dn} fits ${cellName(c.f, cell)}, so the ${dn} can't go anywhere else.`,
        brief: `the ${dn} must cover ${cellName(c.f, cell)}`,
        premise: () => deadAt(c, cell, (q) => c.f.places[q].d !== d),
      });
    }
    return null;
  },
};

/** Open cell pairs (u < v) that still have a placement. */
function liveEdges(c: Ctx): [number, number][] {
  const out: [number, number][] = [];
  for (const [key, list] of c.f.byEdge) {
    if (!list.some((q) => c.s.alive[q])) continue;
    out.push([Math.floor(key / c.f.n), key % c.f.n]);
  }
  return out;
}

const deadEnd: Rule = {
  id: 'deadEnd',
  name: 'Dead End',
  tier: 1,
  find(c) {
    const opts = cellOpts(c);
    for (const [u, v] of liveEdges(c)) {
      const around = uniq([...c.f.nbrs[u], ...c.f.nbrs[v]]).filter((w) => w !== u && w !== v && isOpen(c, w));
      for (const w of around) {
        if (!opts[w].length) continue;
        const stuck = opts[w].every((q) => {
          const o = otherCell(c.f.places[q], w);
          return o === u || o === v;
        });
        if (!stuck) continue;
        const kills = c.f.byEdge.get(u * c.f.n + v)!.filter((q) => c.s.alive[q]);
        const partners = uniq(opts[w].map((q) => otherCell(c.f.places[q], w)));
        const pair = `${cellName(c.f, u)}–${cellName(c.f, v)}`;
        const wn = cellName(c.f, w);
        return mk(this, {
          kills,
          pattern: [u, v],
          unit: [w],
          explanation: `${wn} can only pair with ${listText(partners.map((j) => cellName(c.f, j)), 4, 'or')}. A domino on ${pair} would leave ${wn} with no partner, so no domino can go on ${pair}.`,
          brief: `${pair} isn't one domino (it would strand ${wn})`,
          premise: () =>
            deadAt(c, w, (q) => {
              const o = otherCell(c.f.places[q], w);
              return o !== u && o !== v;
            }),
        });
      }
    }
    return null;
  },
};

// ---------- tier 2 ----------

interface Area {
  cells: number[];
  odd: boolean;
  colours: [number, number];
}

/** Connected groups of open cells (joined where a placement is still possible) that no set of dominoes can cover. */
function badAreas(c: Ctx, blocked: Set<number>): Area[] {
  const opts = cellOpts(c);
  const seen = new Uint8Array(c.f.n);
  const out: Area[] = [];
  for (let start = 0; start < c.f.n; start++) {
    if (seen[start] || !isOpen(c, start) || blocked.has(start)) continue;
    const comp: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const x = stack.pop()!;
      comp.push(x);
      for (const q of opts[x]) {
        const y = otherCell(c.f.places[q], x);
        if (seen[y] || blocked.has(y)) continue;
        seen[y] = 1;
        stack.push(y);
      }
    }
    const col: [number, number] = [0, 0];
    for (const x of comp) col[c.f.color[x]]++;
    if (col[0] !== col[1]) out.push({ cells: comp.sort((a, b) => a - b), odd: comp.length % 2 === 1, colours: col });
  }
  return out;
}

function areaText(c: Ctx, a: Area, verb: string): string {
  const names = cellsText(c.f, a.cells, 5);
  if (a.odd) return `${verb} ${names}: ${a.cells.length} cells, an odd number, which dominoes can't cover`;
  const [x, y] = a.colours;
  return `${verb} ${names}. Shade the grid like a chessboard: those cells have ${Math.max(x, y)} of one shade and ${Math.min(x, y)} of the other, but every domino covers one of each`;
}

/** Ruled-out placements that would have joined an area to the rest of the board. */
function areaPremise(c: Ctx, area: number[], blocked: number[]): number[] {
  const inside = new Set([...area, ...blocked]);
  return area.flatMap((x) => deadAt(c, x, (q) => !inside.has(otherCell(c.f.places[q], x)) && isOpen(c, otherCell(c.f.places[q], x))));
}

const oddArea: Rule = {
  id: 'oddArea',
  name: 'Tiling Split',
  tier: 2,
  find(c) {
    if (badAreas(c, new Set()).length) return null; // already broken: leave it to contradiction checks
    for (const [u, v] of liveEdges(c)) {
      const bad = badAreas(c, new Set([u, v]));
      if (!bad.length) continue;
      const a = bad.sort((x, y) => x.cells.length - y.cells.length)[0];
      const kills = c.f.byEdge.get(u * c.f.n + v)!.filter((q) => c.s.alive[q]);
      const pair = `${cellName(c.f, u)}–${cellName(c.f, v)}`;
      return mk(this, {
        kills,
        pattern: [u, v],
        unit: a.cells,
        explanation: `${areaText(c, a, `A domino on ${pair} would cut off`)}. So no domino can go on ${pair}.`,
        brief: `${pair} isn't one domino (it would cut off ${cellsText(c.f, a.cells, 3)})`,
        premise: () => areaPremise(c, a.cells, [u, v]),
      });
    }
    return null;
  },
};

const pairClaim: Rule = {
  id: 'pairClaim',
  name: 'Domino Pair',
  tier: 2,
  find(c) {
    const dopts = domOpts(c);
    const opts = cellOpts(c);
    const free = c.f.doms.map((_, d) => d).filter((d) => c.s.domAt[d] < 0 && dopts[d].length >= 2);
    const cellsOf = (d: number) => uniq(dopts[d].flatMap((q) => [c.f.places[q].u, c.f.places[q].v]));
    for (let i = 0; i < free.length; i++) {
      const ci = cellsOf(free[i]);
      if (ci.length > 4) continue;
      for (let j = i + 1; j < free.length; j++) {
        const both = uniq([...ci, ...cellsOf(free[j])]);
        if (both.length !== 4) continue;
        const d1 = free[i];
        const d2 = free[j];
        const kills = both.flatMap((cell) => opts[cell].filter((q) => c.f.places[q].d !== d1 && c.f.places[q].d !== d2));
        if (!kills.length) continue;
        const names = `the ${domName(c.f, d1)} and the ${domName(c.f, d2)}`;
        return mk(this, {
          kills: uniq(kills),
          pattern: both,
          explanation: `${cap(names)} can only go on ${cellsText(c.f, both)}, so between them they fill those four cells: no other domino can go there.`,
          brief: `${cellsText(c.f, both)} hold ${names}`,
          premise: () => [...deadOf(c, d1), ...deadOf(c, d2)],
        });
      }
    }
    // Two cells that no single domino covers and that only two dominoes fit.
    const open = Array.from({ length: c.f.n }, (_, k) => k).filter((k) => isOpen(c, k));
    const domsAt = open.map((k) => uniq(opts[k].map((q) => c.f.places[q].d)));
    for (let i = 0; i < open.length; i++) {
      if (domsAt[i].length > 2) continue;
      for (let j = i + 1; j < open.length; j++) {
        const ds = uniq([...domsAt[i], ...domsAt[j]]);
        if (ds.length !== 2) continue;
        const a = open[i];
        const b = open[j];
        if (opts[a].some((q) => otherCell(c.f.places[q], a) === b)) continue;
        const here = new Set([...opts[a], ...opts[b]]);
        const kills = ds.flatMap((d) => dopts[d].filter((q) => !here.has(q)));
        if (!kills.length) continue;
        const names = `the ${domName(c.f, ds[0])} and the ${domName(c.f, ds[1])}`;
        return mk(this, {
          kills,
          pattern: [a, b],
          unit: uniq(kills.flatMap((q) => [c.f.places[q].u, c.f.places[q].v])),
          explanation: `Only ${names} fit ${cellName(c.f, a)} and ${cellName(c.f, b)}, and no single domino can cover both cells. So those two dominoes go there and can't be used anywhere else.`,
          brief: `${names} go on ${cellName(c.f, a)} and ${cellName(c.f, b)}`,
          premise: () => [...deadAt(c, a), ...deadAt(c, b)],
        });
      }
    }
    return null;
  },
};

// ---------- contradictions & lookahead ----------

/** A plain-English reason the current state is impossible, or null. */
export function contradiction(c: Ctx, withAreas: boolean): string | null {
  const opts = cellOpts(c);
  for (let cell = 0; cell < c.f.n; cell++) {
    if (isOpen(c, cell) && !opts[cell].length) return `${cellName(c.f, cell)} would have no domino that fits`;
  }
  const dopts = domOpts(c);
  for (let d = 0; d < c.f.doms.length; d++) {
    if (c.s.domAt[d] < 0 && !dopts[d].length) return `the ${domName(c.f, d)} would have nowhere to go`;
  }
  const m = masks(c);
  for (const r of c.f.regions) {
    if (!regionOk(r.kind, r.target, r.cells.map((cell) => m[cell]))) {
      return `${regionName(c.f, r)} couldn't ${ruleText(r, r.cells.length === 1).replace(/^must /, '')}`;
    }
  }
  for (let v = 0; v <= MAX_PIP; v++) {
    const need = [];
    for (let cell = 0; cell < c.f.n; cell++) if (isOpen(c, cell) && m[cell] === 1 << v) need.push(cell);
    if (!need.length) continue;
    const { count } = halvesLeft(c, v);
    if (need.length > count) {
      return `${cellsText(c.f, need)} would all need to be ${v}, but only ${plural(count, `half with ${v}`, `halves with ${v}`)} ${count === 1 ? 'is' : 'are'} left`;
    }
  }
  if (withAreas) {
    const bad = badAreas(c, new Set());
    if (bad.length) return areaText(c, bad[0], 'that would cut off');
  }
  return null;
}

export interface SimResult {
  briefs: string[];
  why: string;
  cells: number[]; // cells the chain looked at
}

export function simulate(f: Frame, s: State, rules: Rule[], withAreas: boolean, maxSteps: number): SimResult | null {
  const cs = cloneState(s);
  const briefs: string[] = [];
  const cells: number[] = [];
  for (;;) {
    const ctx = makeCtx(f, cs);
    const why = contradiction(ctx, withAreas);
    if (why) return { briefs, why, cells };
    if (briefs.length >= maxSteps) return null;
    let st: PStep | null = null;
    for (const r of rules) if ((st = r.find(ctx))) break;
    if (!st) return null;
    applyStep(f, cs, st);
    briefs.push(st.brief);
    cells.push(...st.pattern, ...st.unit);
  }
}

interface Hypothesis {
  text: string; // "R1C1 and R1C2 were one domino"
  denial: string; // "R1C1 and R1C2 can't be one domino"
  cells: number[];
  assume: number[]; // placements to rule out for the assumption
  kills: number[]; // placements ruled out if it fails
}

function hypotheses(c: Ctx): Hypothesis[] {
  const { f } = c;
  const opts = cellOpts(c);
  const m = masks(c);
  const out: { h: Hypothesis; score: number }[] = [];
  for (const [u, v] of liveEdges(c)) {
    const on = f.byEdge.get(u * f.n + v)!.filter((q) => c.s.alive[q]);
    const onSet = new Set(on);
    const assume = uniq([...opts[u], ...opts[v]].filter((q) => !onSet.has(q)));
    if (!assume.length) continue;
    const pair = `${cellName(f, u)} and ${cellName(f, v)}`;
    out.push({
      h: { text: `${pair} were one domino`, denial: `${pair} can't be one domino`, cells: [u, v], assume, kills: on },
      score: Math.min(opts[u].length, opts[v].length),
    });
  }
  for (let cell = 0; cell < f.n; cell++) {
    if (!isOpen(c, cell) || (m[cell] & (m[cell] - 1)) === 0) continue;
    for (let val = 0; val <= MAX_PIP; val++) {
      if (!(m[cell] & (1 << val))) continue;
      const kills = opts[cell].filter((q) => valueAt(f.places[q], cell) === val);
      const assume = opts[cell].filter((q) => valueAt(f.places[q], cell) !== val);
      const n = cellName(f, cell);
      out.push({ h: { text: `${n} were ${val}`, denial: `${n} isn't ${val}`, cells: [cell], assume, kills }, score: opts[cell].length });
    }
  }
  return out.sort((a, b) => a.score - b.score).map((x) => x.h);
}

function lookaheadRule(rule: { id: string; name: string; tier: number }, inner: () => Rule[], withAreas: boolean, maxSteps: number): Rule {
  return {
    ...rule,
    find(c) {
      const rules = inner();
      let best: { h: Hypothesis; r: SimResult } | null = null;
      for (const h of hypotheses(c)) {
        const limit = best ? best.r.briefs.length - 1 : maxSteps;
        if (limit < 0) break;
        const s = cloneState(c.s);
        for (const q of h.assume) s.alive[q] = 0;
        const r = simulate(c.f, s, rules, withAreas, limit);
        if (r) {
          best = { h, r };
          if (r.briefs.length <= 1) break;
        }
      }
      if (!best) return null;
      const { h, r } = best;
      const chain = r.briefs.length ? ` Then ${r.briefs.map((b, k) => `(${k + 1}) ${b}`).join('; ')}.` : '';
      const looked = uniq([...h.cells, ...r.cells]);
      return mk(this, {
        kills: h.kills,
        pattern: h.cells,
        unit: looked,
        explanation: `Suppose ${h.text}.${chain} But then ${r.why}. So ${h.denial}.`,
        brief: `${h.denial} (assuming otherwise leads to a contradiction)`,
        // The chain is replayed from the whole board; count what was ruled out around the cells it touched.
        premise: () => looked.flatMap((x) => deadAt(c, x)),
      });
    },
  };
}

export const TIER0: Rule[] = [onlyFit, onlySpot, regionRule, onlyPartner];
export const TIER1: Rule[] = [supply, claim, deadEnd];
export const TIER2: Rule[] = [oddArea, pairClaim];

const lookahead = lookaheadRule({ id: 'lookahead', name: 'What If', tier: 3 }, () => [...TIER0, ...TIER1], false, 6);
const deepLookahead = lookaheadRule({ id: 'deepLookahead', name: 'Deep What If', tier: 4 }, () => [...TIER0, ...TIER1, ...TIER2], true, 14);

export const RULES: Rule[] = [...TIER0, ...TIER1, ...TIER2, lookahead, deepLookahead];

export function findStep(f: Frame, s: State, maxTier = 4): PStep | null {
  const ctx = makeCtx(f, s);
  for (const r of RULES) {
    if (r.tier > maxTier) break;
    const st = r.find(ctx);
    if (st) return st;
  }
  return null;
}
