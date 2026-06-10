// Daily local notification that nudges the user to do their morning check-in.
//
// Local-only (no push server): we schedule a single repeating DAILY trigger via
// expo-notifications and re-assert it on every app launch so the localized copy
// and chosen time stay fresh. Prefs (enabled + HH:MM) live in AsyncStorage with
// a tiny pub/sub so Onboarding and Settings stay in sync, mirroring lib/i18n.ts.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { i18n } from "@/i18n";

const ENABLED_KEY = "mecfs:reminder:enabled";
const TIME_KEY = "mecfs:reminder:time"; // "HH:MM", 24h
const ANDROID_CHANNEL = "daily-check-in";

// Default nudge time — mid-morning, after waking + a first coffee, so overnight
// recovery metrics (sleep, HRV, resting HR) have synced from the watch.
export const DEFAULT_REMINDER_HOUR = 9;
export const DEFAULT_REMINDER_MINUTE = 0;

export type ReminderPrefs = { enabled: boolean; hour: number; minute: number };

type Listener = (p: ReminderPrefs) => void;
const listeners = new Set<Listener>();
let current: ReminderPrefs = {
  enabled: false,
  hour: DEFAULT_REMINDER_HOUR,
  minute: DEFAULT_REMINDER_MINUTE,
};

function emit() {
  for (const l of listeners) l(current);
}

function parseTime(s: string | null): { hour: number; minute: number } {
  if (s) {
    const [h, m] = s.split(":").map((n) => Number.parseInt(n, 10));
    if (Number.isFinite(h) && Number.isFinite(m)) {
      return { hour: ((h % 24) + 24) % 24, minute: ((m % 60) + 60) % 60 };
    }
  }
  return { hour: DEFAULT_REMINDER_HOUR, minute: DEFAULT_REMINDER_MINUTE };
}

/** "HH:MM" (24h, zero-padded). */
export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Shift a time by `deltaMin` minutes, wrapping around a 24h day. */
export function stepTime(
  hour: number,
  minute: number,
  deltaMin: number
): { hour: number; minute: number } {
  const total = (((hour * 60 + minute + deltaMin) % 1440) + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

async function persist(prefs: ReminderPrefs): Promise<void> {
  current = prefs;
  await Promise.all([
    AsyncStorage.setItem(ENABLED_KEY, prefs.enabled ? "1" : "0"),
    AsyncStorage.setItem(TIME_KEY, formatTime(prefs.hour, prefs.minute)),
  ]);
  emit();
}

async function rescheduleDaily(hour: number, minute: number): Promise<void> {
  // We only ever keep one scheduled notification, so clearing all is safe and
  // avoids leaking duplicates when the time changes.
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: i18n.t("reminder.notifTitle"),
      body: i18n.t("reminder.notifBody"),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: ANDROID_CHANNEL, // ignored on iOS
    },
  });
}

/**
 * Load stored prefs into memory, wire the OS notification presentation + Android
 * channel, and re-assert the schedule. Call once at startup AFTER initLocale()
 * so the notification copy and channel name use the right language.
 */
export async function initReminders(): Promise<void> {
  const [enabledRaw, timeRaw] = await Promise.all([
    AsyncStorage.getItem(ENABLED_KEY),
    AsyncStorage.getItem(TIME_KEY),
  ]);
  const { hour, minute } = parseTime(timeRaw);
  current = { enabled: enabledRaw === "1", hour, minute };
  emit();

  if (Platform.OS === "web") return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: i18n.t("reminder.channelName"),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  // Re-arm on launch so a reinstall / OS-cleared schedule recovers, and so the
  // localized copy follows a language change made since it was first set.
  if (current.enabled) {
    try {
      await rescheduleDaily(current.hour, current.minute);
    } catch {
      /* permission may have been revoked in OS settings; stay best-effort */
    }
  }
}

/** Triggers the OS permission prompt if needed. Returns whether it's granted. */
export async function requestReminderPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const req = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return req.granted;
}

/**
 * Ask for permission, schedule the daily reminder, and persist. If permission is
 * denied we still remember the chosen time (disabled) so re-enabling later is
 * one tap. Returns whether the reminder is now active.
 */
export async function enableReminder(hour: number, minute: number): Promise<boolean> {
  const granted = await requestReminderPermission();
  if (!granted) {
    await persist({ enabled: false, hour, minute });
    return false;
  }
  if (Platform.OS !== "web") await rescheduleDaily(hour, minute);
  await persist({ enabled: true, hour, minute });
  return true;
}

export async function disableReminder(): Promise<void> {
  if (Platform.OS !== "web") await Notifications.cancelAllScheduledNotificationsAsync();
  await persist({ ...current, enabled: false });
}

/** Change the time; reschedules only if the reminder is currently enabled. */
export async function setReminderTime(hour: number, minute: number): Promise<void> {
  if (current.enabled && Platform.OS !== "web") await rescheduleDaily(hour, minute);
  await persist({ ...current, hour, minute });
}

/** React hook: current reminder prefs, re-rendering on any change. */
export function useReminder(): ReminderPrefs {
  const [prefs, setPrefs] = useState<ReminderPrefs>(current);
  useEffect(() => {
    const l: Listener = (p) => setPrefs(p);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return prefs;
}
