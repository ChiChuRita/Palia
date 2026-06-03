import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { I18n } from "i18n-js";
import { useEffect, useState } from "react";

import { de } from "./de";
import { en } from "./en";

export type Locale = "en" | "de";

const LOCALE_KEY = "mecfs:locale";

export const i18n = new I18n(
  { en, de },
  {
    enableFallback: true,
    defaultLocale: "en",
    locale: "en",
  }
);

let currentLocale: Locale = "en";
const listeners = new Set<(l: Locale) => void>();

function detectInitial(): Locale {
  const phone = getLocales()[0]?.languageCode?.toLowerCase();
  return phone === "de" ? "de" : "en";
}

function applyLocale(locale: Locale) {
  i18n.locale = locale;
  currentLocale = locale;
  for (const cb of listeners) cb(locale);
}

export async function initLocale(): Promise<Locale> {
  const stored = (await AsyncStorage.getItem(LOCALE_KEY)) as Locale | null;
  const initial: Locale = stored ?? detectInitial();
  applyLocale(initial);
  return initial;
}

export async function setLocale(locale: Locale): Promise<void> {
  await AsyncStorage.setItem(LOCALE_KEY, locale);
  applyLocale(locale);
}

export function getLocale(): Locale {
  return currentLocale;
}

/**
 * React hook that returns a translator function and the current locale.
 * Re-renders when the locale changes.
 */
export function useTranslation() {
  const [locale, setLocaleState] = useState<Locale>(currentLocale);

  useEffect(() => {
    const cb = (l: Locale) => setLocaleState(l);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);

  return {
    locale,
    t: (key: string, options?: Record<string, unknown>) => i18n.t(key, options),
    setLocale,
  };
}
