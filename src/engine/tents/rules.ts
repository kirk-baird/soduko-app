// Human-style deductions for Tents.
//
// Every rule looks at the current cell states (tent / grass / undecided) and
// returns one deduction as a PuzzleStep (placements: digit 1 = tent, 2 = grass),
// or null. Rules only use the puzzle's constraints, never its uniqueness, so
// they are also valid inside a "what if" lookahead, where reaching a
// contradiction proves the assumption wrong.

import { CellDigit, KeyCandidate, PuzzleStep } from '../common';
import {
  Frame,
  GRASS,
  Line,
  Pairs,
  TENT,
  UNK,
  cap,
  cellName,
  hallCheck,
  listNames,
  obviousPairs,
  plural,
} from './board';

export interface TStep extends PuzzleStep {
  brief: string; // short form used inside lookahead chains
}

export interface Ctx {
  f: Frame;
  cells: number[];
  _pairs?: Pairs;
}

export interface Rule {
  id: string;
  name: string;
  tier: number;
  find: (c: Ctx) => TStep | null;
}

export const makeCtx = (f: Frame, cells: number[]): Ctx => ({ f, cells });

const pairsOf = (c: Ctx) => (c._pairs ??= obviousPairs(c.f, c.cells));

const uniq = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

interface StepFields {
  tents?: number[];
  grass?: number[];
  pattern?: number[];
  keys?: KeyCandidate[];
  unitCells?: number[];
  explanation: string;
  brief: string;
}

function mk(rule: { id: string; name: string; tier: number }, s: StepFields): TStep {
  const placements: CellDigit[] = [
    ...uniq(s.tents ?? []).map((cell) => ({ cell, digit: TENT })),
    ...uniq(s.grass ?? []).map((cell) => ({ cell, digit: GRASS })),
  ];
  return {
    technique: rule.id,
    name: rule.name,
    tier: rule.tier,
    placements,
    eliminations: [],
    pattern: uniq(s.pattern ?? []),
    keys: s.keys ?? [],
    unitCells: uniq(s.unitCells ?? []),
    explanation: s.explanation,
    brief: s.brief,
  };
}

const tentKeys = (cells: number[]): KeyCandidate[] => cells.map((cell) => ({ cell, digit: TENT }));

/** "is" / "are" agreement for a list of cells. */
const isAre = (n: number) => (n === 1 ? 'is' : 'are');

// ---------- line helpers ----------

interface Run {
  cells: number[];
  max: number;
}

function lineInfo(c: Ctx, line: Line) {
  let t = 0;
  const tents: number[] = [];
  const unk: number[] = [];
  const runs: Run[] = [];
  let cur: number[] = [];
  const flush = () => {
    if (cur.length) runs.push({ cells: cur, max: (cur.length + 1) >> 1 });
    cur = [];
  };
  for (const i of line.cells) {
    const v = c.cells[i];
    if (v === UNK) {
      unk.push(i);
      cur.push(i);
    } else {
      if (v === TENT) {
        t++;
        tents.push(i);
      }
      flush();
    }
  }
  flush();
  return { t, tents, unk, runs, maxSum: runs.reduce((a, r) => a + r.max, 0) };
}

/** Quick, allocation-free counts for a line: tents, undecided cells, max extra tents (runs). */
function quick(cells: number[], line: Line): { t: number; u: number; maxSum: number } {
  let t = 0;
  let u = 0;
  let maxSum = 0;
  let run = 0;
  for (const i of line.cells) {
    const v = cells[i];
    if (v === UNK) {
      run++;
      u++;
    } else {
      if (v === TENT) t++;
      maxSum += (run + 1) >> 1;
      run = 0;
    }
  }
  maxSum += (run + 1) >> 1;
  return { t, u, maxSum };
}

function runName(run: Run, cols: number): string {
  const a = cellName(run.cells[0], cols);
  return run.cells.length === 1 ? a : `${a}–${cellName(run.cells[run.cells.length - 1], cols)}`;
}

