import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'sudokou.';

export async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw == null ? fallback : { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export async function loadRaw<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw == null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export async function saveJSON(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage is best-effort
  }
}

export async function remove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

/**
 * One-time move of data saved before game types existed (single classic game,
 * stats and played list) to the per-type keys.
 */
export async function migrateLegacy(): Promise<void> {
  try {
    const keys = ['game', 'stats', 'played'];
    for (const k of keys) {
      const raw = await AsyncStorage.getItem(PREFIX + k);
      if (raw == null) continue;
      const target = PREFIX + k + '.classic';
      if ((await AsyncStorage.getItem(target)) == null) {
        let value = raw;
        if (k === 'game') {
          const g = JSON.parse(raw);
          value = JSON.stringify({ ...g, type: 'classic', payload: { variant: 'classic', givens: g.givens, solution: g.solution } });
        }
        await AsyncStorage.setItem(target, value);
      }
      await AsyncStorage.removeItem(PREFIX + k);
    }
  } catch {
    // best-effort
  }
}
