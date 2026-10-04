import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Theme } from '../theme';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export function ToolButton(props: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  badge?: string;
  theme: Theme;
}) {
  const t = props.theme;
  const color = props.disabled ? t.border : props.active ? t.accent : t.text;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [styles.tool, pressed && { opacity: 0.55 }]}
      accessibilityRole="button"
      accessibilityLabel={props.label}
    >
      <View>
        <MaterialCommunityIcons name={props.icon} size={26} color={color} />
        {props.badge ? (
          <View style={[styles.badge, { backgroundColor: props.active ? t.accent : t.textMuted }]}>
            <Text style={[styles.badgeText, { color: t.accentText }]}>{props.badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.toolLabel, { color: props.disabled ? t.border : t.textMuted }]}>{props.label}</Text>
    </Pressable>
  );
}

export function NumberPad(props: {
  counts: number[]; // placed count per digit (index 1..9)
  pencilMode: boolean;
  onDigit: (d: number) => void;
  onLongDigit: (d: number) => void;
  disabled?: boolean;
  theme: Theme;
}) {
  const t = props.theme;
  return (
    <View style={styles.pad}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => {
        const remaining = 9 - props.counts[d];
        const done = remaining <= 0;
        return (
          <Pressable
            key={d}
            disabled={props.disabled}
            onPress={() => props.onDigit(d)}
            onLongPress={() => props.onLongDigit(d)}
            delayLongPress={350}
            style={({ pressed }) => [
              styles.padKey,
              { backgroundColor: pressed ? t.surfaceAlt : t.surface, borderColor: t.border },
            ]}
            accessibilityLabel={`${props.pencilMode ? 'Pencil ' : ''}${d}`}
          >
            <Text
              style={[
                styles.padDigit,
                props.pencilMode && styles.padDigitPencil,
                { color: done ? t.border : props.pencilMode ? t.textMuted : t.accent },
              ]}
            >
              {d}
            </Text>
            <Text style={[styles.padCount, { color: t.textMuted }]}>{done ? ' ' : remaining}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tool: { alignItems: 'center', justifyContent: 'center', paddingVertical: 6, flex: 1 },
  toolLabel: { fontSize: 12, marginTop: 2 },
  badge: { position: 'absolute', right: -14, top: -4, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { fontSize: 9, fontWeight: '700' },
  pad: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  padKey: { flex: 1, alignItems: 'center', paddingTop: 6, paddingBottom: 4, borderRadius: 10, borderWidth: 1 },
  padDigit: { fontSize: 30, fontWeight: '500', lineHeight: 34, fontVariant: ['tabular-nums'] },
  padDigitPencil: { fontSize: 22, lineHeight: 34, fontWeight: '400' },
  padCount: { fontSize: 11, lineHeight: 13 },
});
