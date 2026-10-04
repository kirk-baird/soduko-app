import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Theme } from '../theme';

export interface CellProps {
  index: number;
  size: number;
  x: number;
  y: number;
  value: number;
  given: boolean;
  showError: boolean;
  pencil: number; // candidate bitmask to draw
  bg: string;
  matchDigit: number; // candidate digit to highlight (identical-number highlight)
  keyMask: number; // hint: reason candidates (primary colour)
  keyAltMask: number; // hint: reason candidates (alternate colour)
  elimMask: number; // hint: candidates to remove
  placeDigit: number; // hint: digit to place
  theme: Theme;
  onPress: (index: number) => void;
}

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function CellView(p: CellProps) {
  const { size, theme: t } = p;
  const candSize = size / 3;
  const valueColor = p.given ? t.digitGiven : p.showError ? t.digitError : t.digitUser;

  return (
    <Pressable
      onPress={() => p.onPress(p.index)}
      style={[styles.cell, { left: p.x, top: p.y, width: size, height: size, backgroundColor: p.bg }]}
      accessibilityLabel={`Row ${Math.floor(p.index / 9) + 1} column ${(p.index % 9) + 1}${p.value ? `, ${p.value}` : ''}`}
    >
      {p.value ? (
        <Text
          style={[
            styles.value,
            { fontSize: size * 0.62, lineHeight: size * 0.9, color: valueColor, fontWeight: p.given ? '600' : '500' },
          ]}
        >
          {p.value}
        </Text>
      ) : p.placeDigit ? (
        <View style={[styles.place, { backgroundColor: t.hintPlace, width: size * 0.82, height: size * 0.82, borderRadius: size * 0.2 }]}>
          <Text style={[styles.value, { fontSize: size * 0.56, lineHeight: size * 0.8, color: t.text }]}>{p.placeDigit}</Text>
        </View>
      ) : p.pencil ? (
        <View style={styles.candGrid}>
          {DIGITS.map((d) => {
            const on = (p.pencil >> d) & 1;
            const b = 1 << d;
            const isElim = (p.elimMask & b) !== 0;
            const isKey = (p.keyMask & b) !== 0;
            const isAlt = (p.keyAltMask & b) !== 0;
            const isMatch = p.matchDigit === d && on;
            let bg: string | undefined;
            let color = t.pencil;
            if (isElim) {
              bg = t.hintElim;
              color = t.hintElimText;
            } else if (isKey) bg = t.hintKey;
            else if (isAlt) bg = t.hintKeyAlt;
            else if (isMatch) {
              bg = t.pencilMatchBg;
              color = t.pencilMatchText;
            }
            return (
              <View key={d} style={[styles.cand, { width: candSize, height: candSize }]}>
                {on ? (
                  <View
                    style={{
                      width: candSize * 0.86,
                      height: candSize * 0.86,
                      borderRadius: candSize * 0.43,
                      backgroundColor: bg,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: candSize * 0.68,
                        lineHeight: candSize * 0.82,
                        color,
                        fontWeight: bg ? '700' : '400',
                        textDecorationLine: isElim ? 'line-through' : 'none',
                        includeFontPadding: false,
                        textAlign: 'center',
                      }}
                    >
                      {d}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </Pressable>
  );
}

export const Cell = memo(CellView);

const styles = StyleSheet.create({
  cell: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  value: { textAlign: 'center', includeFontPadding: false, fontVariant: ['tabular-nums'] },
  place: { alignItems: 'center', justifyContent: 'center' },
  candGrid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%', height: '100%' },
  cand: { alignItems: 'center', justifyContent: 'center' },
});