/** Tents/grass forced when a run must hold between lo and hi tents (no two adjacent). */
function runDeductions(c: Ctx, run: Run, lo: number, hi: number) {
  const L = run.cells.length;
  const options: number[][] = [];
  const rec = (start: number, chosen: number[]) => {
    if (chosen.length >= lo) options.push(chosen.slice());
    if (chosen.length >= hi) return;
    for (let k = start; k < L; k++) {
      chosen.push(k);
      rec(k + 2, chosen);
      chosen.pop();
    }
  };
  rec(0, []);
  const tents: number[] = [];
  const grassIn: number[] = [];
  for (let k = 0; k < L; k++) {
    const inAll = options.every((o) => o.includes(k));
    const inNone = options.every((o) => !o.includes(k));
    if (inAll) tents.push(run.cells[k]);
    else if (inNone) grassIn.push(run.cells[k]);
  }
  // Outside cells touching a tent in every option.
  const inRun = new Set(run.cells);
  let common: Set<number> | null = null;
  for (const o of options) {
    const touched = new Set<number>();
    for (const k of o) for (const j of c.f.g.adj8[run.cells[k]]) if (!inRun.has(j) && c.cells[j] === UNK) touched.add(j);
    if (common === null) common = touched;
    else {
      const prev: Set<number> = common;
      common = new Set([...prev].filter((j) => touched.has(j)));
    }
    if (common.size === 0) break;
  }
  const grassOut = common ? [...common] : [];
  return { tents, grassIn, grassOut };
}

function describeRunResult(cols: number, d: { tents: number[]; grassIn: number[]; grassOut: number[] }, run: Run) {
  const parts: string[] = [];
  if (d.tents.length) parts.push(`${listNames(d.tents, cols)} must be ${d.tents.length === 1 ? 'a tent' : 'tents'}`);
  if (d.grassIn.length) parts.push(`${listNames(d.grassIn, cols)} must be grass`);
  if (d.grassOut.length) {
    parts.push(
      `${listNames(d.grassOut, cols)} would touch a tent however ${runName(run, cols)} is filled, so ${d.grassOut.length === 1 ? 'it is' : 'they are'} grass`,
    );
  }
  return parts.join('; ');
}

// ---------- tier 0 ----------

const nextToTent: Rule = {
  id: 'nextToTent',
  name: 'Next to a Tent',
  tier: 0,
  find(c) {
    const { g } = c.f;
    for (let i = 0; i < g.n; i++) {
      if (c.cells[i] !== TENT) continue;
      const unk = g.adj8[i].filter((j) => c.cells[j] === UNK);
      if (!unk.length) continue;
      const n = cellName(i, g.cols);
      return mk(this, {
        grass: unk,
        pattern: [i],
        keys: tentKeys([i]),
        unitCells: g.adj8[i],
        explanation: `Tents never touch, not even diagonally. ${n} holds a tent, so ${listNames(unk, g.cols)} next to it ${isAre(unk.length)} grass.`,
        brief: `${listNames(unk, g.cols, 4)} ${isAre(unk.length)} grass (touching the tent at ${n})`,
      });
    }
    return null;
  },
};

const lineFull: Rule = {
  id: 'lineFull',
  name: 'Count Reached',
  tier: 0,
  find(c) {
    const cols = c.f.g.cols;
    for (const line of c.f.lines) {
      const q = quick(c.cells, line);
      if (q.t !== line.need || !q.u) continue;
      const info = lineInfo(c, line);
      const explanation =
        line.need === 0
          ? `The number for ${line.name} is 0, so it has no tents at all: every open cell in it is grass.`
          : `${cap(line.name)} needs ${plural(line.need, 'tent')} and already has ${line.need === 1 ? 'it' : 'them'} (${listNames(info.tents, cols)}), so the rest of ${line.name} is grass.`;
      return mk(this, {
        grass: info.unk,
        pattern: info.tents,
        keys: tentKeys(info.tents),
        unitCells: line.cells,
        explanation,
        brief: `the rest of ${line.name} is grass (${line.need === 0 ? 'its number is 0' : line.need === 1 ? 'it already has its tent' : `it already has all ${line.need} of its tents`})`,
      });
    }
    return null;
  },
};

