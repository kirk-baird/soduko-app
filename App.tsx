import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Dialog } from './src/components/Dialog';
import { DIFFICULTY_LABEL, Difficulty } from './src/engine/logic';
import { GameState, newGame } from './src/game/gameState';
import { nextPuzzle } from './src/game/puzzleSource';
import { GameScreen } from './src/screens/GameScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SettingsProvider, useSettings } from './src/settings';
import { EMPTY_STATS, Stats, loadStats } from './src/stats';
import { loadRaw, remove } from './src/storage';
import { useTheme } from './src/theme';

type Screen = 'home' | 'game' | 'settings';

function Root() {
  const t = useTheme();
  const { settings, loaded } = useSettings();
  const [screen, setScreen] = useState<Screen>('home');
  const [prevScreen, setPrevScreen] = useState<Screen>('home');
  const [game, setGame] = useState<GameState | null>(null);
  const [saved, setSaved] = useState<GameState | null>(null);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [generating, setGenerating] = useState<Difficulty | null>(null);
  const [confirmNew, setConfirmNew] = useState<Difficulty | null>(null);

  const refreshHome = useCallback(async () => {
    const [g, s] = await Promise.all([loadRaw<GameState>('game'), loadStats()]);
    setSaved(g && !g.completed ? g : null);
    setStats(s);
  }, []);

  useEffect(() => {
    refreshHome();
  }, [refreshHome]);

  const goHome = useCallback(() => {
    setScreen('home');
    setGame(null);
    // let GameScreen's unmount save land first
    setTimeout(refreshHome, 50);
  }, [refreshHome]);

  // Android hardware back button
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'game') {
        goHome();
        return true;
      }
      if (screen === 'settings') {
        setScreen(prevScreen);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen, prevScreen, goHome]);

  const startNew = async (d: Difficulty) => {
    setConfirmNew(null);
    setGenerating(d);
    setGame(null);
    setScreen('home');
    await remove('game');
    const p = await nextPuzzle(d);
    setGenerating(null);
    setGame(newGame(p.id, d, p.givens, p.solution, settings.autoCandidates));
    setScreen('game');
  };

  const requestNew = (d: Difficulty) => {
    if (saved) setConfirmNew(d);
    else startNew(d);
  };

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      {screen === 'game' && game ? (
        <GameScreen key={game.id} initial={game} onExit={goHome} onNewGame={startNew} />
      ) : screen === 'settings' ? (
        <SettingsScreen onBack={() => setScreen(prevScreen)} />
      ) : (
        <HomeScreen
          saved={saved}
          stats={stats}
          onContinue={() => {
            if (!saved) return;
            setGame(saved);
            setScreen('game');
          }}
          onNew={requestNew}
          onSettings={() => {
            setPrevScreen('home');
            setScreen('settings');
          }}
        />
      )}

      <Dialog
        visible={!!confirmNew}
        title="Start a new game?"
        theme={t}
        onRequestClose={() => setConfirmNew(null)}
        buttons={[
          { label: 'Cancel', onPress: () => setConfirmNew(null) },
          { label: 'Start new', onPress: () => confirmNew && startNew(confirmNew), primary: true },
        ]}
      >
        <Text style={{ color: t.textMuted, fontSize: 15, lineHeight: 21 }}>
          Your {saved ? DIFFICULTY_LABEL[saved.difficulty] : ''} game in progress will be lost.
        </Text>
      </Dialog>

      <Dialog visible={!!generating} title="Preparing puzzle" theme={t} buttons={[]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <ActivityIndicator color={t.accent} />
          <Text style={{ color: t.textMuted, fontSize: 15 }}>
            Finding a {generating ? DIFFICULTY_LABEL[generating] : ''} puzzle…
          </Text>
        </View>
      </Dialog>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <Root />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
