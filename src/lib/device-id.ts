import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

const KEY = "mecfs:deviceId";

function randomId() {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY);
  if (existing) return existing;
  const fresh = randomId();
  await AsyncStorage.setItem(KEY, fresh);
  return fresh;
}

/**
 * React hook variant — returns `null` while loading, then the stable id.
 * Use the `'skip'` pattern with Convex useQuery when the id is null.
 */
export function useDeviceId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    getOrCreateDeviceId().then((d) => {
      if (mounted) setId(d);
    });
    return () => {
      mounted = false;
    };
  }, []);
  return id;
}
