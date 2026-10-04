import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Cands, Grid, bit, boxOf, colOf, rowOf } from '../engine/grid';
import { Step } from '../engine/techniques';
import { Theme } from '../theme';
import { Cell } from './Cell';

const OUTER = 2;
const THICK = 2;
const THIN = 1;
const TOTAL_GAPS = OUTER * 2 + THICK * 2 + THIN * 6;

/** Cells to highlight for hints that aren't technique steps (wrong digits etc). */
export interface HintMarks {
  step?: Step;
  cells?: number[]; // highlighted as problem cells
  effective?: Cands; // candidates the hint reasoned about
}

interface Props {
  width: number;
  givens: Grid;
  values: Grid;
  pencil: Cands;
  solution: Grid;
  selected: number | null;
  errorDetection: boolean;
  highlightCandidates: boolean;
  hint: HintMarks | null;
  hidden: boolean; // paused
  theme: Theme;
  onPressCell: (i: number) => void;
}

const offset = (k: number, cell: number) => OUTER + k * cell + Math.floor(k / 3) * THICK + (k - Math.floor(k / 3)) * THIN;

export function Board(p: Props) {
  const t = p.theme;
  const cell = Math.floor((p.width - TOTAL_GAPS) / 9);
  const size = cell * 9 + TOTAL_GAPS;

  // Precompute hint masks per cell.
  const hintData = useMemo(() => {
    const key = new Array(81).fill(0);
    const alt = new Array(81).fill(0);
    const elim = new Array(81).fill(0);
    const place = new Array(81).fill(0);
    const pattern = new Set<number>();
    const unitCells = new Set<number>();
    const problem = new Set<number>(p.hint?.cells ?? []);
    const st = p.hint?.step;
    if (st) {
      for (const k of st.keys) (k.color === 1 ? alt : key)[k.cell] |= bit(k.digit);
      for (const e of st.eliminations) elim[e.cell] |= bit(e.digit);
      for (const pl of st.placements) place[pl.cell] = pl.digit;
      st.pattern.forEach((c) => pattern.add(c));
      for (const u of st.units) {
        for (let i = 0; i < 81; i++) {
          const inUnit = u < 9 ? rowOf(i) === u : u < 18 ? colOf(i) === u - 9 : boxOf(i) === u - 18;
          if (inUnit) unitCells.add(i);
        }
      }
    }
    return { key, alt, elim, place, pattern, unitCells, problem, active: !!p.hint };
  }, [p.hint]);

  const sel = p.selected;
  const selValue = sel != null ? p.values[sel] : 0;

  const cells = [];
  for (let i = 0; i < 81; i++) {
    const r = rowOf(i);
    const c = colOf(i);
    const value = p.values[i];
    const given = !!p.givens[i];
    const wrong = !!value && !given && value !== p.solution[i];
    const showError = wrong && p.errorDetection;

    let bg = given ? t.cellGiven : t.cell;
    if (hintData.active) {
      if (hintData.problem.has(i)) bg = t.cellError;
      else if (hintData.pattern.has(i)) bg = t.hintPattern;
      else if (hintData.unitCells.has(i)) bg = given ? t.cellPeerGiven : t.cellPeer;
    } else {
      const isPeer = sel != null && (rowOf(sel) === r || colOf(sel) === c || boxOf(sel) === boxOf(i));
      if (sel === i) bg = t.cellSelected;
      else if (showError) bg = t.cellError;
      else if (selValue && value === selValue) bg = t.cellSame;
      else if (isPeer) bg = given ? t.cellPeerGiven : t.cellPeer;
    }

    // During a hint, involved cells show the candidates the hint reasoned about.
    let pencil = value ? 0 : p.pencil[i];
    const involved = hintData.key[i] | hintData.alt[i] | hintData.elim[i];
    if (involved && p.hint?.effective) pencil = p.hint.effective[i];

    cells.push(
      <Cell
        key={i}
        index={i}
        size={cell}
        x={offset(c, cell)}
        y={offset(r, cell)}
        value={p.hidden ? 0 : value}
        given={given}
        showError={showError}
        pencil={p.hidden ? 0 : pencil}
        bg={p.hidden ? t.cell : bg}
        matchDigit={!hintData.active && p.highlightCandidates ? selValue : 0}
        keyMask={hintData.key[i]}
        keyAltMask={hintData.alt[i]}
        elimMask={hintData.elim[i]}
        placeDigit={hintData.place[i]}
        theme={t}
        onPress={p.onPressCell}
      />,
    );
  }

  return (
    <View style={{ width: size, height: size, backgroundColor: t.lineThick, borderRadius: 4, overflow: 'hidden' }}>
      {/* thin grid lines show through a lighter layer inside each box */}
      {[0, 1, 2].flatMap((br) =>
        [0, 1, 2].map((bc) => (
          <View
            key={`b${br}${bc}`}
            style={{
              position: 'absolute',
              left: offset(bc * 3, cell),
              top: offset(br * 3, cell),
              width: cell * 3 + THIN * 2,
              height: cell * 3 + THIN * 2,
              backgroundColor: t.lineThin,
            }}
          />
        )),
      )}
      {cells}
    </View>
  );
}
