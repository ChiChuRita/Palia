import "dotenv/config";

import { fileURLToPath } from "node:url";
import { type JobContext, ServerOptions, cli, defineAgent, voice } from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import { RoomEvent, type RemoteParticipant } from "@livekit/rtc-node";

import { ttsInstructions } from "./prompts.js";
import { runCheckin, type CheckinUserData } from "./tasks.js";
import { SYMPTOM_CATEGORY_KEYS, type SymptomCategory } from "./taxonomy.js";
import {
  analyzeTranscript,
  appendTranscript,
  finalize,
  persistRecords,
  type HealthSnapshot,
} from "./tools.js";

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();

    const sessionId = ctx.room.name;
    if (!sessionId) {
      console.error("no room name on JobContext.room — bailing");
      return;
    }
    console.log(`[mecfs-agent] joined room ${sessionId}`);

    // Locale + health snapshot + symptom panel from the participant's token
    // metadata (mintToken in Convex). The old Bot Lab `variant` field is
    // accepted and ignored.
    const participant = await ctx.waitForParticipant();
    const userData: CheckinUserData = {
      sessionId,
      locale: "en",
      healthSnapshot: null,
      symptomPanel: [],
    };
    try {
      const parsed = JSON.parse(participant.metadata || "{}");
      if (parsed.locale === "de") userData.locale = "de";
      if (parsed.healthSnapshot && typeof parsed.healthSnapshot === "object") {
        userData.healthSnapshot = parsed.healthSnapshot as HealthSnapshot;
      }
      if (Array.isArray(parsed.symptomPanel)) {
        userData.symptomPanel = parsed.symptomPanel.filter(
          (c: unknown): c is SymptomCategory =>
            typeof c === "string" && (SYMPTOM_CATEGORY_KEYS as readonly string[]).includes(c)
        );
      }
      // Continuity fields — all optional, shaped server-side in mintToken.
      if (parsed.lastCheckin && typeof parsed.lastCheckin === "object")
        userData.lastCheckin = parsed.lastCheckin;
      if (parsed.lastCrash && typeof parsed.lastCrash === "object")
        userData.lastCrash = parsed.lastCrash;
      if (parsed.symptomWords && typeof parsed.symptomWords === "object")
        userData.symptomWords = parsed.symptomWords;
      if (["morning", "afternoon", "evening"].includes(parsed.daypart))
        userData.daypart = parsed.daypart;
      if (typeof parsed.name === "string" && parsed.name.trim())
        userData.name = parsed.name.trim().slice(0, 40);
      if (typeof parsed.careNote === "string" && parsed.careNote.trim())
        userData.careNote = parsed.careNote.trim().slice(0, 400);
    } catch {
      /* leave defaults */
    }
    const locale = userData.locale;
    console.log(
      `[mecfs-agent] locale=${locale} health=${userData.healthSnapshot ? "yes" : "none"} ` +
        `continuity=${userData.lastCheckin ? "yes" : "none"} daypart=${userData.daypart ?? "?"}`
    );

    // Plain-text transcript mirror for the summary model (the same lines are
    // POSTed to Convex by the listener below).
    const transcriptLines: string[] = [];

    const rootAgent = voice.Agent.create<CheckinUserData>({
      id: "checkin-root",
      // The root never generates speech itself — it says deterministic lines
      // and runs the box tasks, each with its own narrow prompt. The runner
      // lives in tasks.ts so the smoke test drives the identical flow.
      // The second sentence is a guardrail for the brief window after the last
      // box while extraction runs: without it, a patient turn there gets a
      // generic assistant-mode reply (markdown lists — caught by bench/traces).
      instructions:
        "You coordinate a daily voice check-in and never speak unprompted. If the user speaks anyway, reply with a few warm spoken words in their language — no questions, no lists, no advice, and natural idiomatic phrasing only (never translated-sounding lines like 'danke fürs Teilen').",
      tools: {},
      onEnter: (actx) =>
        runCheckin(actx, {
          // Zero user lines (e.g. the call dropped before the first answer):
          // nothing to save — the runner skips persist/finalize on null.
          analyze: () =>
            transcriptLines.some((l) => l.startsWith("user:"))
              ? analyzeTranscript(transcriptLines.join("\n"), locale)
              : Promise.resolve(null),
          persist: (a) => persistRecords(sessionId, a),
          finalize: (s) => finalize(sessionId, s),
          disconnect: () => void ctx.room.disconnect().catch(() => {}),
          onPatientLeft: (completeDropped) => {
            // Only THE patient we greeted — the agent's own disconnect (or a
            // stray observer leaving) must not end the check-in.
            ctx.room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
              if (p.identity === participant.identity) completeDropped();
            });
          },
        }),
    });

    const session = new voice.AgentSession<CheckinUserData>({
      // gpt-realtime-2 for the conversation itself — the natural turn-taking
      // and prosody the pipeline couldn't match. The old giant-prompt problem
      // is gone: each box task hands it a ~40-line prompt.
      llm: new openai.realtime.RealtimeModel({
        model: "gpt-realtime-2.1",
        // 2.1 added an opt-in reasoning knob (default: none). "low" buys
        // rule-following (re-asking, premature done-calls) for a small
        // pre-speech pause. Override per env to compare live:
        // REALTIME_EFFORT=minimal|low|medium|high|xhigh
        reasoning: { effort: (process.env.REALTIME_EFFORT as never) || "low" },
        voice: "marin",
        // Calm but not draggy — measured ~2.5s response gaps at default pace
        // felt sluggish. ponytail: single knob, dial back to 1.0 if it ever
        // reads as rushed.
        speed: 1.1,
        // Pin the transcription language to the session locale — otherwise
        // gpt-4o-transcribe auto-detects and occasionally mislabels German
        // audio as Japanese/other, corrupting the stored transcript.
        inputAudioTranscription: { model: "gpt-4o-transcribe", language: locale },
        // far_field: the app is a look-at-the-screen speakerphone experience,
        // not a phone-to-ear call — near_field degraded the input audio and
        // the model kept mishearing (live call: "Pythagoras," for German).
        inputAudioNoiseReduction: { type: "far_field" },
        // The realtime playground's tuning (user-verified live: snappier and
        // warmer than our semantic_vad eagerness "low", which read as the
        // agent being slow). The old 550ms chopping happened under
        // near_field + gpt-realtime-2; with far_field + 2.1 + 300ms prefix
        // padding, 500ms holds. Fallback if fragments return: semantic_vad
        // eagerness "low", interrupt_response false.
        turnDetection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
      }),
      // say() (deterministic opening / goodbyes / crisis line) needs a TTS
      // even alongside a realtime model — same marin voice.
      tts: new openai.TTS({
        model: "gpt-4o-mini-tts",
        // Same companion voice as the app's insight playback. Not in the
        // plugin's typed voice union yet, but accepted by the API.
        voice: "marin" as never,
        instructions: ttsInstructions(locale),
      }),
      userData,
    });

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      const item = ev.item;
      if (item.type !== "message") return;
      if (item.role !== "user" && item.role !== "assistant") return;

      const text = item.content
        .filter((c): c is string => typeof c === "string")
        .join(" ")
        .trim();
      if (!text) return;

      transcriptLines.push(`${item.role}: ${text}`);
      // Live trace in the worker log — makes bad calls analyzable in place.
      console.log(`[transcript] ${item.role === "user" ? "USER " : "AGENT"} | ${text}`);
      void appendTranscript(sessionId, item.role, text).catch((e) =>
        console.error("append transcript failed", e)
      );
    });

    session.on(voice.AgentSessionEventTypes.Error, (ev) => {
      console.error("[mecfs-agent] session error", ev);
    });

    await session.start({ agent: rootAgent, room: ctx.room });
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    // AGENT_NAME is set ONLY in LiveKit Cloud agent secrets. A named worker
    // is excluded from automatic dispatch — prod rooms request it explicitly
    // via the token's roomConfig (see convex/livekit.ts). Locally this is
    // unset, so the dev worker registers unnamed and keeps receiving
    // automatic dispatch for dev rooms.
    agentName: process.env.AGENT_NAME,
  })
);
