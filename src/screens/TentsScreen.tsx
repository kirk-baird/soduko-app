import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ToolButton } from '../components/Controls';
import { Clock, CompletionDialog, GameHeader, RulesSheet } from '../components/GameChrome';
import { HintPanel } from '../components/HintPanel';
import { TentsBoard, tentsBoardSize } from '../components/TentsBoard';
import { Difficulty, PuzzleHint } from '../engine/common';
import { TENT, findHint, finishable } from '../engine/tents';
import { TentsGameState, firstTentsMistake, tentsReducer, wrongMarks } from '../game/tentsState';
import { GAMES } from '../games/registry';
import { GameType } from '../games/types';
import { useSettings } from '../settings';
import { recordCompletion } from '../stats';
import { remove, saveJSON } from '../storage';
import { useTheme } from '../theme';
import { SettingsScreen } from './SettingsScreen';

const MIN_CELL = 28;
const ZOOM_CELL = 38;

export function TentsScreen({
  initial,
  onExit,
  onNewGame,
}: {
  initial: TentsGameState;
  onExit: () => void;
  onNewGame: (type: GameType, d: Difficulty) => void;
}) {
  const t = useTheme();
  const { settings } = useSettings();
  const { width, height } = useWindowDimensions();
  const def = GAMES.tents;
  const [game, dispatch] = useReducer(tentsReducer, initial);
  const [hint, setHint] = useState<PuzzleHint | null>(null);
  const [paused, setPaused] = useState(false);
  const [appActive, setAppActive] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);
  const [result, setResult] = useState<{ ms: number; isBest: boolean } | null>(null);
  const [clock] = useState(() => new Clock(initial.elapsedMs));
  const gameRef = useRef(game);
  useEffect(() => {
    gameRef.current = game;
  }, [game]);
  const p = game.payload;

  const buzz = useCallback(
    (kind: 'tap' | 'success') => {
      if (!settings.haptics || Platform.OS === 'web') return;
      try {
        if (kind === 'tap') Haptics.selectionAsync();
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
    saveJSON('game.tents', { ...g, elapsedMs: clock.ms, savedAt: Date.now() });
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
    remove('game.tents');
    recordCompletion('tents', game.difficulty, ms, game.hintsUsed).then(({ isBest }) => setResult({ ms, isBest }));
  }, [game.completed, game.difficulty, game.hintsUsed, clock, buzz]);

  const wrong = useMemo(() => wrongMarks(game), [game]);
  const mistakeIdx = useMemo(() => firstTentsMistake(game), [game]);
  const finish = useMemo(() => {
    if (game.completed || wrong.length) return null;
    // Offer it only near the end: easy rules alone solve many Medium puzzles from scratch.
    const total = p.solution.filter((x) => x === 1).length;
    const f = finishable(p, game.marks);
    return f && f.length && f.length <= Math.max(2, Math.ceil(total * 0.2)) ? f : null;
  }, [game.marks, game.completed, wrong.length, p]);

  const busy = paused || autoFilling || game.completed;

  const onPressCell = useCallback(
    (i: number) => {
      if (paused || autoFilling) return;
      setHint(null);
      dispatch({ type: 'cycle', cell: i });
      buzz('tap');
    },
    [paused, autoFilling, buzz],
  );

  const showHint = () => {
    if (busy) return;
    const h = findHint(p, game.marks);
    setHint(h);
    if (h.kind !== 'solved') dispatch({ type: 'hintShown' });
  };

  const applyHint = () => {
    if (!hint) return;
    if (hint.kind === 'step') dispatch({ type: 'apply', placements: hint.step.placements });
    if (hint.kind === 'reveal') dispatch({ type: 'apply', placements: [{ cell: hint.cell, digit: hint.digit }] });
    setHint(null);
  };

  const autoFinish = () => {
    if (!finish || busy) return;
    setHint(null);
    setAutoFilling(true);
    const queue = finish.slice();
    const id = setInterval(() => {
      const q = queue.shift();
      if (!q) {
        clearInterval(id);
        setAutoFilling(false);
        return;
      }
      dispatch({ type: 'apply', placements: [{ cell: q.cell, digit: TENT }] });
    }, 80);
  };

  const availW = Math.min(width - 16, 640);
  const availH = height * 0.58;
  const fitCell = Math.floor(Math.min((availW - 1) / (p.cols + 1) - 1, (availH - 1) / (p.rows + 1) - 1));
  const canZoom = fitCell < MIN_CELL;
  const cellSize = canZoom && zoomed ? ZOOM_CELL : fitCell;
  const px = tentsBoardSize(p, cellSize);

  const hintStep = hint?.kind === 'step' ? hint.step : null;
  const problemCells = hint?.kind === 'wrongValue' ? hint.cells : undefined;
  const revealStep =
    hint?.kind === 'reveal'
      ? {
          technique: 'reveal',
          name: 'Reveal',
          tier: 0,
          placements: [{ cell: hint.cell, digit: hint.digit }],
          eliminations: [],
          pattern: [hint.cell],
          keys: [],
          unitCells: [],
          explanation: hint.message,
        }
      : null;

  const board = (
    <TentsBoard
      puzzle={p}
      marks={game.marks}
      cellSize={cellSize}
      errorDetection={settings.errorDetection}
      hintStep={hintStep ?? revealStep}
      problemCells={problemCells}
      hidden={paused}
      theme={t}
      onPressCell={onPressCell}
    />
  );

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
        {canZoom && zoomed ? (
          <ScrollView style={{ maxHeight: height * 0.62, width: availW }} nestedScrollEnabled>
            <ScrollView horizontal nestedScrollEnabled contentContainerStyle={{ width: px.width }}>
              {board}
            </ScrollView>
          </ScrollView>
        ) : (
          board
        )}
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
            theme={t}
          />
        ) : finish && !autoFilling ? (
          <Pressable onPress={autoFinish} style={[styles.finish, { backgroundColor: t.accent }]} accessibilityRole="button">
            <MaterialCommunityIcons name="flash" size={20} color={t.accentText} />
            <Text style={[styles.finishText, { color: t.accentText }]}>Only easy steps left — Auto-finish</Text>
          </Pressable>
        ) : (
          <Text style={[styles.help, { color: t.textMuted }]}>Tap a cell: tent, then grass, then empty.</Text>
        )}
      </View>

      <View style={styles.tools}>
        <ToolButton
          icon="undo-variant"
          label="Undo"
          onPress={() => {
            setHint(null);
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
            dispatch({ type: 'rewind' });
          }}
          disabled={mistakeIdx < 0 || busy}
          theme={t}
        />
        {canZoom ? (
          <ToolButton
            icon={zoomed ? 'magnify-minus-outline' : 'magnify-plus-outline'}
            label={zoomed ? 'Fit' : 'Zoom'}
            onPress={() => setZoomed((z) => !z)}
            theme={t}
          />
        ) : null}
        <ToolButton icon="lightbulb-on-outline" label="Hint" onPress={showHint} disabled={busy} theme={t} />
      </View>

      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <SettingsScreen onBack={() => setSettingsOpen(false)} />
      </Modal>
      <RulesSheet visible={helpOpen} def={def} onClose={() => setHelpOpen(false)} theme={t} />

      <CompletionDialog
        visible={!!result}
        isBest={!!result?.isBest}
        difficulty={game.difficulty}
        ms={result?.ms ?? 0}
        mistakes={game.mistakes}
        hintsUsed={game.hintsUsed}
        onHome={onExit}
        onNewGame={() => onNewGame('tents', game.difficulty)}
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
