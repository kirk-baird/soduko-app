import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ToolButton } from '../components/Controls';
import { Clock, CompletionDialog, GameHeader, RulesSheet, SafeModal } from '../components/GameChrome';
import { HintPanel } from '../components/HintPanel';
import { DominoTray, PipsBoard, pipsBoardSize } from '../components/PipsBoard';
import { Difficulty, PuzzleHint } from '../engine/common';
import { findHint, finishable, hintMove } from '../engine/pips';
import { PipsGameState, dropSpot, firstPipsMistake, occupancy, pipsReducer, turnSpot, wrongPlaced } from '../game/pipsState';
import { GAMES } from '../games/registry';
import { GameType } from '../games/types';
import { useSettings } from '../settings';
import { recordCompletion } from '../stats';
import { remove, saveJSON } from '../storage';
import { useTheme } from '../theme';
import { SettingsScreen } from './SettingsScreen';

const MAX_CELL = 64;

export function PipsScreen({
  initial,
  onExit,
  onNewGame,
}: {
  initial: PipsGameState;
  onExit: () => void;
  onNewGame: (type: GameType, d: Difficulty) => void;
}) {
  const t = useTheme();
  const { settings } = useSettings();
  const { width, height } = useWindowDimensions();
  const def = GAMES.pips;
  const [game, dispatch] = useReducer(pipsReducer, initial);
  const [held, setHeld] = useState<number | null>(null); // tray domino picked up
  const [turned, setTurned] = useState<number | null>(null); // board domino last touched
  const [hint, setHint] = useState<PuzzleHint | null>(null);
  const [paused, setPaused] = useState(false);
  const [appActive, setAppActive] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);
  const [result, setResult] = useState<{ ms: number; isBest: boolean } | null>(null);
  const [clock] = useState(() => new Clock(initial.elapsedMs));
  const gameRef = useRef(game);
  useEffect(() => {
    gameRef.current = game;
  }, [game]);
  const p = game.payload;

  const buzz = useCallback(
    (kind: 'tap' | 'success' | 'error') => {
      if (!settings.haptics || Platform.OS === 'web') return;
      try {
        if (kind === 'tap') Haptics.selectionAsync();
        else if (kind === 'error') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // haptics unavailable
      }
    },
    [settings.haptics],
  );

  const running = !paused && !settingsOpen && !helpOpen && appActive && !game.completed;
  useEffect(() => {
    if (running) clock.start();
    else clock.stop();
  }, [running, clock]);

  const save = useCallback(() => {
    const g = gameRef.current;
    if (g.completed) return;
    saveJSON('game.pips', { ...g, elapsedMs: clock.ms, savedAt: Date.now() });
  }, [clock]);

  useEffect(() => {
    const id = setTimeout(save, 400);
    return () => clearTimeout(id);
  }, [game, save]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      setAppActive(st === 'active');
      if (st !== 'active') save();
    });
    return () => {
      sub.remove();
      save();
    };
  }, [save]);

  const recorded = useRef(false);
  useEffect(() => {
    if (!game.completed || recorded.current) return;
    recorded.current = true;
    clock.stop();
    const ms = clock.ms;
    buzz('success');
    remove('game.pips');
    recordCompletion('pips', game.difficulty, ms, game.hintsUsed).then(({ isBest }) => setResult({ ms, isBest }));
  }, [game.completed, game.difficulty, game.hintsUsed, clock, buzz]);

  // A wrong domino buzzes when error detection is on.
  const lastMistakes = useRef(game.mistakes);
  useEffect(() => {
    if (game.mistakes > lastMistakes.current && settings.errorDetection) buzz('error');
    lastMistakes.current = game.mistakes;
  }, [game.mistakes, settings.errorDetection, buzz]);

  const wrong = useMemo(() => wrongPlaced(game), [game]);
  const mistakeIdx = useMemo(() => firstPipsMistake(game), [game]);
  const finish = useMemo(() => {
    if (game.completed || wrong.length) return null;
    // Offer it only near the end: the basic rules alone solve many Medium puzzles from scratch.
    const left = game.place.filter((x) => !x).length;
    if (!left || left > Math.max(2, Math.ceil(p.dominoes.length * 0.25))) return null;
    const f = finishable(p, game.place);
    return f && f.length ? f : null;
  }, [game.place, game.completed, wrong.length, p]);

  const busy = paused || autoFilling || game.completed;

  const onPressCell = useCallback(
    (cell: number) => {
      if (busy) return;
      setHint(null);
      const g = gameRef.current;
      if (held !== null) {
        const spot = dropSpot(g, held, cell);
        if (!spot) return;
        dispatch({ type: 'put', k: held, spot });
        setTurned(held);
        setHeld(null);
        buzz('tap');
        return;
      }
      const k = occupancy(g.place).get(cell);
      if (k === undefined) return;
      const spot = turnSpot(g, k);
      if (spot) dispatch({ type: 'put', k, spot });
      setTurned(k);
      buzz('tap');
    },
    [busy, held, buzz],
  );

  const onLongPressCell = useCallback(
    (cell: number) => {
      if (busy) return;
      const k = occupancy(gameRef.current.place).get(cell);
      if (k === undefined) return;
      setHint(null);
      dispatch({ type: 'put', k, spot: null });
      setTurned(null);
      buzz('tap');
    },
    [busy, buzz],
  );

  const onPressTray = (k: number) => {
    if (busy) return;
    setHint(null);
    setTurned(null);
    setHeld((h) => (h === k ? null : k));
    buzz('tap');
  };

  const showHint = () => {
    if (busy) return;
    setHeld(null);
    const h = findHint(p, game.place);
    setHint(h);
    if (h.kind !== 'solved') dispatch({ type: 'hintShown' });
  };

  const applyHint = () => {
    if (hint?.kind === 'step') {
      const mv = hintMove(p, hint.step);
      if (mv) {
        dispatch({ type: 'put', k: mv.k, spot: mv.spot });
        setTurned(mv.k);
      }
    }
    setHint(null);
  };

  const autoFinish = () => {
    if (!finish || busy) return;
    setHint(null);
    setHeld(null);
    setAutoFilling(true);
    const queue = finish.slice();
    const id = setInterval(() => {
      const q = queue.shift();
      if (!q) {
        clearInterval(id);
        setAutoFilling(false);
        return;
      }
      dispatch({ type: 'put', k: q.k, spot: q.spot });
    }, 120);
  };

  // Board: as big as fits in the width and about half the height.
  const availW = Math.min(width - 24, 560);
  const availH = height * 0.46;
  let cellSize = Math.min(MAX_CELL, Math.floor(Math.min(availW / (p.cols + 0.35), availH / (p.rows + 0.35))));
  while (cellSize > 20 && pipsBoardSize(p, cellSize).width > availW) cellSize--;
  // Tray: two or three rows of dominoes across the width.
  const perRow = Math.ceil(p.dominoes.length / (p.dominoes.length > 9 ? 3 : 2));
  const trayHalf = Math.max(18, Math.min(30, Math.floor((availW - 8) / (perRow * 2.4))));

  const problemCells = hint?.kind === 'wrongValue' ? hint.cells : undefined;
  const hintStep = hint?.kind === 'step' ? hint.step : null;
  const holding = held !== null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top', 'bottom', 'left', 'right']}>
      <GameHeader
        def={def}
        difficulty={game.difficulty}
        mistakes={settings.errorDetection ? game.mistakes : null}
        hintsUsed={game.hintsUsed}
        clock={clock}
        paused={paused}
        onBack={onExit}
        onTogglePause={() => !game.completed && setPaused((x) => !x)}
        onHelp={() => setHelpOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        theme={t}
      />

      <View style={styles.boardWrap}>
        <PipsBoard
          puzzle={p}
          place={game.place}
          cellSize={cellSize}
          errorDetection={settings.errorDetection}
          selected={holding ? null : turned}
          hintStep={hintStep}
          problemCells={problemCells}
          hidden={paused}
          theme={t}
          onPressCell={onPressCell}
          onLongPressCell={onLongPressCell}
        />
        {paused ? (
          <Pressable style={styles.pausedOverlay} onPress={() => setPaused(false)}>
            <MaterialCommunityIcons name="play-circle-outline" size={64} color={t.accent} />
            <Text style={[styles.pausedText, { color: t.text }]}>Paused — tap to resume</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.middle}>
        {hint ? (
          <HintPanel
            hint={hint}
            canRewind={mistakeIdx >= 0}
            onApply={applyHint}
            onRewind={() => {
              setHint(null);
              dispatch({ type: 'rewind' });
            }}
            onClose={() => setHint(null)}
            bodyMaxHeight={Math.max(130, height * 0.26)}
            theme={t}
          />
        ) : (
          <View style={{ gap: 10 }}>
            {finish && !autoFilling ? (
              <Pressable onPress={autoFinish} style={[styles.finish, { backgroundColor: t.accent }]} accessibilityRole="button">
                <MaterialCommunityIcons name="flash" size={20} color={t.accentText} />
                <Text style={[styles.finishText, { color: t.accentText }]}>Only easy steps left — Auto-finish</Text>
              </Pressable>
            ) : null}
            {!paused ? <DominoTray puzzle={p} place={game.place} selected={held} half={trayHalf} disabled={busy} theme={t} onPress={onPressTray} /> : null}
            <Text style={[styles.help, { color: t.textMuted }]}>
              {holding ? 'Now tap the cell for its first half.' : 'Tap a domino, then a cell. Tap a placed domino to turn it; hold to take it back.'}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.tools}>
        <ToolButton
          icon="undo-variant"
          label="Undo"
          onPress={() => {
            setHint(null);
            setHeld(null);
            dispatch({ type: 'undo' });
          }}
          disabled={!game.history.length || busy}
          theme={t}
        />
        <ToolButton
          icon="backup-restore"
          label="Rewind"
          onPress={() => {
            setHint(null);
            setHeld(null);
            dispatch({ type: 'rewind' });
          }}
          disabled={mistakeIdx < 0 || busy}
          theme={t}
        />
        <ToolButton icon="lightbulb-on-outline" label="Hint" onPress={showHint} disabled={busy} theme={t} />
      </View>

      <SafeModal visible={settingsOpen} onRequestClose={() => setSettingsOpen(false)}>
        <SettingsScreen onBack={() => setSettingsOpen(false)} />
      </SafeModal>
      <RulesSheet visible={helpOpen} def={def} onClose={() => setHelpOpen(false)} theme={t} />

      <CompletionDialog
        visible={!!result}
        isBest={!!result?.isBest}
        difficulty={game.difficulty}
        ms={result?.ms ?? 0}
        mistakes={game.mistakes}
        hintsUsed={game.hintsUsed}
        onHome={onExit}
        onNewGame={() => onNewGame('pips', game.difficulty)}
        theme={t}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  boardWrap: { alignItems: 'center', marginTop: 8 },
  pausedOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 8 },
  pausedText: { fontSize: 16, fontWeight: '600' },
  middle: { flex: 1, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 6, minHeight: 60 },
  finish: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 12 },
  finishText: { fontSize: 15, fontWeight: '700' },
  help: { textAlign: 'center', fontSize: 13 },
  tools: { flexDirection: 'row', paddingHorizontal: 8, paddingBottom: 12 },
});
