import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DIFFICULTY_NAMES, DIFFICULTY_ORDER, Difficulty } from '../engine/common';
import { PipsPuzzle } from '../engine/pips';
import { TentsPuzzle } from '../engine/tents';
import { FONTS } from '../fonts';
import { GameState } from '../game/gameState';
import { PipsGameState } from '../game/pipsState';
import { TentsGameState } from '../game/tentsState';
import { GAMES, GameDef } from '../games/registry';
import { Stats, formatTime } from '../stats';
import { Theme } from '../theme';
import { Board } from './Board';
import { PipFace, PipsBoard, pipsBoardSize } from './PipsBoard';
import { TentsBoard } from './TentsBoard';

export type SavedGame = GameState | TentsGameState | PipsGameState;

/** A 2×2 box that fills up as the level gets harder. */
export function LevelPips({ level, theme: t }: { level: number; theme: Theme }) {
  const S = 10;
  const G = 3;
  return (
    <View style={{ width: S * 2 + G, height: S * 2 + G, flexDirection: 'row', flexWrap: 'wrap', gap: G }}>
      {/* fill order: top-left, top-right, bottom-right, bottom-left (clockwise) */}
      {[0, 1, 3, 2].map((k) => (
        <View key={k} style={{ width: S, height: S, borderRadius: 2.5, backgroundColor: k <= level ? t.levelRamp[level] : t.pipEmpty }} />
      ))}
    </View>
  );
}

/** Small icon for a game type. Samurai gets a drawn cross of five squares, Pips a domino. */
export function GameGlyph({ def, size, color, theme: t }: { def: GameDef; size: number; color: string; theme: Theme }) {
  if (def.icon.kind === 'domino') {
    const w = size * 0.52;
    const bw = Math.max(1.5, size * 0.07);
    const face = w - 2 * bw;
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: w, height: size * 0.94, borderWidth: bw, borderColor: color, borderRadius: size * 0.12, alignItems: 'center', justifyContent: 'space-around' }}>
          <PipFace value={2} size={face} color={color} />
          <View style={{ width: face * 0.7, height: bw * 0.8, backgroundColor: color }} />
          <PipFace value={5} size={face} color={color} />
        </View>
      </View>
    );
  }
  if (def.icon.kind === 'samurai') {
    const u = size / 7;
    const sq = (x: number, y: number, k: number) => (
      <View
        key={k}
        style={{ position: 'absolute', left: x * u, top: y * u, width: 3 * u, height: 3 * u, borderWidth: Math.max(1.5, u * 0.45), borderColor: color, borderRadius: u * 0.4, backgroundColor: k === 2 ? t.surface : 'transparent' }}
      />
    );
    return <View style={{ width: size, height: size }}>{[sq(0, 0, 0), sq(4, 0, 1), sq(2, 2, 2), sq(0, 4, 3), sq(4, 4, 4)]}</View>;
  }
  return <MaterialCommunityIcons name={def.icon.name} size={size} color={color} />;
}

/** Live miniature of a saved game (or a preview puzzle). */
export function GamePreview({ game, size, theme: t }: { game: SavedGame; size: number; theme: Theme }) {
  const def = GAMES[game.type ?? 'classic'];
  const adapter = useMemo(() => (def.adapter && 'values' in game ? def.adapter(game.payload) : null), [def, game]);
  if (game.type === 'pips') {
    const p = game.payload as PipsPuzzle;
    let cell = Math.floor(size / Math.max(p.rows, p.cols));
    while (cell > 3 && Math.max(pipsBoardSize(p, cell, true).width, pipsBoardSize(p, cell, true).height) > size) cell--;
    return <PipsBoard puzzle={p} place={(game as PipsGameState).place} cellSize={cell} mini theme={t} />;
  }
  if (game.type === 'tents') {
    const p = game.payload as TentsPuzzle;
    const cell = Math.floor((size - 1) / Math.max(p.rows, p.cols) - 1);
    return <TentsBoard puzzle={p} marks={(game as TentsGameState).marks} cellSize={cell} errorDetection={false} mini theme={t} />;
  }
  if (!adapter || !('values' in game)) return null;
  const { layout } = adapter;
  const cell = Math.max(3, Math.floor((size - 1) / Math.max(layout.gridRows, layout.gridCols) - 1));
  return (
    <Board
      layout={layout}
      cellSize={cell}
      maxDigit={adapter.rules.maxDigit}
      givens={game.givens}
      values={game.values}
      pencil={game.pencil}
      solution={game.solution}
      playable={adapter.rules.playable}
      peers={adapter.rules.peers}
      selected={null}
      highlightDigit={0}
      errorDetection={false}
      highlightCandidates={false}
      hint={null}
      hidden={false}
      mini
      theme={t}
    />
  );
}

export function progressOf(game: SavedGame): { done: number; total: number } {
  if (game.type === 'pips') {
    const g = game as PipsGameState;
    return { done: g.place.filter(Boolean).length, total: g.place.length };
  }
  if (game.type === 'tents') {
    const g = game as TentsGameState;
    const total = g.payload.solution.filter((x) => x === 1).length;
    return { done: g.marks.filter((m) => m === 1).length, total };
  }
  const g = game as GameState;
  const def = GAMES[g.type ?? 'classic'];
  const playable = def.adapter ? def.adapter(g.payload).rules.playable : g.values.map(() => true);
  let total = 0;
  let done = 0;
  g.values.forEach((v, i) => {
    if (!playable[i]) return;
    total++;
    if (v) done++;
  });
  return { done, total };
}