const noTree: Rule = {
  id: 'noTree',
  name: 'No Tree Nearby',
  tier: 0,
  find(c) {
    const { g } = c.f;
    const cells: number[] = [];
    for (let i = 0; i < g.n; i++) if (c.cells[i] === UNK && c.f.treeNbrs[i].length === 0) cells.push(i);
    if (!cells.length) return null;
    return mk(this, {
      grass: cells,
      pattern: cells,
      explanation:
        `Every tent sits directly beside its tree (up, down, left or right). ` +
        `${listNames(cells, g.cols)} ${cells.length === 1 ? 'has' : 'have'} no tree beside ${cells.length === 1 ? 'it' : 'them'}, so ${cells.length === 1 ? 'it is' : 'they are'} grass.`,
      brief: `${listNames(cells, g.cols, 4)} ${isAre(cells.length)} grass (no tree beside ${cells.length === 1 ? 'it' : 'them'})`,
    });
  },
};

const treesTaken: Rule = {
  id: 'treesTaken',
  name: 'Trees Already Taken',
  tier: 0,
  find(c) {
    const { g } = c.f;
    const { tentOf } = pairsOf(c);
    for (const tr of c.f.trees) {
      const tent = tentOf.get(tr);
      if (tent === undefined) continue;
      const cells = g.orth[tr].filter((j) => c.cells[j] === UNK && c.f.treeNbrs[j].every((x) => tentOf.has(x)));
      if (!cells.length) continue;
      const others = uniq(cells.flatMap((j) => c.f.treeNbrs[j]).filter((x) => x !== tr));
      const trN = cellName(tr, g.cols);
      const extra = others.length
        ? ` (and ${others.length === 1 ? 'the other tree beside them, at' : 'the other trees beside them, at'} ${listNames(others, g.cols)}, ${others.length === 1 ? 'has its tent' : 'have theirs'} too)`
        : '';
      return mk(this, {
        grass: cells,
        pattern: [tr, ...others],
        keys: tentKeys([tent, ...others.map((x) => tentOf.get(x)!)]),
        unitCells: [tent, ...others.map((x) => tentOf.get(x)!)],
        explanation:
          `Each tent needs a tree of its own. The tree at ${trN} already has its tent at ${cellName(tent, g.cols)}${extra}. ` +
          `A tent at ${listNames(cells, g.cols)} would have no free tree to attach to, so ${cells.length === 1 ? 'it is' : 'they are'} grass.`,
        brief: `${listNames(cells, g.cols, 4)} ${isAre(cells.length)} grass (the tree at ${trN} is already taken)`,
      });
    }
    return null;
  },
};

/** Free trees: not obviously paired and with no untaken tent beside them, so they still need a new tent. */
function needyTrees(c: Ctx): { tree: number; spots: number[] }[] {
  const { tentOf, treeOf } = pairsOf(c);
  const out: { tree: number; spots: number[] }[] = [];
  for (const tr of c.f.trees) {
    if (tentOf.has(tr)) continue;
    const o = c.f.g.orth[tr];
    if (o.some((j) => c.cells[j] === TENT && !treeOf.has(j))) continue;
    out.push({ tree: tr, spots: o.filter((j) => c.cells[j] === UNK) });
  }
  return out;
}

