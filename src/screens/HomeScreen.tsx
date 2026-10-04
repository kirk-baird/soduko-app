import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DIFFICULTIES, DIFFICULTY_LABEL, Difficulty, techniquesForDifficulty } from '../engine/logic';
import { GameState } from '../game/gameState';
import { Stats, formatTime } from '../stats';
import { useTheme } from '../theme';

const BLURB: Record<Difficulty, string> = {
  medium: 'Singles plus locked candidates and pairs',
  hard: 'Triples, X-Wings and the first wings',
  extraHard: 'Fish, colouring and uniqueness',
  extreme: 'Chains required',
};

export function HomeScreen(props: {
  saved: GameState | null;
  stats: Stats;
  onContinue: () => void;
  onNew: (d: Difficulty) => void;
  onSettings: () => void;
}) {
  const t = useTheme();
  const { saved, stats } = props;
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.top}>
          <View>
            <Text style={[styles.title, { color: t.text }]}>Sudokou</Text>
            <Text style={[styles.subtitle, { color: t.textMuted }]}>No ads. No paywalls. Just logic.</Text>
          </View>
          <Pressable onPress={props.onSettings} hitSlop={12} accessibilityLabel="Settings">
            <MaterialCommunityIcons name="cog-outline" size={28} color={t.text} />
          </Pressable>
        </View>

        {saved ? (
          <Pressable
            onPress={props.onContinue}
            style={({ pressed }) => [styles.continue, { backgroundColor: t.accent, opacity: pressed ? 0.85 : 1 }]}
          >
            <MaterialCommunityIcons name="play" size={28} color={t.accentText} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.continueTitle, { color: t.accentText }]}>Continue</Text>
              <Text style={[styles.continueMeta, { color: t.accentText }]}>
                {DIFFICULTY_LABEL[saved.difficulty]} · {formatTime(saved.elapsedMs)} ·{' '}
                {saved.values.filter((v) => v).length}/81 filled
              </Text>
            </View>
          </Pressable>
        ) : null}

        <Text style={[styles.section, { color: t.textMuted }]}>NEW GAME</Text>
        {DIFFICULTIES.map((d) => {
          const s = stats[d];
          return (
            <Pressable
              key={d}
              onPress={() => props.onNew(d)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: pressed ? t.surfaceAlt : t.surface, borderColor: t.border },
              ]}
            >
              <View style={styles.cardTop}>
                <Text style={[styles.cardTitle, { color: t.text }]}>{DIFFICULTY_LABEL[d]}</Text>
                <Text style={[styles.cardStats, { color: t.textMuted }]}>
                  {s?.completed ? `${s.completed} solved · best ${formatTime(s.bestMs ?? 0)}` : 'Not played yet'}
                </Text>
              </View>
              <Text style={[styles.cardBlurb, { color: t.text }]}>{BLURB[d]}</Text>
              <Text style={[styles.cardTech, { color: t.textMuted }]}>{techniquesForDifficulty(d).join(' · ')}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 18, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, marginTop: 8 },
  title: { fontSize: 38, fontWeight: '800', letterSpacing: -1 },
  subtitle: { fontSize: 14, marginTop: 2 },
  continue: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 16 },
  continueTitle: { fontSize: 18, fontWeight: '700' },
  continueMeta: { fontSize: 13, opacity: 0.9, marginTop: 2 },
  section: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, marginTop: 8 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 4 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cardTitle: { fontSize: 19, fontWeight: '700' },
  cardStats: { fontSize: 12 },
  cardBlurb: { fontSize: 14 },
  cardTech: { fontSize: 12, lineHeight: 17 },
});
