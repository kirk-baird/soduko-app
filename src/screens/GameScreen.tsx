import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Board, HintMarks } from '../components/Board';
import { NumberPad, ToolButton } from '../components/Controls';
import { Dialog } from '../components/Dialog';
import { HintPanel } from '../components/HintPanel';
import { Hint, findHint } from '../engine/hint';
import { DIFFICULTY_LABEL, Difficulty, singlesFinish } from '../engine/logic';
import { GameState, firstMistakeIndex, gameReducer, removedCorrectCells, wrongCells } from '../game/gameState';
import { useSettings } from '../settings';
import { formatTime, recordCompletion } from '../stats';
import { remove, saveJSON } from '../storage';
import { useTheme } from '../theme';
import { SettingsScreen } from './SettingsScreen';

interface Props {
  initial: GameState;
  onExit: () => void;
  onNewGame: (d: Difficulty) => void;
}

/** Pausable stopwatch held in a ref so the board doesn't re-render every second. */
class Clock {
  acc: number;
  since: number | null = null;
  constructor(ms: number) {
    this.acc = ms;
  }
  start() {
    if (this.since == null) this.since = Date.now();
  }
  stop() {
    if (this.since != null) {
      this.acc += Date.now() - this.since;
      this.since = null;
    }
  }
  get ms() {
    return this.acc + (this.since != null ? Date.now() - this.since : 0);
  }
}

function TimerText({ clock, color }: { clock: Clock; color: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(id);
  }, []);
  return <Text style={[styles.timer, { color }]}>{formatTime(clock.ms)}</Text>;
}

