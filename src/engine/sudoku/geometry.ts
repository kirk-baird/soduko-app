// Geometry for every sudoku-style variant: which cells exist, which groups of
// cells ("units") must hold distinct digits, and how to name things in hints.
//
// Supported: classic 9×9, windoku (4 extra windows), jigsaw (irregular
// regions), 16×16 (4×4 boxes, symbols 1–9 then A–G) and samurai (five
// overlapping 9×9 grids).

export type SudokuVariant = 'classic' | 'windoku' | 'jigsaw' | 'sixteen' | 'samurai';
export type UnitKind = 'row' | 'col' | 'box' | 'window' | 'region';

export interface LineGroup {
  rows: number[]; // unit indices, top to bottom
  cols: number[]; // unit indices, left to right
  rowIndex: Map<number, number>; // cell -> index into rows
  colIndex: Map<number, number>; // cell -> index into cols
}

export interface Geometry {
  variant: SudokuVariant;
  n: number; // digits 1..n
  all: number; // bitmask of all digits
  cellCount: number;
  gridRows: number; // display grid size
  gridCols: number;
  pos: [number, number][]; // cell -> display row/col
  cellAt: number[]; // display index (r*gridCols+c) -> cell, or -1
  units: number[][];
  unitKind: UnitKind[];
  unitLabel: string[];
  cellUnits: number[][];
  peers: number[][];
  peerSet: Uint8Array[];
  lineGroups: LineGroup[];
  /** Region-like unit (box/region) each cell belongs to — used to draw thick borders. */
  regionOf: number[];
  /** Cells inside a windoku window (drawn shaded). */
  shaded: boolean[];
  /** Ordered unit pairs (A, B) with |A ∩ B| ≥ 2, for locked-candidate logic. */
  intersections: [number, number][];
  cellName(i: number): string;
  symbol(d: number): string;
}

const SYMBOLS = '0123456789ABCDEFG';

interface Builder {
  variant: SudokuVariant;
  n: number;
  gridRows: number;
  gridCols: number;
  cells: [number, number][]; // display positions
  units: { cells: [number, number][]; kind: UnitKind; label: string }[];
  groups: { rows: [number, number][][]; cols: [number, number][][] }[];
  shaded?: [number, number][];
  cellName: (r: number, c: number) => string;
}