const treeOneSpot: Rule = {
  id: 'treeOneSpot',
  name: 'Only Spot for a Tree',
  tier: 0,
  find(c) {
    const { g } = c.f;
    const { treeOf } = pairsOf(c);
    for (const { tree, spots } of needyTrees(c)) {
      if (spots.length !== 1) continue;
      const trN = cellName(tree, g.cols);
      const owned = g.orth[tree].filter((j) => c.cells[j] === TENT);
      const note = owned.length
        ? ` (${owned.map((t) => `the tent at ${cellName(t, g.cols)} belongs to the tree at ${cellName(treeOf.get(t)!, g.cols)}`).join('; ')})`
        : '';
      return mk(this, {
        tents: spots,
        pattern: [tree],
        unitCells: g.orth[tree],
        keys: tentKeys(owned),
        explanation: `The tree at ${trN} still needs its own tent, and ${cellName(spots[0], g.cols)} is the only spot left beside it${note}. So ${cellName(spots[0], g.cols)} is a tent.`,
        brief: `${cellName(spots[0], g.cols)} is a tent (the only spot left for the tree at ${trN})`,
      });
    }
    return null;
  },
};

const lineNeedsAll: Rule = {
  id: 'lineNeedsAll',
  name: 'All Remaining Spots',
  tier: 0,
  find(c) {
    const cols = c.f.g.cols;
    for (const line of c.f.lines) {
      const q = quick(c.cells, line);
      if (!q.u || line.need - q.t !== q.u) continue;
      const info = lineInfo(c, line);
      const left = line.need - info.t;
      const has = info.t ? ` It already has ${info.t}, so it needs ${left} more, and` : '';
      const they = info.unk.length === 1 ? 'it is a tent' : info.unk.length === 2 ? 'both are tents' : 'they are all tents';
      return mk(this, {
        tents: info.unk,
        pattern: info.unk,
        keys: tentKeys(info.tents),
        unitCells: line.cells,
        explanation: `${cap(line.name)} needs ${plural(line.need, 'tent')}.${has} only ${listNames(info.unk, cols)} ${isAre(info.unk.length)} still open, so ${they}.`.replace(
          `${plural(line.need, 'tent')}. only`,
          `${plural(line.need, 'tent')} and only`,
        ),
        brief: `${listNames(info.unk, cols, 4)} ${isAre(info.unk.length)} ${info.unk.length === 1 ? 'a tent' : 'tents'} (the only open ${info.unk.length === 1 ? 'cell' : 'cells'} left in ${line.name})`,
      });
    }
    return null;
  },
};

// ---------- tier 1 ----------

const blockedTree: Rule = {
  id: 'blockedTree',
  name: 'Would Block a Tree',
  tier: 1,
  find(c) {
    const { g } = c.f;
    for (const { tree, spots } of needyTrees(c)) {
      if (spots.length < 2) continue;
      let common = g.adj8[spots[0]].filter((j) => c.cells[j] === UNK && !spots.includes(j));
      for (const s of spots.slice(1)) common = common.filter((j) => g.adj8[s].includes(j));
      if (!common.length) continue;
      const trN = cellName(tree, g.cols);
      const sp = spots.map((s) => cellName(s, g.cols));
      const spotsText = sp.length === 2 ? `${sp[0]} or ${sp[1]}` : `${sp.slice(0, -1).join(', ')} or ${sp[sp.length - 1]}`;
      const x = listNames(common, g.cols);
      return mk(this, {
        grass: common,
        pattern: [tree],
        unitCells: spots,
        explanation:
          `The tree at ${trN} needs its tent in ${spotsText}. ${spots.length === 2 ? 'Both' : 'All'} of those touch ${x}, ` +
          `so a tent at ${x} would leave that tree with nowhere to put its own. ${x} ${isAre(common.length)} grass.`,
        brief: `${listNames(common, g.cols, 4)} ${isAre(common.length)} grass (${common.length === 1 ? 'it touches' : 'they touch'} every spot left for the tree at ${trN})`,
      });
    }
    return null;
  },
};

