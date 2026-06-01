import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const KEY = 'mecfs:onboarded';

// Tiny pub/sub so other parts of the app (Settings → reset onboarding) can
// notify the gating hook in _layout.tsx to re-read AsyncStorage and re-render.
type Listener = (v: boolean) => void;
const listeners = new Set<Listener>();
function notify(v: boolean) {
  listeners.forEach((l) => l(v));
}

export async function hasOnboarded(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY)) === '1';
}

export async function markOnboarded(): Promise<void> {
  await AsyncStorage.setItem(KEY, '1');
  notify(true);
}

export async function resetOnboarded(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
  notify(false);
}

/**
 * Hook for the layout to gate the app behind onboarding on first launch.
 * Subscribes to changes so resetting from Settings flips the layout back to
 * the onboarding flow without an app restart.
 */
export function useOnboardingState() {
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboardedState] = useState(false);

  useEffect(() => {
    let mounted = true;
    hasOnboarded().then((v) => {
      if (!mounted) return;
      setOnboardedState(v);
      setReady(true);
    });
    const listener: Listener = (v) => setOnboardedState(v);
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  const setOnboarded = (v: boolean) => {
    if (v) {
      markOnboarded().catch(() => {});
    } else {
      resetOnboarded().catch(() => {});
    }
    // markOnboarded / resetOnboarded fire `notify` after the storage write,
    // which calls our listener and updates state. No optimistic set here so
    // the in-memory state stays in sync with storage.
  };

  return { ready, onboarded, setOnboarded };
}
