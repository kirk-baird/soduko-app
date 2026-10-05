import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { PuzzleStep } from '../engine/common';
import { GRASS, TENT, TentsPuzzle } from '../engine/tents';
import { Theme } from '../theme';

const GAP = 1;

export function tentsBoardSize(p: TentsPuzzle, cellSize: number, mini?: boolean) {
  const pitch = cellSize + GAP;
  const margin = mini ? 0 : cellSize; // room for the counts
  return { width: margin + p.cols * pitch + GAP, height: margin + p.rows * pitch + GAP };
}

const TentsCell = memo(function TentsCell(props: {
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
  size: number;
  tree: boolean;
  mark: number;
  wrong: boolean;
  ghost: number; // hint placement: 1 tent, 2 grass
  bg: string;
  mini?: boolean;
  theme: Theme;
  onPress?: (i: number) => void;
}) {
  const t = props.theme;
  const s = props.size;
  const icon = props.tree ? (
    <MaterialCommunityIcons name="pine-tree" size={s * 0.78} color={t.tree} />
  ) : props.mark === TENT ? (
    <MaterialCommunityIcons name="tent" size={s * 0.74} color={props.wrong ? t.digitError : t.tent} />
  ) : props.mark === GRASS ? (
    <View style={{ width: s * 0.22, height: s * 0.22, borderRadius: s * 0.11, backgroundColor: props.wrong ? t.digitError : t.grass }} />
  ) : props.ghost === TENT ? (
    <MaterialCommunityIcons name="tent" size={s * 0.74} color={t.hintKey} />
  ) : props.ghost === GRASS ? (
    <View style={{ width: s * 0.3, height: s * 0.3, borderRadius: s * 0.15, borderWidth: 2, borderColor: t.hintKey }} />
  ) : null;
  const style = {
    position: 'absolute' as const,
    left: props.x,
    top: props.y,
    width: s,
    height: s,
    backgroundColor: props.mark === GRASS && !props.ghost ? t.cellPeer : props.bg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
  if (!props.onPress || props.tree || props.mini) return <View style={style}>{icon}</View>;
  const what = props.mark === TENT ? ', tent' : props.mark === GRASS ? ', grass' : '';
  return (
    <Pressable style={style} onPress={() => props.onPress?.(props.index)} accessibilityLabel={`Row ${props.row + 1} column ${props.col + 1}${what}`}>
      {icon}
    </Pressable>
  );
});

export function TentsBoard(props: {
  puzzle: TentsPuzzle;
  marks: number[];
  cellSize: number;
  errorDetection: boolean;
  hintStep?: PuzzleStep | null;
  problemCells?: number[];
  hidden?: boolean;
  mini?: boolean;
  theme: Theme;
  onPressCell?: (i: number) => void;
}) {
  const { puzzle: p, marks, cellSize: s, theme: t, mini } = props;
  const pitch = s + GAP;
  const margin = mini ? 0 : s;
  const size = tentsBoardSize(p, s, mini);
  const trees = new Set(p.trees);
  const pattern = new Set(props.hintStep?.pattern ?? []);
  const unit = new Set(props.hintStep?.unitCells ?? []);
  const problem = new Set(props.problemCells ?? []);
  const ghost = new Map<number, number>();
  for (const pl of props.hintStep?.placements ?? []) ghost.set(pl.cell, pl.digit);

  const rowTents = new Array(p.rows).fill(0);
  const colTents = new Array(p.cols).fill(0);
  marks.forEach((m, i) => {
    if (m === TENT) {
      rowTents[Math.floor(i / p.cols)]++;
      colTents[i % p.cols]++;
    }
  });
  const countColor = (have: number, need: number) => (have > need ? t.countOver : have === need ? t.countDone : t.text);

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < p.rows * p.cols; i++) {
    const r = Math.floor(i / p.cols);
    const c = i % p.cols;
    const mark = props.hidden ? 0 : marks[i];
    const wrong = !!mark && props.errorDetection && ((mark === TENT && p.solution[i] !== 1) || (mark === GRASS && p.solution[i] === 1));
    let bg = t.cell;
    if (problem.has(i)) bg = t.cellError;
    else if (pattern.has(i)) bg = t.hintPattern;
    else if (unit.has(i)) bg = t.cellPeer;
    cells.push(
      <TentsCell
        key={i}
        index={i}
        row={r}
        col={c}
        x={margin + c * pitch + GAP}
        y={margin + r * pitch + GAP}
        size={s}
        tree={trees.has(i) && !props.hidden}
        mark={trees.has(i) ? 0 : mark}
        wrong={wrong}
        ghost={props.hidden ? 0 : (ghost.get(i) ?? 0)}
        bg={bg}
        mini={mini}
        theme={t}
        onPress={props.onPressCell}
      />,
    );
  }

  return (
    <View style={{ width: size.width, height: size.height }}>
      <View
        style={{
          position: 'absolute',
          left: margin,
          top: margin,
          width: p.cols * pitch + GAP,
          height: p.rows * pitch + GAP,
          backgroundColor: t.lineThin,
          borderRadius: 3,
        }}
      />
      {!mini
        ? p.colCounts.map((n, c) => (
            <Text
              key={`c${c}`}
              style={{
                position: 'absolute',
                left: margin + c * pitch + GAP,
                top: 0,
                width: s,
                height: s,
                textAlign: 'center',
                lineHeight: s,
                fontSize: s * 0.5,
                fontWeight: '700',
                color: countColor(colTents[c], n),
              }}
            >
              {n}
            </Text>
          ))
        : null}
      {!mini
        ? p.rowCounts.map((n, r) => (
            <Text
              key={`r${r}`}
              style={{
                position: 'absolute',
                left: 0,
                top: margin + r * pitch + GAP,
                width: s,
                height: s,
                textAlign: 'center',
                lineHeight: s,
                fontSize: s * 0.5,
                fontWeight: '700',
                color: countColor(rowTents[r], n),
              }}
            >
              {n}
            </Text>
          ))
        : null}
      {cells}
    </View>
  );
}
