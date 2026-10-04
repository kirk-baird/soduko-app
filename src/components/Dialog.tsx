import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Theme } from '../theme';

export interface DialogButton {
  label: string;
  onPress: () => void;
  primary?: boolean;
}

export function Dialog(props: {
  visible: boolean;
  title: string;
  children?: React.ReactNode;
  buttons: DialogButton[];
  onRequestClose?: () => void;
  theme: Theme;
}) {
  const t = props.theme;
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onRequestClose}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: t.surface }]}>
          <Text style={[styles.title, { color: t.text }]}>{props.title}</Text>
          {props.children}
          <View style={styles.buttons}>
            {props.buttons.map((b) => (
              <Pressable
                key={b.label}
                onPress={b.onPress}
                style={[styles.btn, b.primary ? { backgroundColor: t.accent } : { backgroundColor: t.surfaceAlt }]}
              >
                <Text style={[styles.btnText, { color: b.primary ? t.accentText : t.text }]}>{b.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, borderRadius: 18, padding: 20, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  btn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  btnText: { fontSize: 15, fontWeight: '600' },
});