function runsRule(rule: { id: string; name: string; tier: number }, allMax: boolean): Rule {
  return {
    ...rule,
    find(c) {
      const cols = c.f.g.cols;
      for (const line of c.f.lines) {
        const q = quick(c.cells, line);
        if (q.t >= line.need || !q.u || (allMax && q.maxSum !== line.need - q.t)) continue;
        const info = lineInfo(c, line);
        const left = line.need - info.t;
        const groupsText = info.runs.map((r) => `${runName(r, cols)} (at most ${r.max})`).join(', ');
        if (allMax) {
          if (info.maxSum !== left) continue;
          // Every run must be full.
          const tents: number[] = [];
          const grass: number[] = [];
          const grassIn: number[] = [];
          const outTexts: string[] = [];
          for (const run of info.runs) {
            const d = runDeductions(c, run, run.max, run.max);
            tents.push(...d.tents);
            grassIn.push(...d.grassIn);
            grass.push(...d.grassIn, ...d.grassOut);
            if (d.grassOut.length) outTexts.push(describeRunResult(cols, { tents: [], grassIn: [], grassOut: d.grassOut }, run));
          }
          const results = [
            ...(tents.length ? [`${listNames(tents, cols)} must be ${tents.length === 1 ? 'a tent' : 'tents'}`] : []),
            ...(grassIn.length ? [`${listNames(grassIn, cols)} must be grass`] : []),
            ...outTexts,
          ];
          const shortParts = [
            ...(tents.length ? [`${listNames(tents, cols, 4)} ${isAre(tents.length)} ${tents.length === 1 ? 'a tent' : 'tents'}`] : []),
            ...(grass.length ? [`${listNames(uniq(grass), cols, 4)} ${isAre(grass.length)} grass`] : []),
          ];
          if (!tents.length && !grass.length) continue;
          const single = info.runs.length === 1;
          return mk(this, {
            tents,
            grass,
            pattern: info.unk,
            keys: tentKeys(info.tents),
            unitCells: line.cells,
            explanation:
              `${cap(line.name)} needs ${plural(left, 'more tent')}. Tents can't sit side by side, so ` +
              (single
                ? `its open cells ${runName(info.runs[0], cols)} can hold at most ${info.runs[0].max} — exactly enough, so ${info.runs[0].max === 1 ? 'one of them must be a tent' : 'they must be filled as fully as possible'}. `
                : `its groups of open cells ${groupsText} hold at most ${info.runs.map((r) => r.max).join(' + ')} = ${info.maxSum} — exactly enough, so every group must be as full as it can be. `) +
              `${cap(results.join('; '))}.`,
            brief: `every group of open cells in ${line.name} must be full, so ${shortParts.join(' and ')}`,
          });
        }
        for (const run of info.runs) {
          const othersMax = info.maxSum - run.max;
          const lo = left - othersMax;
          if (lo <= 0 || lo === run.max) continue; // lo === max is the all-full case (tier 1)
          const d = runDeductions(c, run, lo, run.max);
          if (!d.tents.length && !d.grassIn.length && !d.grassOut.length) continue;
          const others = info.runs.filter((r) => r !== run);
          const lead = others.length
            ? `Its other open cells (${others.map((r) => `${runName(r, cols)}: at most ${r.max}`).join(', ')}) can hold at most ${othersMax} without touching, so ${runName(run, cols)} must hold at least ${lo}.`
            : `Its only open cells are ${runName(run, cols)}, which must hold ${lo === run.max ? '' : 'at least '}${lo}.`;
          return mk(this, {
            tents: d.tents,
            grass: [...d.grassIn, ...d.grassOut],
            pattern: run.cells,
            keys: tentKeys(info.tents),
            unitCells: line.cells,
            explanation: `${cap(line.name)} needs ${plural(left, 'more tent')}. ${lead} ${cap(describeRunResult(cols, d, run))}.`,
            brief: `${runName(run, cols)} must hold at least ${lo} of ${line.name}'s tents, so ${[...(d.tents.length ? [`${listNames(d.tents, cols, 4)} ${isAre(d.tents.length)} ${d.tents.length === 1 ? 'a tent' : 'tents'}`] : []), ...(d.grassIn.length + d.grassOut.length ? [`${listNames(uniq([...d.grassIn, ...d.grassOut]), cols, 4)} ${isAre(d.grassIn.length + d.grassOut.length)} grass`] : [])].join(' and ')}`,
          });
        }
      }
      return null;
    },
  };
}