/** Dark hero card: preview on the left, details and a resume/start button on the right. */
export function ContinueCard(props: {
  game: SavedGame;
  label: string; // 'In progress' / 'Next up'
  showType: boolean;
  resume: boolean; // true: progress + Resume; false: Start puzzle
  boardSize: number;
  onPress: () => void;
  theme: Theme;
}) {
  const t = props.theme;
  const { game } = props;
  const def = GAMES[game.type ?? 'classic'];
  const prog = props.resume ? progressOf(game) : null;
  const unit = game.type === 'tents' ? 'tents' : game.type === 'pips' ? 'dominoes' : 'cells';
  const title = props.showType ? def.name : DIFFICULTY_NAMES[game.difficulty];
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => [styles.hero, { backgroundColor: t.heroBg, opacity: pressed ? 0.94 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`${props.resume ? 'Resume' : 'Start'} ${def.name} ${DIFFICULTY_NAMES[game.difficulty]}`}
    >
      <View style={{ width: props.boardSize, alignItems: 'center', justifyContent: 'center' }}>
        <GamePreview game={game} size={props.boardSize} theme={t} />
      </View>
      <View style={styles.heroBody}>
        <Text style={[styles.heroLabel, { color: t.heroMuted }]}>{props.label}</Text>
        <Text style={[styles.heroTitle, { color: t.heroText }]} numberOfLines={1} adjustsFontSizeToFit>
          {title}
        </Text>
        {props.showType ? <Text style={[styles.heroMeta, { color: t.heroMuted }]}>{DIFFICULTY_NAMES[game.difficulty]}</Text> : null}
        {prog ? (
          <>
            <Text style={[styles.heroMeta, { color: t.heroMuted }]}>{formatTime(game.elapsedMs)} so far</Text>
            <View style={[styles.track, { backgroundColor: t.heroTrack }]}>
              <View style={[styles.trackFill, { width: `${(prog.done / Math.max(1, prog.total)) * 100}%`, backgroundColor: t.heroText }]} />
            </View>
            <Text style={[styles.heroMeta, { color: t.heroMuted }]}>
              {prog.done} of {prog.total} {unit}
            </Text>
          </>
        ) : (
          <Text style={[styles.heroMeta, { color: t.heroMuted }]}>{def.levels[game.difficulty]}</Text>
        )}
        <View style={{ flex: 1 }} />
        <View style={[styles.heroButton, { backgroundColor: t.heroButton }]}>
          <MaterialCommunityIcons name="play" size={18} color={t.heroButtonText} />
          <Text style={[styles.heroButtonText, { color: t.heroButtonText }]}>{props.resume ? 'Resume' : 'Start puzzle'}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export function LevelLadder(props: { def: GameDef; stats: Stats; onPick: (d: Difficulty) => void; theme: Theme }) {
  const t = props.theme;
  return (
    <View style={[styles.ladder, { backgroundColor: t.surface, borderColor: t.border }]}>
      {DIFFICULTY_ORDER.map((d, idx) => {
        const s = props.stats[d];
        return (
          <Pressable
            key={d}
            onPress={() => props.onPick(d)}
            style={({ pressed }) => [
              styles.row,
              idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
              pressed && { backgroundColor: t.surfaceAlt },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`New ${DIFFICULTY_NAMES[d]} ${props.def.name} puzzle`}
          >
            <LevelPips level={idx} theme={t} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: t.text }]}>{DIFFICULTY_NAMES[d]}</Text>
              <Text style={[styles.rowBlurb, { color: t.textMuted }]}>{props.def.levels[d]}</Text>
            </View>
            <View style={styles.rowStats}>
              {s?.bestMs != null ? <Text style={[styles.best, { color: t.text }]}>{formatTime(s.bestMs)}</Text> : null}
              <Text style={[styles.rowCount, { color: t.textMuted }]}>{s?.completed ? `${s.completed} solved` : 'Not played'}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', borderRadius: 22, padding: 16, gap: 16 },
  heroBody: { flex: 1, minHeight: 112 },
  heroLabel: { fontSize: 13 },
  heroTitle: { fontFamily: FONTS.displayBold, fontSize: 28, lineHeight: 32, marginTop: 2, marginBottom: 2 },
  heroMeta: { fontSize: 13, lineHeight: 18 },
  track: { height: 5, borderRadius: 3, marginTop: 8, marginBottom: 4, overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 3 },
  heroButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 10, marginTop: 10 },
  heroButtonText: { fontSize: 15, fontWeight: '700' },
  ladder: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 15 },
  rowTitle: { fontFamily: FONTS.displayBold, fontSize: 19, lineHeight: 23 },
  rowBlurb: { fontSize: 13, lineHeight: 18, marginTop: 1 },
  rowStats: { alignItems: 'flex-end' },
  best: { fontFamily: FONTS.displaySemi, fontSize: 18, fontVariant: ['tabular-nums'] },
  rowCount: { fontSize: 12 },
});
