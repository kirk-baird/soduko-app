// Puzzle data, static frame and region arithmetic for Pips.
//
// Board: some cells of a rows×cols grid (grid index r*cols+c). The player
// covers every cell with the given dominoes (pips 0–6, each domino used once,
// any rotation). Coloured regions carry a rule about the pips on their cells:
// a total, "less than", "more than", "all equal" or "all different". Cells
// outside every region are unconstrained.
//
// Internally cells are renumbered 0..n-1 ("compact" indices) and the solver
// and rules work on placements: one domino, on one pair of neighbouring
// cells, in one orientation.

export type RegionKind = 'sum' | 'less' | 'greater' | 'equal' | 'unequal';

export interface PipsRegion {
  cells: number[]; // grid indices, ascending
  kind: RegionKind;
  target?: number; // sum / less / greater
}

/** Where a domino goes: its first pip count on spot[0], its second on spot[1] (grid indices). */
export type Spot = [number, number];

export interface PipsPuzzle {
  rows: number;
  cols: number;
  cells: number[]; // board cells, grid indices ascending
  regions: PipsRegion[];
  dominoes: [number, number][]; // the tray: [a, b] with a <= b, all different, sorted
  solution: Spot[]; // per domino
}

export const MAX_PIP = 6;
export const ALL_VALUES = (1 << (MAX_PIP + 1)) - 1;

/** One way to put a domino down. Value a goes on cell u, b on cell v (compact indices, u < v). */
export interface Place {
  u: number;
  v: number;
  d: number;
  a: number;
  b: number;
}

export interface FrameRegion {
  index: number;
  cells: number[]; // compact
  kind: RegionKind;
  target: number;
}

export interface Frame {
  p: PipsPuzzle;
  n: number;
  grid: number[]; // compact -> grid
  idx: Map<number, number>; // grid -> compact
  nbrs: number[][];
  color: number[]; // checkerboard colour 0/1
  regionOf: number[]; // compact -> region index, -1 for unconstrained
  regions: FrameRegion[];
  doms: [number, number][];
  places: Place[];
  byCell: number[][]; // placements covering each cell
  byDom: number[][]; // placements of each domino
  byEdge: Map<number, number[]>; // u * n + v -> placements on that pair
  placeKey: Map<string, number>; // `${u},${v},${d},${a}` -> placement
}

const frameCache = new WeakMap<PipsPuzzle, Frame>();

export function makeFrame(p: PipsPuzzle): Frame {
  const hit = frameCache.get(p);
  if (hit) return hit;
  const grid = p.cells.slice();
  const n = grid.length;
  const idx = new Map<number, number>();
  grid.forEach((g, i) => idx.set(g, i));
  const nbrs: number[][] = grid.map((g) => {
    const r = Math.floor(g / p.cols);
    const c = g % p.cols;
    const out: number[] = [];
    const add = (rr: number, cc: number) => {
      if (rr < 0 || cc < 0 || rr >= p.rows || cc >= p.cols) return;
      const j = idx.get(rr * p.cols + cc);
      if (j !== undefined) out.push(j);
    };
    add(r - 1, c);
    add(r, c - 1);
    add(r, c + 1);
    add(r + 1, c);
    return out;
  });
  const color = grid.map((g) => (Math.floor(g / p.cols) + (g % p.cols)) & 1);
  const regionOf = new Array<number>(n).fill(-1);
  const regions: FrameRegion[] = p.regions.map((rg, k) => {
    const cells = rg.cells.map((g) => idx.get(g)!);
    for (const c of cells) regionOf[c] = k;
    return { index: k, cells, kind: rg.kind, target: rg.target ?? 0 };
  });
  const doms = p.dominoes.map((d) => [d[0], d[1]] as [number, number]);
  const places: Place[] = [];
  const byCell: number[][] = grid.map(() => []);
  const byDom: number[][] = doms.map(() => []);
  const byEdge = new Map<number, number[]>();
  const placeKey = new Map<string, number>();
  for (let u = 0; u < n; u++) {
    for (const v of nbrs[u]) {
      if (v < u) continue;
      const list: number[] = [];
      // Both halves in one region (or both unconstrained): flipping the domino
      // changes nothing, so only one orientation is kept.
      const flipFree = regionOf[u] === regionOf[v];
      doms.forEach(([a, b], d) => {
        const orient: [number, number][] = a === b || flipFree ? [[a, b]] : [[a, b], [b, a]];
        for (const [x, y] of orient) {
          const id = places.length;
          places.push({ u, v, d, a: x, b: y });
          byCell[u].push(id);
          byCell[v].push(id);
          byDom[d].push(id);
          list.push(id);
          placeKey.set(`${u},${v},${d},${x}`, id);
        }
      });
      byEdge.set(u * n + v, list);
    }
  }
  const f = { p, n, grid, idx, nbrs, color, regionOf, regions, doms, places, byCell, byDom, byEdge, placeKey };
  frameCache.set(p, f);
  return f;
}

/** The placement that puts domino d on a spot (grid cells), or -1. */
export function placeFor(f: Frame, d: number, spot: Spot): number {
  const ca = f.idx.get(spot[0]);
  const cb = f.idx.get(spot[1]);
  if (ca === undefined || cb === undefined) return -1;
  const [x, y] = f.doms[d];
  const u = Math.min(ca, cb);
  const v = Math.max(ca, cb);
  const a = u === ca ? x : y;
  return f.placeKey.get(`${u},${v},${d},${a}`) ?? f.placeKey.get(`${u},${v},${d},${a === x ? y : x}`) ?? -1;
}

/** Two halves in the same region (or both unconstrained): the domino can be flipped without changing anything. */
export const flipFree = (f: Frame, spot: Spot) => f.regionOf[f.idx.get(spot[0])!] === f.regionOf[f.idx.get(spot[1])!];