const lineRunsMax = runsRule({ id: 'lineRunsMax', name: 'Pair Counting', tier: 1 }, true);

// ---------- tier 2 ----------

const lineRuns = runsRule({ id: 'lineRuns', name: 'Segment Counting', tier: 2 }, false);

function hallText(f: Frame, v: ReturnType<typeof hallCheck>, cells: number[], hyp = -1): string {
  if (!v) return '';
  const cols = f.g.cols;
  if (v.side === 'trees') {
    const trees = `${v.left.length === 1 ? 'the tree at' : 'the trees at'} ${listNames(v.left, cols, 8)}`;
    if (!v.right.length) return `${trees} would have no spot left for ${v.left.length === 1 ? 'its tent' : 'their tents'}`;
    const labels = v.right.map((j) => (j === hyp ? `${cellName(j, cols)} itself` : cells[j] === TENT ? `the tent at ${cellName(j, cols)}` : cellName(j, cols)));
    const spots = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
    return `${trees} would have only ${spots} to use between them — ${plural(v.right.length, 'spot')} for ${v.left.length} trees, but each tree needs its own tent`;
  }
  const tents = v.left.map((j) => (j === hyp ? `${cellName(j, cols)} itself` : `the tent at ${cellName(j, cols)}`));
  const tentsText = tents.length === 1 ? tents[0] : `${tents.slice(0, -1).join(', ')} and ${tents[tents.length - 1]}`;
  if (!v.right.length) return `${tentsText} would have no free tree to attach to`;
  return `${tentsText} could only attach to ${v.right.length === 1 ? 'the tree at' : 'the trees at'} ${listNames(v.right, cols)} — but each tent needs a tree of its own`;
}

/** One-step "what if": a tent (or grass) here immediately breaks a row, column or tree. */
const tentWouldBlock: Rule = {
  id: 'tentWouldBlock',
  name: 'Would Break a Count',
  tier: 2,
  find(c) {
    const { g } = c.f;
    for (let i = 0; i < g.n; i++) {
      if (c.cells[i] !== UNK) continue;
      const a = c.cells.slice();
      a[i] = TENT;
      const around = g.adj8[i].filter((j) => a[j] === UNK);
      for (const j of around) a[j] = GRASS;
      const why = contradiction(makeCtx(c.f, a), false);
      if (why) {
        const n = cellName(i, g.cols);
        const aroundText = around.length ? `, so ${listNames(around, g.cols)} would all be grass. Then` : ', and then';
        return mk(this, {
          grass: [i],
          pattern: [i],
          unitCells: around,
          explanation: `A tent at ${n} would touch every cell around it${aroundText} ${why}. So ${n} is grass.`,
          brief: `${n} is grass (a tent there would mean ${why})`,
        });
      }
      const b = c.cells.slice();
      b[i] = GRASS;
      const why2 = contradiction(makeCtx(c.f, b), false);
      if (why2) {
        const n = cellName(i, g.cols);
        return mk(this, {
          tents: [i],
          pattern: [i],
          explanation: `If ${n} were grass, ${why2}. So ${n} is a tent.`,
          brief: `${n} is a tent (otherwise ${why2})`,
        });
      }
    }
    return null;
  },
};

