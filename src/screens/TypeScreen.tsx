import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RulesList } from '../components/GameChrome';
import { ContinueCard, GameGlyph, LevelLadder, SavedGame } from '../components/HomeParts';
import { Difficulty } from '../engine/common';
import { FONTS } from '../fonts';
import { GAMES } from '../games/registry';
import { GameType } from '../games/types';
import { Stats } from '../stats';
import { useTheme } from '../theme';

export function TypeScreen(props: {
  type: GameType;
  saved: SavedGame | null;
  stats: Stats;
  onBack: () => void;
  onResume: () => void;
  onNew: (d: Difficulty) => void;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const def = GAMES[props.type];
  const played = Object.values(props.stats).some((s) => s?.completed);
  const [rulesOpen, setRulesOpen] = useState(!played);
  const boardSize = Math.max(112, Math.min(170, (Math.min(width, 640) - 40) * 0.45));

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]}>
      <View style={styles.nav}>
        <Pressable onPress={props.onBack} hitSlop={12} accessibilityLabel="Back">
          <MaterialCommunityIcons name="chevron-left" size={30} color={t.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <View style={[styles.glyphWell, { backgroundColor: t.cellPeer }]}>
            <GameGlyph def={def} size={30} color={t.accent} theme={t} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: t.text }]}>{def.name}</Text>
            <Text style={[styles.short, { color: t.textMuted }]}>{def.short}</Text>
          </View>
        </View>

        {props.saved ? (
          <ContinueCard game={props.saved} label="In progress" showType={false} resume boardSize={boardSize} onPress={props.onResume} theme={t} />
        ) : null}

        <Text style={[styles.heading, { color: t.text }]}>Choose a level</Text>
        <LevelLadder def={def} stats={props.stats} onPick={props.onNew} theme={t} />
        <Text style={[styles.footnote, { color: t.textMuted }]}>Best times count puzzles solved without hints.</Text>

        <Pressable
          onPress={() => setRulesOpen((o) => !o)}
          style={styles.rulesHead}
          accessibilityRole="button"
          accessibilityState={{ expanded: rulesOpen }}
        >
          <Text style={[styles.heading, { color: t.text, marginTop: 0 }]}>How to play</Text>
          <MaterialCommunityIcons name={rulesOpen ? 'chevron-up' : 'chevron-down'} size={26} color={t.textMuted} />
        </Pressable>
        {rulesOpen ? (
          <View style={[styles.rulesCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            <RulesList def={def} theme={t} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  nav: { paddingHorizontal: 8, paddingTop: 6 },
  content: { paddingHorizontal: 20, paddingBottom: 28, gap: 14, maxWidth: 640, width: '100%', alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 4 },
  glyphWell: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: FONTS.displayHeavy, fontSize: 36, letterSpacing: -1, lineHeight: 42 },
  short: { fontSize: 14, marginTop: 1 },
  heading: { fontFamily: FONTS.displaySemi, fontSize: 20, marginTop: 10 },
  footnote: { fontSize: 12, textAlign: 'center', marginTop: -4 },
  rulesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  rulesCard: { borderRadius: 18, borderWidth: 1, padding: 16 },
});
