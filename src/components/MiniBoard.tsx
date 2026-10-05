import React from 'react';
import { Text, View } from 'react-native';
import { Grid } from '../engine/grid';
import { Theme } from '../theme';

/** Non-interactive miniature of a board: givens dark on tinted cells, your digits in blue. */
export function MiniBoard({ givens, values, size, theme: t }: { givens: Grid; values: Grid; size: number; theme: Theme }) {
  const OUTER = 2;
  const THICK = 1.5;
  const THIN = 0.5;
  const cell = (size - OUTER * 2 - THICK * 2 - THIN * 6) / 9;
  const at = (k: number) => OUTER + k * cell + Math.floor(k / 3) * THICK + (k - Math.floor(k / 3)) * THIN;

  return (
    <View
      style={{ width: size, height: size, backgroundColor: t.lineThick, borderRadius: 6, overflow: 'hidden' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {[0, 1, 2].flatMap((br) =>
        [0, 1, 2].map((bc) => (
          <View
            key={`b${br}${bc}`}
            style={{
              position: 'absolute',
              left: at(bc * 3),
              top: at(br * 3),
              width: cell * 3 + THIN * 2,
              height: cell * 3 + THIN * 2,
              backgroundColor: t.lineThin,
            }}
          />
        )),
      )}
      {values.map((v, i) => {
        const r = Math.floor(i / 9);
        const c = i % 9;
        const given = !!givens[i];
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: at(c),
              top: at(r),
              width: cell,
              height: cell,
              backgroundColor: given ? t.cellGiven : t.cell,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {v ? (
              <Text
                style={{
                  fontSize: cell * 0.64,
                  lineHeight: cell * 0.9,
                  color: given ? t.digitGiven : t.digitUser,
                  fontWeight: given ? '700' : '500',
                  includeFontPadding: false,
                }}
              >
                {v}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