const treeMatching: Rule = {
  id: 'treeMatching',
  name: 'Tree Matching',
  tier: 2,
  find(c) {
    const { g } = c.f;
    let best: { cell: number; asTent: boolean; v: NonNullable<ReturnType<typeof hallCheck>>; cs: number[] } | null = null;
    for (let i = 0; i < g.n; i++) {
      if (c.cells[i] !== UNK) continue;
      const a = c.cells.slice();
      a[i] = TENT;
      for (const j of g.adj8[i]) if (a[j] === UNK) a[j] = GRASS;
      const va = hallCheck(c.f, a);
      if (va && (!best || va.left.length < best.v.left.length)) best = { cell: i, asTent: true, v: va, cs: a };
      const b = c.cells.slice();
      b[i] = GRASS;
      const vb = hallCheck(c.f, b);
      if (vb && (!best || vb.left.length < best.v.left.length)) best = { cell: i, asTent: false, v: vb, cs: b };
      if (best && best.v.left.length <= 2) break;
    }
    if (!best) return null;
    const n = cellName(best.cell, g.cols);
    const v = best.v;
    const trees = v.side === 'trees' ? v.left : v.right;
    const spots = v.side === 'trees' ? v.right : v.left;
    const around = g.adj8[best.cell].filter((j) => c.cells[j] === UNK);
    const ifText = best.asTent
      ? `If ${n} were a tent, ${around.length ? `${listNames(around, g.cols)} around it would be grass, and then` : 'then'}`
      : `If ${n} were grass,`;
    return mk(this, {
      tents: best.asTent ? [] : [best.cell],
      grass: best.asTent ? [best.cell] : [],
      pattern: trees,
      unitCells: spots,
      keys: tentKeys(spots.filter((j) => c.cells[j] === TENT)),
      explanation: `Trees and tents pair up one-to-one. ${ifText} ${hallText(c.f, v, best.cs, best.cell)}. So ${n} ${best.asTent ? 'must be grass' : 'must be a tent'}.`,
      brief: `${n} is ${best.asTent ? 'grass' : 'a tent'} (otherwise ${hallText(c.f, v, best.cs, best.cell)})`,
    });
  },
};

// ---------- contradictions & lookahead ----------

function lineOk(cells: number[], line: Line): boolean {
  const q = quick(cells, line);
  return q.t <= line.need && q.t + q.maxSum >= line.need;
}

/** A plain-English reason the current state is impossible, or null. */
export function contradiction(c: Ctx, withHall: boolean): string | null {
  const { g } = c.f;
  const cols = g.cols;
  for (let i = 0; i < g.n; i++) {
    if (c.cells[i] !== TENT) continue;
    for (const j of g.adj8[i]) if (j > i && c.cells[j] === TENT) return `${cellName(i, cols)} and ${cellName(j, cols)} would both be tents, and they touch`;
  }
  for (const line of c.f.lines) {
    if (lineOk(c.cells, line)) continue;
    const info = lineInfo(c, line);
    if (info.t > line.need) return `${line.name} would have ${info.t} tents, but it needs only ${line.need}`;
    const left = line.need - info.t;
    if (info.unk.length < left) return `${line.name} would need ${plural(left, 'more tent')} but have ${info.unk.length ? `only ${plural(info.unk.length, 'open cell')}` : 'no open cells'} left`;
    if (info.maxSum < left) return `${line.name} would need ${plural(left, 'more tent')}, but its open cells (${info.runs.map((r) => runName(r, cols)).join(', ')}) can hold only ${info.maxSum} without touching`;
  }
  const { tentOf, treeOf } = pairsOf(c);
  for (const tr of c.f.trees) {
    if (tentOf.has(tr)) continue;
    const o = g.orth[tr];
    if (!o.some((j) => c.cells[j] === UNK || (c.cells[j] === TENT && !treeOf.has(j)))) {
      const owned = o.filter((j) => c.cells[j] === TENT);
      const note = owned.length
        ? ` (${owned.map((t) => `the tent at ${cellName(t, cols)} is the only one the tree at ${cellName(treeOf.get(t)!, cols)} can have`).join('; ')})`
        : '';
      return `the tree at ${cellName(tr, cols)} would have no spot left for its tent${note}`;
    }
  }
  for (let i = 0; i < g.n; i++) {
    if (c.cells[i] !== TENT || treeOf.has(i)) continue;
    if (c.f.treeNbrs[i].every((tr) => tentOf.has(tr))) {
      const taken = c.f.treeNbrs[i];
      return taken.length
        ? `the tent at ${cellName(i, cols)} would have no tree of its own (${taken.length === 1 ? 'the tree beside it is' : 'the trees beside it are'} already taken)`
        : `the tent at ${cellName(i, cols)} would have no tree beside it`;
    }
  }
  if (withHall) {
    const v = hallCheck(c.f, c.cells);
    if (v) return hallText(c.f, v, c.cells);
  }
  return null;
}

