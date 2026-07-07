import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocale } from "@/i18n";
import { isDemoMode } from "@/lib/demo-mode";
import { getOrCreateDeviceId } from "@/lib/device-id";
import { readHealthSnapshot } from "@/lib/health";
import { useAction, useConvex, useMutation } from "convex/react";
import { Room, RoomEvent, Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

const FALLBACK_AUDIO_SESSION = {
  stopAudioSession: async () => {},
  startAudioSession: async () => {},
  configureAudio: async () => {},
  setAppleAudioConfiguration: async () => {},
  selectAudioOutput: async () => {},
};

// Route the live call to the loudspeaker (speaker mode) or the receiver
// (earpiece — hold the phone to your ear, quiet). iOS routing is
// template-driven: WebRTC re-applies the configureAudio template every time its
// audio unit (re)starts, so the template MUST stay in sync or a route change
// silently reverts us. Speaker only needs an output-port override; earpiece
// additionally has to drop .defaultToSpeaker on the *live* session, otherwise
// clearing the override just falls back to the speaker.
async function applyAudioRoute(speakerOn: boolean) {
  await AudioSession.configureAudio({
    ios: { defaultOutput: speakerOn ? "speaker" : "earpiece" },
  }).catch(() => {});
  if (speakerOn) {
    await AudioSession.selectAudioOutput("force_speaker").catch(() => {});
  } else {
    await AudioSession.setAppleAudioConfiguration({
      audioCategory: "playAndRecord",
      audioCategoryOptions: ["allowAirPlay", "allowBluetooth", "allowBluetoothA2DP"],
      audioMode: "voiceChat",
    }).catch(() => {});
    await AudioSession.selectAudioOutput("default").catch(() => {});
  }
}

let AudioSession: any = FALLBACK_AUDIO_SESSION;

// start() awaits this so a tap right after a cold launch can't race the
// dynamic import and run the call on the no-op fallback (= no audio config).
let audioSessionReady: Promise<unknown> = Promise.resolve();

if (Platform.OS !== "web") {
  audioSessionReady = import("@livekit/react-native")
    .then((module) => {
      AudioSession = module.AudioSession;
    })
    .catch(() => {});
}

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
  // Loudspeaker (true) vs. earpiece/receiver (false). Defaults to speaker —
  // a check-in is meant to be hands-free — and persists across calls. The ref
  // lets start() read the current choice without re-creating the callback.
  const [speaker, setSpeakerState] = useState(true);
  const speakerRef = useRef(true);
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
  const micFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 200ms polling timer for the agent's audioLevel (LiveKit doesn't emit an
  // event for it; we sample). Smoothing handled below.
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const smoothedLevelRef = useRef(0);
  // Bumped by cleanup() to invalidate any in-flight start(). Without this,
  // tapping End while still 'connecting' lets the rest of start() race on:
  // room.connect() fights the disconnect (livekit-client's unhandled
  // "NegotiationError: PC manager is closed"), the leaked room stays
  // connected outside roomRef, and the final setStatus resurrects the UI
  // back to 'preparing' after end() already reset it to idle.
  const startGenRef = useRef(0);

  const mintToken = useAction(api.livekit.mintToken);
  const markAbandoned = useMutation(api.sessions.markAbandoned);
  const convex = useConvex();

  const cleanup = useCallback(() => {
    startGenRef.current++; // invalidate any in-flight start()
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

  const setSpeaker = useCallback((on: boolean) => {
    speakerRef.current = on;
    setSpeakerState(on);
    applyAudioRoute(on).catch(() => {});
  }, []);

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
    // This start()'s generation. cleanup() (End tap, unmount, error) bumps
    // the counter; checking it after every await lets us bail instead of
    // racing a torn-down call. See startGenRef above.
    const gen = ++startGenRef.current;
    const stale = () => startGenRef.current !== gen;
    try {
      await audioSessionReady;
      const deviceId = await getOrCreateDeviceId();
      // Read HealthKit snapshot before minting the token so it rides along
      // in the participant metadata. Non-blocking on failure — snapshot can
      // be all-null (no Apple Watch, denied permission, simulator, etc.).
      // In demo mode, brief the agent from the SEEDED snapshot in Convex
      // instead — the real read would contradict the seeded scenario. The
      // full biomarker set rides along (incl. server-computed baselines) so
      // the agent can gently name an off-baseline signal ("your HRV looked
      // quite low overnight") per the rules in its health briefing.
      const healthSnapshot = (await isDemoMode().catch(() => false))
        ? await convex
            .query(api.health.latestSnapshot, { deviceId })
            .then((snap) =>
              snap
                ? {
                    hrvMs: snap.hrvMs,
                    hrvBaselineMs: snap.hrvBaselineMs,
                    restingHrBpm: snap.restingHrBpm,
                    rhrBaseline7d: snap.rhrBaseline7d,
                    sleepHoursLastNight: snap.sleepHours,
                    stepsToday: null,
                    stepsYesterday: snap.steps,
                  }
                : null
            )
            .catch(() => null)
        : await readHealthSnapshot().catch(() => null);
      const { token, url, sessionId } = await mintToken({
        deviceId,
        locale: getLocale(),
        healthSnapshot: healthSnapshot ?? undefined,
        // Daypart-aware greeting ("Guten Abend" after 17:00) + optional name.
        localHour: new Date().getHours(),
        name: (await AsyncStorage.getItem("mecfs:userName").catch(() => null)) ?? undefined,
      });
      if (stale()) {
        // User ended the call while we were minting the token. The session
        // row exists but nothing ever connected — mark it abandoned now
        // instead of waiting for the orphan reaper cron.
        markAbandoned({ sessionId }).catch(() => {});
        return;
      }
      sessionIdRef.current = sessionId;

      // Critical: configure iOS audio BEFORE connecting. configureAudio
      // stores LiveKit's session template: playAndRecord + defaultToSpeaker
      // + videoChat mode (speaker-tuned echo cancellation + AGC — same
      // "chat" signal processing as voiceChat, but at media loudness).
      // WebRTC re-applies this template whenever its audio unit starts, so
      // it MUST be the only config we set: a competing one-shot
      // setAppleAudioConfiguration(voiceChat) here used to make the first
      // words play receiver-tuned (quiet) until WebRTC flipped the session
      // back to the template — the "low volume at the beginning" — and the
      // mid-flight reconfiguration intermittently threw OSStatus -50.
      await AudioSession.configureAudio({
        ios: { defaultOutput: speakerRef.current ? "speaker" : "earpiece" },
      });
      await AudioSession.startAudioSession();

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      // Agent participant joined and/or audio track subscribed:
      // agent is in the room but hasn't started talking yet. Show 'preparing'.
      room.on(RoomEvent.ParticipantConnected, () => {
        setStatus((s) => (s.state === "connecting" ? { ...s, state: "preparing" } : s));
      });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        setStatus((s) => (s.state === "connecting" ? { ...s, state: "preparing" } : s));
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const r = roomRef.current;
        const agentSpeaking = speakers.some((p) => p.identity !== deviceId && p.isSpeaking);
        if (agentSpeaking) agentHasSpokenRef.current = true;

        // Enable the mic only after the agent's first turn has ENDED (i.e.
        // agent has spoken at least once, and is now silent). This is the key
        // fix for the slow-start problem: with the mic off during the
        // greeting, the model doesn't get spurious user-speech events that
        // make it wait silently.
        if (agentHasSpokenRef.current && !agentSpeaking && !micEnabledRef.current && r) {
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
        // Full teardown — not just the audio session. Without this, the
        // 12 Hz level-poll interval, the mic fallback timer, and roomRef
        // all outlive the call after every normal (agent-ended) check-in.
        cleanup();
      });

      await room.connect(url, token);
      if (stale()) {
        // Ended while connecting: tear down the room this start() created
        // (cleanup() only knew about roomRef, which it already nulled).
        room.removeAllListeners();
        room.disconnect().catch(() => {});
        markAbandoned({ sessionId }).catch(() => {});
        return;
      }
      // Publish the mic immediately but MUTED. iOS only runs the voice-
      // processing unit (echo cancellation + AGC + final output gain) while
      // capture is live, so publishing late — after the greeting — meant:
      //  (a) the greeting played through a playback-only unit at lower
      //      gain, then jumped louder when the mic finally published
      //      ("starts quiet at the beginning"), and
      //  (b) the echo canceller had zero time to converge before the
      //      agent's next sentence, so its tail leaked into the fresh mic,
      //      VAD committed it as a user turn, and the model answered its
      //      own question ("That sounds rough").
      // Muted = capture warm, but pure silence upstream — the mic-gating
      // story (no VAD before the greeting ends) still holds. The unmute
      // happens in the ActiveSpeakersChanged handler above.
      await room.localParticipant.setMicrophoneEnabled(true).catch(() => {});
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});

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
      if (stale()) return; // user already ended; don't flash an error state
      cleanup();
      sessionIdRef.current = null;
      setStatus({
        state: "error",
        error: err instanceof Error ? err.message : "failed to start",
        sessionId: null,
      });
    }
  }, [cleanup, mintToken, markAbandoned, convex]);

  return { ...status, start, end, agentLevel, speaker, setSpeaker };
}