export function GameScreen({ initial, onExit, onNewGame }: Props) {
  const t = useTheme();
  const { settings } = useSettings();
  const { width, height } = useWindowDimensions();
  const [game, dispatch] = useReducer(gameReducer, initial);
  const [selected, setSelected] = useState<number | null>(null);
  const [pencilMode, setPencilMode] = useState(false);
  const [hint, setHint] = useState<Hint | null>(null);
  const [paused, setPaused] = useState(false);
  const [appActive, setAppActive] = useState(true);
  const [autoFilling, setAutoFilling] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [result, setResult] = useState<{ ms: number; isBest: boolean } | null>(null);
  const clock = useRef(new Clock(initial.elapsedMs)).current;
  const gameRef = useRef(game);
  gameRef.current = game;

  const buzz = useCallback(
    (kind: 'tap' | 'error' | 'success') => {
      if (!settings.haptics || Platform.OS === 'web') return;
      try {
        if (kind === 'tap') Haptics.selectionAsync();
        else Haptics.notificationAsync(kind === 'error' ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success);
      } catch {
        // haptics unavailable
      }
    },
    [settings.haptics],
  );

  // ---- clock ----
  const running = !paused && !settingsOpen && appActive && !game.completed;
  useEffect(() => {
    if (running) clock.start();
    else clock.stop();
  }, [running, clock]);

  // ---- persistence ----
  const save = useCallback(() => {
    const g = gameRef.current;
    if (g.completed) return;
    saveJSON('game', { ...g, elapsedMs: clock.ms });
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

  // ---- auto candidate mode switched on mid-game ----
  useEffect(() => {
    if (settings.autoCandidates) dispatch({ type: 'fillCandidates' });
  }, [settings.autoCandidates]);

  // ---- completion ----
  const recorded = useRef(false);
  useEffect(() => {
    if (!game.completed || recorded.current) return;
    recorded.current = true;
    clock.stop();
    const ms = clock.ms;
    setSelected(null);
    setHint(null);
    buzz('success');
    remove('game');
    recordCompletion(game.difficulty, ms).then(({ isBest }) => setResult({ ms, isBest }));
  }, [game.completed, game.difficulty, clock, buzz]);

  // ---- derived ----
  const wrong = useMemo(() => wrongCells(game), [game]);
  const mistakeIdx = useMemo(() => firstMistakeIndex(game), [game]);
  const counts = useMemo(() => {
    const c = new Array(10).fill(0);
    game.values.forEach((v, i) => {
      if (v && v === game.solution[i]) c[v]++;
    });
    return c;
  }, [game.values, game.solution]);

  const finish = useMemo(() => {
    if (game.completed || wrong.length) return null;
    const f = singlesFinish(game.values);
    return f && f.length ? f : null;
  }, [game.values, game.completed, wrong.length]);

  const hintMarks: HintMarks | null = useMemo(() => {
    if (!hint) return null;
    switch (hint.kind) {
      case 'step':
        return { step: hint.step, effective: hint.cands };
      case 'wrongValue':
      case 'missingCandidate':
        return { cells: hint.cells };
      case 'reveal':
        return {
          step: {
            technique: 'nakedSingle',
            placements: [{ cell: hint.cell, digit: hint.digit }],
            eliminations: [],
            pattern: [hint.cell],
            keys: [],
            units: [],
            explanation: hint.message,
          },
        };
      default:
        return null;
    }
  }, [hint]);

  // ---- input handlers ----
  const busy = paused || autoFilling || game.completed;

  const onPressCell = useCallback(
    (i: number) => {
      if (paused || autoFilling) return;
      setHint(null);
      setSelected(i);
    },
    [paused, autoFilling],
  );

  const input = (d: number, asPencil: boolean) => {
    if (busy || selected == null) return;
    setHint(null);
    const g = gameRef.current;
    if (g.givens[selected]) return;
    if (asPencil && g.values[selected]) return;
    dispatch({ type: 'input', cell: selected, digit: d, pencil: asPencil });
    if (!asPencil && g.values[selected] !== d && d !== g.solution[selected] && settings.errorDetection) buzz('error');
    else buzz('tap');
  };

  const erase = () => {
    if (busy || selected == null) return;
    setHint(null);
    dispatch({ type: 'erase', cell: selected, autoCandidates: settings.autoCandidates });
    buzz('tap');
  };

  const undo = () => {
    if (busy) return;
    setHint(null);
    dispatch({ type: 'undo' });
    buzz('tap');
  };

  const rewind = () => {
    if (busy) return;
    setHint(null);
    dispatch({ type: 'rewind' });
    buzz('tap');
  };

  const showHint = () => {
    if (busy) return;
    const h = findHint(game.values, game.pencil, game.solution, removedCorrectCells(game));
    setHint(h);
    setSelected(null);
    if (h.kind !== 'solved') dispatch({ type: 'hintShown' });
  };

  const applyHint = () => {
    if (!hint) return;
    if (hint.kind === 'step') dispatch({ type: 'applyStep', step: hint.step });
    if (hint.kind === 'reveal') {
      dispatch({
        type: 'applyStep',
        step: {
          technique: 'nakedSingle',
          placements: [{ cell: hint.cell, digit: hint.digit }],
          eliminations: [],
          pattern: [],
          keys: [],
          units: [],
          explanation: '',
        },
      });
    }
    setHint(null);
    buzz('tap');
  };

  const autoFinish = () => {
    if (!finish || busy) return;
    setHint(null);
    setSelected(null);
    setAutoFilling(true);
    const queue = finish.slice();
    const id = setInterval(() => {
      const p = queue.shift();
      if (!p) {
        clearInterval(id);
        setAutoFilling(false);
        return;
      }
      dispatch({ type: 'autoPlace', placement: p });
    }, 60);
  };

  // ---- layout ----
  const boardWidth = Math.min(width - 16, height * 0.52, 560);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={onExit} hitSlop={12} accessibilityLabel="Back">
          <MaterialCommunityIcons name="chevron-left" size={30} color={t.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.level, { color: t.text }]}>{DIFFICULTY_LABEL[game.difficulty]}</Text>
          <Text style={[styles.meta, { color: t.textMuted }]}>
            {settings.errorDetection ? `Mistakes ${game.mistakes}` : ' '}
            {game.hintsUsed ? `${settings.errorDetection ? '  ·  ' : ''}Hints ${game.hintsUsed}` : ''}
          </Text>
        </View>
        <Pressable
          onPress={() => !game.completed && setPaused((p) => !p)}
          style={[styles.timerBox, { backgroundColor: t.surface, borderColor: t.border }]}
          accessibilityLabel={paused ? 'Resume' : 'Pause'}
        >
          <TimerText clock={clock} color={t.text} />
          <MaterialCommunityIcons name={paused ? 'play' : 'pause'} size={18} color={t.textMuted} />
        </Pressable>
        <Pressable onPress={() => setSettingsOpen(true)} hitSlop={10} accessibilityLabel="Settings" style={{ marginLeft: 4 }}>
          <MaterialCommunityIcons name="cog-outline" size={24} color={t.text} />
        </Pressable>
      </View>

      <View style={styles.boardWrap}>
        <Board
          width={boardWidth}
          givens={game.givens}
          values={game.values}
          pencil={game.pencil}
          solution={game.solution}
          selected={selected}
          errorDetection={settings.errorDetection}
          highlightCandidates={settings.highlightCandidates}
          hint={hintMarks}
          hidden={paused}
          theme={t}
          onPressCell={onPressCell}
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
            onRewind={rewind}
            onClose={() => setHint(null)}
            theme={t}
          />
        ) : finish && !autoFilling ? (
          <Pressable onPress={autoFinish} style={[styles.finish, { backgroundColor: t.accent }]} accessibilityRole="button">
            <MaterialCommunityIcons name="flash" size={20} color={t.accentText} />
            <Text style={[styles.finishText, { color: t.accentText }]}>Only singles left — Auto-finish</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.tools}>
        <ToolButton icon="undo-variant" label="Undo" onPress={undo} disabled={!game.history.length || busy} theme={t} />
        <ToolButton icon="backup-restore" label="Rewind" onPress={rewind} disabled={mistakeIdx < 0 || busy} theme={t} />
        <ToolButton icon="eraser" label="Erase" onPress={erase} disabled={busy} theme={t} />
        <ToolButton
          icon="pencil-outline"
          label="Pencil"
          onPress={() => setPencilMode((p) => !p)}
          active={pencilMode}
          badge={pencilMode ? 'ON' : 'OFF'}
          theme={t}
        />
        <ToolButton icon="lightbulb-on-outline" label="Hint" onPress={showHint} disabled={busy} theme={t} />
      </View>

      <View style={styles.padWrap}>
        <NumberPad
          counts={counts}
          pencilMode={pencilMode}
          onDigit={(d) => input(d, pencilMode)}
          onLongDigit={(d) => input(d, !pencilMode)}
          disabled={busy}
          theme={t}
        />
      </View>

      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <SettingsScreen onBack={() => setSettingsOpen(false)} />
      </Modal>

      <Dialog
        visible={!!result}
        title={result?.isBest ? 'New best time!' : 'Solved!'}
        theme={t}
        buttons={[
          { label: 'Home', onPress: onExit },
          { label: 'New game', onPress: () => onNewGame(game.difficulty), primary: true },
        ]}
        onRequestClose={onExit}
      >
        <View style={{ gap: 6 }}>
          <Row label="Difficulty" value={DIFFICULTY_LABEL[game.difficulty]} color={t.text} muted={t.textMuted} />
          <Row label="Time" value={formatTime(result?.ms ?? 0)} color={t.text} muted={t.textMuted} />
          <Row label="Mistakes" value={String(game.mistakes)} color={t.text} muted={t.textMuted} />
          <Row label="Hints" value={String(game.hintsUsed)} color={t.text} muted={t.textMuted} />
        </View>
      </Dialog>
    </SafeAreaView>
  );
}

function Row({ label, value, color, muted }: { label: string; value: string; color: string; muted: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: muted, fontSize: 15 }}>{label}</Text>
      <Text style={{ color, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, gap: 6 },
  level: { fontSize: 18, fontWeight: '700' },
  meta: { fontSize: 12, marginTop: 1 },
  timerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  timer: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  boardWrap: { alignItems: 'center', marginTop: 4 },
  pausedOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 8 },
  pausedText: { fontSize: 16, fontWeight: '600' },
  middle: { flex: 1, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 6, minHeight: 60 },
  finish: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 12,
  },
  finishText: { fontSize: 15, fontWeight: '700' },
  tools: { flexDirection: 'row', paddingHorizontal: 8 },
  padWrap: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 10 },
});