export function applyStep(cells: number[], st: PuzzleStep): void {
  for (const p of st.placements) cells[p.cell] = p.digit === TENT ? TENT : GRASS;
}

function simulate(f: Frame, cells: number[], rules: Rule[], withHall: boolean, maxSteps: number): { briefs: string[]; why: string } | null {
  const cs = cells.slice();
  const briefs: string[] = [];
  for (;;) {
    const ctx = makeCtx(f, cs);
    const why = contradiction(ctx, withHall);
    if (why) return { briefs, why };
    if (briefs.length >= maxSteps) return null;
    let st: TStep | null = null;
    for (const r of rules) if ((st = r.find(ctx))) break;
    if (!st) return null;
    applyStep(cs, st);
    briefs.push(st.brief);
  }
}

function lookaheadRule(rule: { id: string; name: string; tier: number }, inner: () => Rule[], withHall: boolean, maxSteps: number): Rule {
  return {
    ...rule,
    find(c) {
      const { g } = c.f;
      const rules = inner();
      let best: { cell: number; asTent: boolean; briefs: string[]; why: string } | null = null;
      // Most-constrained cells first: those beside trees with few spots.
      const order: number[] = [];
      for (let i = 0; i < g.n; i++) if (c.cells[i] === UNK) order.push(i);
      for (const i of order) {
        for (const asTent of [true, false]) {
          const cs = c.cells.slice();
          cs[i] = asTent ? TENT : GRASS;
          const limit = best ? best.briefs.length - 1 : maxSteps;
          if (limit < 0) continue;
          const r = simulate(c.f, cs, rules, withHall, limit);
          if (r) best = { cell: i, asTent, ...r };
        }
        if (best && best.briefs.length <= 1) break;
      }
      if (!best) return null;
      const n = cellName(best.cell, g.cols);
      const chain = best.briefs.length
        ? ` Then ${best.briefs.map((b, k) => `(${k + 1}) ${b}`).join('; ')}.`
        : '';
      return mk(this, {
        tents: best.asTent ? [] : [best.cell],
        grass: best.asTent ? [best.cell] : [],
        pattern: [best.cell],
        explanation: `Suppose ${n} were ${best.asTent ? 'a tent' : 'grass'}.${chain} But then ${best.why}. So ${n} can't be ${best.asTent ? 'a tent: it is grass' : 'grass: it is a tent'}.`,
        brief: `${n} is ${best.asTent ? 'grass' : 'a tent'} (assuming otherwise leads to a contradiction)`,
      });
    },
  };
}

export const TIER0: Rule[] = [nextToTent, lineFull, noTree, treesTaken, treeOneSpot, lineNeedsAll];
export const TIER1: Rule[] = [blockedTree, lineRunsMax];
export const TIER2: Rule[] = [lineRuns, tentWouldBlock, treeMatching];

const lookahead = lookaheadRule({ id: 'lookahead', name: 'What If', tier: 3 }, () => [...TIER0, ...TIER1], false, 6);
const deepLookahead = lookaheadRule({ id: 'deepLookahead', name: 'Deep What If', tier: 4 }, () => [...TIER0, ...TIER1, lineRuns], true, 12);

export const RULES: Rule[] = [...TIER0, ...TIER1, ...TIER2, lookahead, deepLookahead];

export function findStep(f: Frame, cells: number[], maxTier = 4): TStep | null {
  const ctx = makeCtx(f, cells);
  for (const r of RULES) {
    if (r.tier > maxTier) break;
    const st = r.find(ctx);
    if (st) return st;
  }
  return null;
}

export function stripBrief(st: TStep): PuzzleStep {
  const { brief: _brief, ...rest } = st;
  return rest;
}