/** The spot (grid cells, first half first) of a placement. */
export function spotOf(f: Frame, pid: number): Spot {
  const pl = f.places[pid];
  const [x] = f.doms[pl.d];
  // the domino's first value sits on u when a === x
  return pl.a === x ? [f.grid[pl.u], f.grid[pl.v]] : [f.grid[pl.v], f.grid[pl.u]];
}

export const valueAt = (pl: Place, cell: number) => (cell === pl.u ? pl.a : pl.b);
export const otherCell = (pl: Place, cell: number) => (cell === pl.u ? pl.v : pl.u);

// ---------- region arithmetic ----------

const lowBit = (m: number) => {
  for (let v = 0; v <= MAX_PIP; v++) if (m & (1 << v)) return v;
  return -1;
};
const highBit = (m: number) => {
  for (let v = MAX_PIP; v >= 0; v--) if (m & (1 << v)) return v;
  return -1;
};

/** Can the region's rule still be met when each cell takes a value from its mask? */
export function regionOk(kind: RegionKind, target: number, masks: number[]): boolean {
  for (const m of masks) if (!m) return false;
  switch (kind) {
    case 'sum': {
      let reach = [true];
      for (const m of masks) {
        const next = new Array<boolean>(reach.length + MAX_PIP).fill(false);
        for (let s = 0; s < reach.length; s++) {
          if (!reach[s]) continue;
          for (let v = 0; v <= MAX_PIP; v++) if (m & (1 << v)) next[s + v] = true;
        }
        reach = next;
      }
      return target < reach.length && reach[target];
    }
    case 'less':
      return masks.reduce((s, m) => s + lowBit(m), 0) < target;
    case 'greater':
      return masks.reduce((s, m) => s + highBit(m), 0) > target;
    case 'equal':
      return masks.reduce((a, m) => a & m, ALL_VALUES) !== 0;
    case 'unequal':
      return distinctMatching(masks);
  }
}

/** Every cell can get its own value (bipartite matching cells -> values). */
function distinctMatching(masks: number[]): boolean {
  if (masks.length > MAX_PIP + 1) return false;
  const owner = new Array<number>(MAX_PIP + 1).fill(-1);
  const tryCell = (i: number, seen: boolean[]): boolean => {
    for (let v = 0; v <= MAX_PIP; v++) {
      if (!(masks[i] & (1 << v)) || seen[v]) continue;
      seen[v] = true;
      if (owner[v] < 0 || tryCell(owner[v], seen)) {
        owner[v] = i;
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < masks.length; i++) if (!tryCell(i, new Array(MAX_PIP + 1).fill(false))) return false;
  return true;
}

/** Does a full assignment meet the rule? */
export function regionSatisfied(kind: RegionKind, target: number, values: number[]): boolean {
  return regionOk(
    kind,
    target,
    values.map((v) => 1 << v),
  );
}

// ---------- text ----------

export const cellName = (f: Frame, c: number) => {
  const g = f.grid[c];
  return `R${Math.floor(g / f.p.cols) + 1}C${(g % f.p.cols) + 1}`;
};

export function listText(items: string[], max = 6, and = 'and'): string {
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;
  if (extra > 0) return `${shown.join(', ')} ${and} ${extra} more`;
  if (shown.length <= 1) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} ${and} ${shown[shown.length - 1]}`;
}

export const cellsText = (f: Frame, cells: number[], max = 6) => listText(cells.map((c) => cellName(f, c)), max);

export function valuesText(mask: number): string {
  const vs: string[] = [];
  for (let v = 0; v <= MAX_PIP; v++) if (mask & (1 << v)) vs.push(String(v));
  return listText(vs, 7, 'or');
}

export const domName = (f: Frame, d: number) => `${f.doms[d][0]}|${f.doms[d][1]}`;

/** "R1C1–R1C2 (3 on R1C1)", with the orientation spelled out when it matters. */
export function spotText(f: Frame, pid: number): string {
  const pl = f.places[pid];
  const base = `${cellName(f, pl.u)}–${cellName(f, pl.v)}`;
  return pl.a === pl.b || f.regionOf[pl.u] === f.regionOf[pl.v] ? base : `${base} (${pl.a} on ${cellName(f, pl.u)})`;
}

/** "the 3|5 on R1C1–R1C2 (3 on R1C1)" */
export const placeText = (f: Frame, pid: number) => `the ${domName(f, f.places[pid].d)} on ${spotText(f, pid)}`;

/** What a region's rule asks for, as a sentence ending. */
export function ruleText(r: { kind: RegionKind; target: number }, single: boolean): string {
  switch (r.kind) {
    case 'sum':
      return single ? `must be ${r.target}` : `must add up to ${r.target}`;
    case 'less':
      return single ? `must be less than ${r.target}` : `must add up to less than ${r.target}`;
    case 'greater':
      return single ? `must be more than ${r.target}` : `must add up to more than ${r.target}`;
    case 'equal':
      return 'must all be the same';
    case 'unequal':
      return 'must all be different';
  }
}

export function regionName(f: Frame, r: FrameRegion): string {
  if (r.cells.length === 1) return cellName(f, r.cells[0]);
  return `the ${r.cells.length}-cell region at ${cellsText(f, r.cells, 4)}`;
}

/** Label drawn on the board for a region. */
export function regionLabel(r: { kind: RegionKind; target?: number }): string {
  switch (r.kind) {
    case 'sum':
      return String(r.target);
    case 'less':
      return `<${r.target}`;
    case 'greater':
      return `>${r.target}`;
    case 'equal':
      return '=';
    case 'unequal':
      return '≠';
  }
}