function build(b: Builder): Geometry {
  const { gridRows, gridCols } = b;
  const cellAt = new Array<number>(gridRows * gridCols).fill(-1);
  b.cells.forEach(([r, c], i) => (cellAt[r * gridCols + c] = i));
  const idx = ([r, c]: [number, number]) => {
    const i = cellAt[r * gridCols + c];
    if (i < 0) throw new Error(`no cell at ${r},${c}`);
    return i;
  };

  // Dedupe units with identical cell sets (samurai shared boxes).
  const units: number[][] = [];
  const unitKind: UnitKind[] = [];
  const unitLabel: string[] = [];
  const seen = new Map<string, number>();
  const unitIdOf = (cells: number[]) => seen.get([...cells].sort((x, y) => x - y).join(','));
  for (const u of b.units) {
    const cells = u.cells.map(idx);
    const key = [...cells].sort((x, y) => x - y).join(',');
    if (seen.has(key)) continue;
    seen.set(key, units.length);
    units.push(cells);
    unitKind.push(u.kind);
    unitLabel.push(u.label);
  }

  const cellCount = b.cells.length;
  const cellUnits: number[][] = Array.from({ length: cellCount }, () => []);
  units.forEach((u, k) => u.forEach((i) => cellUnits[i].push(k)));

  const peerSet = Array.from({ length: cellCount }, () => new Uint8Array(cellCount));
  const peers: number[][] = Array.from({ length: cellCount }, (_, i) => {
    const s = new Set<number>();
    for (const u of cellUnits[i]) for (const j of units[u]) if (j !== i) s.add(j);
    const list = [...s].sort((x, y) => x - y);
    for (const j of list) peerSet[i][j] = 1;
    return list;
  });

  const lineGroups: LineGroup[] = b.groups.map((gr) => {
    const rows = gr.rows.map((cs) => unitIdOf(cs.map(idx))!);
    const cols = gr.cols.map((cs) => unitIdOf(cs.map(idx))!);
    const rowIndex = new Map<number, number>();
    const colIndex = new Map<number, number>();
    rows.forEach((u, k) => units[u].forEach((c) => rowIndex.set(c, k)));
    cols.forEach((u, k) => units[u].forEach((c) => colIndex.set(c, k)));
    return { rows, cols, rowIndex, colIndex };
  });

  const regionOf = Array.from({ length: cellCount }, (_, i) => {
    const r = cellUnits[i].find((u) => unitKind[u] === 'box' || unitKind[u] === 'region');
    return r ?? -1;
  });

  const shaded = new Array<boolean>(cellCount).fill(false);
  for (const p of b.shaded ?? []) shaded[idx(p)] = true;

  const intersections: [number, number][] = [];
  for (let a = 0; a < units.length; a++) {
    const inA = new Set(units[a]);
    for (let c = 0; c < units.length; c++) {
      if (a === c) continue;
      let k = 0;
      for (const x of units[c]) if (inA.has(x)) k++;
      if (k >= 2) intersections.push([a, c]);
    }
  }

  const all = ((1 << (b.n + 1)) - 1) & ~1;
  return {
    variant: b.variant,
    n: b.n,
    all,
    cellCount,
    gridRows,
    gridCols,
    pos: b.cells,
    cellAt,
    units,
    unitKind,
    unitLabel,
    cellUnits,
    peers,
    peerSet,
    lineGroups,
    regionOf,
    shaded,
    intersections,
    cellName: (i) => b.cellName(b.cells[i][0], b.cells[i][1]),
    symbol: (d) => SYMBOLS[d] ?? String(d),
  };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Rows, columns and boxes of an n×n sudoku placed at (r0, c0) on the display grid. */
function standardUnits(n: number, box: number, r0 = 0, c0 = 0, suffix = '') {
  const units: Builder['units'] = [];
  const rows = range(n).map((r) => range(n).map((c) => [r0 + r, c0 + c] as [number, number]));
  const cols = range(n).map((c) => range(n).map((r) => [r0 + r, c0 + c] as [number, number]));
  rows.forEach((cells, r) => units.push({ cells, kind: 'row', label: `row ${r + 1}${suffix}` }));
  cols.forEach((cells, c) => units.push({ cells, kind: 'col', label: `column ${c + 1}${suffix}` }));
  for (let b = 0; b < n; b++) {
    const br = Math.floor(b / box) * box;
    const bc = (b % box) * box;
    const cells: [number, number][] = [];
    for (let dr = 0; dr < box; dr++) for (let dc = 0; dc < box; dc++) cells.push([r0 + br + dr, c0 + bc + dc]);
    units.push({ cells, kind: 'box', label: `box ${b + 1}${suffix}` });
  }
  return { units, rows, cols };
}

const plainName = (r: number, c: number) => `R${r + 1}C${c + 1}`;

function squareCells(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out.push([r, c]);
  return out;
}

export function classicGeometry(): Geometry {
  const s = standardUnits(9, 3);
  return build({
    variant: 'classic',
    n: 9,
    gridRows: 9,
    gridCols: 9,
    cells: squareCells(9),
    units: s.units,
    groups: [{ rows: s.rows, cols: s.cols }],
    cellName: plainName,
  });
}

export const WINDOWS: [number, number][] = [
  [1, 1],
  [1, 5],
  [5, 1],
  [5, 5],
];

export function windokuGeometry(): Geometry {
  const s = standardUnits(9, 3);
  const shaded: [number, number][] = [];
  WINDOWS.forEach(([r0, c0], w) => {
    const cells: [number, number][] = [];
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) cells.push([r0 + dr, c0 + dc]);
    shaded.push(...cells);
    s.units.push({ cells, kind: 'window', label: `window ${w + 1}` });
  });
  return build({
    variant: 'windoku',
    n: 9,
    gridRows: 9,
    gridCols: 9,
    cells: squareCells(9),
    units: s.units,
    groups: [{ rows: s.rows, cols: s.cols }],
    shaded,
    cellName: plainName,
  });
}

