import { useAction, useMutation } from "convex/react";
import { Room, RoomEvent, Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

const AudioSession =
  Platform.OS === "web"
    ? {
        stopAudioSession: async () => {},
        startAudioSession: async () => {},
        configureAudio: async () => {},
        setAppleAudioConfiguration: async () => {},
      }
    : require("@livekit/react-native").AudioSession;

import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { getLocale } from "@/i18n";
import { getOrCreateDeviceId } from "@/lib/device-id";
import { readHealthSnapshot } from "@/lib/health";

export type VoiceState =
  | "idle"
  | "connecting"
  | "preparing" // agent is in the room but hasn't started speaking yet
  | "listening"
  | "speaking"
  | "ending"
  | "error";

type Status = {
  state: VoiceState;
  error: string | null;
  sessionId: Id<"sessions"> | null;
};

const INITIAL: Status = { state: "idle", error: null, sessionId: null };

export function useVoiceSession() {
  const [status, setStatus] = useState<Status>(INITIAL);
  // 0..1 smoothed audio level of the agent's voice, used by the orb to
  // gently pulse during 'speaking'. We expose it via the returned object.
  const [agentLevel, setAgentLevel] = useState(0);
  const roomRef = useRef<Room | null>(null);
  const sessionIdRef = useRef<Id<"sessions"> | null>(null);
  // Track whether the agent has actually started talking. Until then, the UI
  // should stay in 'preparing' instead of falsely claiming to listen.
  const agentHasSpokenRef = useRef(false);
  // Mic is gated until the agent has finished its opening greeting. Otherwise
  // any sound on the user's mic (breath, the tap noise, room hum) fires VAD
  // BEFORE the agent has greeted, and the model politely waits, producing a
  // 10–15 sec dead-air delay at the start.
  const micEnabledRef = useRef(false);
  const micFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // 200ms polling timer for the agent's audioLevel (LiveKit doesn't emit an
  // event for it; we sample). Smoothing handled below.
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const smoothedLevelRef = useRef(0);

  const mintToken = useAction(api.livekit.mintToken);
  const markAbandoned = useMutation(api.sessions.markAbandoned);

  const cleanup = useCallback(() => {
    const room = roomRef.current;
    if (room) {
      room.removeAllListeners();
      room.disconnect().catch(() => {});
      roomRef.current = null;
    }
    if (micFallbackTimerRef.current) {
      clearTimeout(micFallbackTimerRef.current);
      micFallbackTimerRef.current = null;
    }
    if (levelTimerRef.current) {
      clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    micEnabledRef.current = false;
    smoothedLevelRef.current = 0;
    setAgentLevel(0);
    AudioSession.stopAudioSession().catch(() => {});
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const end = useCallback(async () => {
    setStatus((s) => ({ ...s, state: "ending" }));
    const sid = sessionIdRef.current;
    cleanup();
    if (sid) {
      try {
        await markAbandoned({ sessionId: sid });
      } catch {}
    }
    sessionIdRef.current = null;
    setStatus(INITIAL);
  }, [cleanup, markAbandoned]);

  const start = useCallback(async () => {
    agentHasSpokenRef.current = false;
    micEnabledRef.current = false;
    setStatus({ state: "connecting", error: null, sessionId: null });
    try {
      const deviceId = await getOrCreateDeviceId();
      // Read HealthKit snapshot before minting the token so it rides along
      // in the participant metadata. Non-blocking on failure — snapshot can
      // be all-null (no Apple Watch, denied permission, simulator, etc.).
      const healthSnapshot = await readHealthSnapshot().catch(() => null);
      const { token, url, sessionId } = await mintToken({
        deviceId,
        locale: getLocale(),
        healthSnapshot: healthSnapshot ?? undefined,
      });
      sessionIdRef.current = sessionId;

      // Critical: configure iOS audio for voice chat BEFORE connecting.
      // This enables AVAudioSession voiceChat mode → echo cancellation +
      // automatic gain control. Without this, the agent hears its own
      // voice via the speaker and interrupts itself mid-sentence.
      await AudioSession.configureAudio({
        ios: { defaultOutput: "speaker" },
      });
      await AudioSession.startAudioSession();
      await AudioSession.setAppleAudioConfiguration({
        audioCategory: "playAndRecord",
        audioCategoryOptions: ["allowBluetooth", "defaultToSpeaker"],
        audioMode: "voiceChat",
      });

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      // Agent participant joined and/or audio track subscribed:
      // agent is in the room but hasn't started talking yet. Show 'preparing'.
      room.on(RoomEvent.ParticipantConnected, () => {
        setStatus((s) =>
          s.state === "connecting" ? { ...s, state: "preparing" } : s,
        );
      });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        setStatus((s) =>
          s.state === "connecting" ? { ...s, state: "preparing" } : s,
        );
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const r = roomRef.current;
        const agentSpeaking = speakers.some(
          (p) => p.identity !== deviceId && p.isSpeaking,
        );
        if (agentSpeaking) agentHasSpokenRef.current = true;

        // Enable the mic only after the agent's first turn has ENDED (i.e.
        // agent has spoken at least once, and is now silent). This is the key
        // fix for the slow-start problem: with the mic off during the
        // greeting, the model doesn't get spurious user-speech events that
        // make it wait silently.
        if (
          agentHasSpokenRef.current &&
          !agentSpeaking &&
          !micEnabledRef.current &&
          r
        ) {
          micEnabledRef.current = true;
          r.localParticipant.setMicrophoneEnabled(true).catch(() => {});
          if (micFallbackTimerRef.current) {
            clearTimeout(micFallbackTimerRef.current);
            micFallbackTimerRef.current = null;
          }
        }

        setStatus((s) => {
          if (s.state === "ending" || s.state === "error") return s;
          if (!agentHasSpokenRef.current && !agentSpeaking) {
            return { ...s, state: "preparing" };
          }
          return { ...s, state: agentSpeaking ? "speaking" : "listening" };
        });
      });
      // The agent ends the conversation by calling end_session, which
      // finalizes the session and then disconnects ITSELF from the room
      // (agent/src/index.ts). That only removes the agent participant — our
      // side stays connected with the mic open. So when the agent leaves,
      // tear down our connection too; this triggers the Disconnected handler
      // below, which does the full cleanup and returns us to 'idle'.
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (participant.identity === deviceId) return; // only the agent
        roomRef.current?.disconnect().catch(() => {});
      });
      room.on(RoomEvent.Disconnected, () => {
        const sid = sessionIdRef.current;
        sessionIdRef.current = null;
        setStatus(INITIAL);
        // Network drop, force-quit, or any disconnect that didn't go through
        // end_session: tell Convex so the session doesn't sit "active" forever.
        // markAbandoned is a no-op if the session is already completed (agent
        // ended cleanly), so this is always safe to call on disconnect.
        if (sid) {
          markAbandoned({ sessionId: sid }).catch(() => {});
        }
        AudioSession.stopAudioSession().catch(() => {});
      });

      await room.connect(url, token);
      // NOTE: mic is intentionally NOT enabled here. It gets enabled in the
      // ActiveSpeakersChanged handler once the agent has finished its
      // greeting. See the explanation above.

      // Safety net: if the agent fails to speak within 10 sec (model error,
      // disconnect, etc.), unlock the mic so the user can at least try.
      micFallbackTimerRef.current = setTimeout(() => {
        const r = roomRef.current;
        if (r && !micEnabledRef.current) {
          micEnabledRef.current = true;
          r.localParticipant.setMicrophoneEnabled(true).catch(() => {});
        }
      }, 10_000);

      // Sample the agent's audio level periodically for the orb pulse.
      // LiveKit doesn't emit events for audioLevel, so we poll at 12 Hz and
      // apply a low-pass to avoid jittery animation.
      levelTimerRef.current = setInterval(() => {
        const r = roomRef.current;
        if (!r) return;
        let max = 0;
        r.remoteParticipants.forEach((p) => {
          if (p.identity === deviceId) return;
          if (p.audioLevel > max) max = p.audioLevel;
        });
        // Exponential moving average for smoothness (~150ms time constant).
        smoothedLevelRef.current = smoothedLevelRef.current * 0.7 + max * 0.3;
        setAgentLevel(smoothedLevelRef.current);
      }, 80);

      // Stay in 'preparing' until ActiveSpeakersChanged flips us to 'speaking'.
      setStatus({ state: "preparing", error: null, sessionId });
    } catch (err) {
      cleanup();
      sessionIdRef.current = null;
      setStatus({
        state: "error",
        error: err instanceof Error ? err.message : "failed to start",
        sessionId: null,
      });
    }
  }, [cleanup, mintToken]);

  return { ...status, start, end, agentLevel };
}
