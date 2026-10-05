import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ContinueCard, GameGlyph, SavedGame } from '../components/HomeParts';
import { FONTS } from '../fonts';
import { GAMES } from '../games/registry';
import { GAME_TYPES, GameType } from '../games/types';
import { useTheme } from '../theme';

export function HomeScreen(props: {
  saved: Partial<Record<GameType, SavedGame>>;
  onResume: (type: GameType) => void;
  onOpenType: (type: GameType) => void;
  onSettings: () => void;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const latest = Object.values(props.saved)
    .filter((g): g is SavedGame => !!g)
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0];
  const boardSize = Math.max(112, Math.min(170, (Math.min(width, 640) - 40) * 0.45));
  const tileW = (Math.min(width, 640) - 40 - 12) / 2;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.top}>
          <Text style={[styles.wordmark, { color: t.text }]}>Sudokou</Text>
          <Pressable onPress={props.onSettings} hitSlop={12} accessibilityLabel="Settings">
            <MaterialCommunityIcons name="cog-outline" size={26} color={t.textMuted} />
          </Pressable>
        </View>

        {latest ? (
          <ContinueCard
            game={latest}
            label="In progress"
            showType
            resume
            boardSize={boardSize}
            onPress={() => props.onResume(latest.type ?? 'classic')}
            theme={t}
          />
        ) : null}

        <Text style={[styles.heading, { color: t.text }]}>Choose a puzzle</Text>
        <View style={styles.tiles}>
          {GAME_TYPES.map((type) => {
            const def = GAMES[type];
            const inProgress = !!props.saved[type];
            return (
              <Pressable
                key={type}
                onPress={() => props.onOpenType(type)}
                style={({ pressed }) => [
                  styles.tile,
                  { width: tileW, backgroundColor: pressed ? t.surfaceAlt : t.surface, borderColor: t.border },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${def.name}${inProgress ? ', in progress' : ''}`}
              >
                <View style={[styles.glyphWell, { backgroundColor: t.cellPeer }]}>
                  <GameGlyph def={def} size={26} color={t.accent} theme={t} />
                </View>
                <Text style={[styles.tileTitle, { color: t.text }]}>{def.name}</Text>
                <Text style={[styles.tileShort, { color: t.textMuted }]} numberOfLines={2}>
                  {def.short}
                </Text>
                {inProgress ? (
                  <View style={styles.badge}>
                    <View style={[styles.badgeDot, { backgroundColor: t.accent }]} />
                    <Text style={[styles.badgeText, { color: t.accent }]}>In progress</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 28, gap: 14, maxWidth: 640, width: '100%', alignSelf: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  wordmark: { fontFamily: FONTS.displayHeavy, fontSize: 44, letterSpacing: -1.5, lineHeight: 50 },
  heading: { fontFamily: FONTS.displaySemi, fontSize: 20, marginTop: 10 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { borderRadius: 18, borderWidth: 1, padding: 14, minHeight: 128 },
  glyphWell: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  tileTitle: { fontFamily: FONTS.displayBold, fontSize: 18, lineHeight: 22 },
  tileShort: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 12, fontWeight: '600' },
});