/** regions: 81 entries, region id 0..8 per cell (row-major). */
export function jigsawGeometry(regions: number[]): Geometry {
  const s = standardUnits(9, 3);
  const units = s.units.filter((u) => u.kind !== 'box');
  for (let k = 0; k < 9; k++) {
    const cells = range(81)
      .filter((i) => regions[i] === k)
      .map((i) => [Math.floor(i / 9), i % 9] as [number, number]);
    units.push({ cells, kind: 'region', label: `region ${k + 1}` });
  }
  return build({
    variant: 'jigsaw',
    n: 9,
    gridRows: 9,
    gridCols: 9,
    cells: squareCells(9),
    units,
    groups: [{ rows: s.rows, cols: s.cols }],
    cellName: plainName,
  });
}

export function sixteenGeometry(): Geometry {
  const s = standardUnits(16, 4);
  return build({
    variant: 'sixteen',
    n: 16,
    gridRows: 16,
    gridCols: 16,
    cells: squareCells(16),
    units: s.units,
    groups: [{ rows: s.rows, cols: s.cols }],
    cellName: plainName,
  });
}

/** Origins of the five samurai sub-grids on the 21×21 display grid. */
export const SAMURAI_GRIDS: { r0: number; c0: number; name: string }[] = [
  { r0: 0, c0: 0, name: 'top-left' },
  { r0: 0, c0: 12, name: 'top-right' },
  { r0: 6, c0: 6, name: 'centre' },
  { r0: 12, c0: 0, name: 'bottom-left' },
  { r0: 12, c0: 12, name: 'bottom-right' },
];

const inGrid = (r: number, c: number, g: { r0: number; c0: number }) =>
  r >= g.r0 && r < g.r0 + 9 && c >= g.c0 && c < g.c0 + 9;

export function samuraiGeometry(): Geometry {
  const cells: [number, number][] = [];
  for (let r = 0; r < 21; r++) for (let c = 0; c < 21; c++) if (SAMURAI_GRIDS.some((g) => inGrid(r, c, g))) cells.push([r, c]);
  const units: Builder['units'] = [];
  const groups: Builder['groups'] = [];
  for (const g of SAMURAI_GRIDS) {
    const s = standardUnits(9, 3, g.r0, g.c0, ` of the ${g.name} grid`);
    units.push(...s.units);
    groups.push({ rows: s.rows, cols: s.cols });
  }
  return build({
    variant: 'samurai',
    n: 9,
    gridRows: 21,
    gridCols: 21,
    cells,
    units,
    groups,
    cellName: (r, c) => {
      // Name cells relative to a corner grid when they're in one, else the centre grid.
      const g = SAMURAI_GRIDS.find((x) => x.name !== 'centre' && inGrid(r, c, x)) ?? SAMURAI_GRIDS[2];
      return `${g.name} R${r - g.r0 + 1}C${c - g.c0 + 1}`;
    },
  });
}

let classicCache: Geometry | null = null;
let windokuCache: Geometry | null = null;
let sixteenCache: Geometry | null = null;
let samuraiCache: Geometry | null = null;
const jigsawCache = new Map<string, Geometry>();

export const CLASSIC = (() => (classicCache ??= classicGeometry()))();

export function geometryFor(variant: SudokuVariant, regions?: number[]): Geometry {
  switch (variant) {
    case 'classic':
      return (classicCache ??= classicGeometry());
    case 'windoku':
      return (windokuCache ??= windokuGeometry());
    case 'sixteen':
      return (sixteenCache ??= sixteenGeometry());
    case 'samurai':
      return (samuraiCache ??= samuraiGeometry());
    case 'jigsaw': {
      if (!regions) throw new Error('jigsaw needs regions');
      const key = regions.join('');
      let g = jigsawCache.get(key);
      if (!g) {
        g = jigsawGeometry(regions);
        if (jigsawCache.size > 8) jigsawCache.clear();
        jigsawCache.set(key, g);
      }
      return g;
    }
  }
}
