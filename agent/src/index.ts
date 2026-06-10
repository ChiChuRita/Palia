import "dotenv/config";

import { fileURLToPath } from "node:url";
import { type JobContext, ServerOptions, cli, defineAgent, llm, voice } from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import { z } from "zod";

import { composeInstructions, kickInstructionForLocale } from "./interviewer.js";
import { getVariant, styleForLocale } from "./variants.js";
import {
  ACTIVITY_CATEGORY_KEYS,
  SYMPTOM_CATEGORY_KEYS,
  type ActivityCategory,
  type SymptomCategory,
} from "./taxonomy.js";
import {
  appendTranscript,
  correctLastActivity,
  correctLastSymptom,
  finalize,
  recordActivity,
  recordSessionContext,
  recordSymptom,
  summarizeHealthForPrompt,
  summarizeSymptomPanelForPrompt,
  type HealthSnapshot,
} from "./tools.js";

// z.enum needs a tuple type with at least one element. Cast through unknown.
const symptomCategoryEnum = z.enum(
  SYMPTOM_CATEGORY_KEYS as unknown as [SymptomCategory, ...SymptomCategory[]]
);
const activityCategoryEnum = z.enum(
  ACTIVITY_CATEGORY_KEYS as unknown as [ActivityCategory, ...ActivityCategory[]]
);

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();

    const sessionId = ctx.room.name;
    if (!sessionId) {
      console.error("no room name on JobContext.room — bailing");
      return;
    }
    console.log(`[mecfs-agent] joined room ${sessionId}`);

    // Read locale + health snapshot from the participant's token metadata.
    // mintToken() in Convex sets this to JSON like
    // {"locale": "de", "healthSnapshot": {...} | null}.
    const participant = await ctx.waitForParticipant();
    let locale: string = "en";
    let healthSnapshot: HealthSnapshot | null = null;
    let variantId: string | null = null;
    let symptomPanel: string[] = [];
    try {
      const meta = participant.metadata;
      if (meta) {
        const parsed = JSON.parse(meta);
        if (typeof parsed.locale === "string") locale = parsed.locale;
        if (typeof parsed.variant === "string") variantId = parsed.variant;
        if (parsed.healthSnapshot && typeof parsed.healthSnapshot === "object") {
          healthSnapshot = parsed.healthSnapshot as HealthSnapshot;
        }
        if (Array.isArray(parsed.symptomPanel)) {
          // The user's recurring symptoms (server-derived, last 14 days) the
          // agent asks by name every day. Validate against the taxonomy.
          symptomPanel = parsed.symptomPanel.filter(
            (c: unknown): c is SymptomCategory =>
              typeof c === "string" && (SYMPTOM_CATEGORY_KEYS as readonly string[]).includes(c)
          );
        }
      }
    } catch {
      /* leave defaults */
    }
    // Bot Lab: which of the 5 voice/pacing/tone variants to run this session.
    const variant = getVariant(variantId);
    console.log(
      `[mecfs-agent] locale=${locale} variant=${variant.id} (${variant.label}) health=${healthSnapshot ? "yes" : "none"}`
    );

    // Live agent state, readable from tool closures (the session object is
    // created after the tools). end_session uses this to disconnect only
    // after the goodbye has actually finished playing out.
    const agentActivity = { state: "initializing" };

    const agent = new voice.Agent({
      // Inject a compact "what you already know" briefing (sleep + load) so the
      // questionnaire adapts from the first turn — e.g. it skips "how long did
      // you sleep?" when the watch already knows. Raw HRV/resting-HR stay out:
      // those are the Stage-2 analyst's job and the check-in stays silent on
      // numbers.
      instructions: composeInstructions(
        locale,
        styleForLocale(variant, locale),
        // Two briefings share the slot: passive health ("don't ask what the
        // watch knows") and the daily symptom panel ("ask these by name").
        [
          summarizeHealthForPrompt(healthSnapshot, locale),
          summarizeSymptomPanelForPrompt(symptomPanel, locale),
        ]
          .filter(Boolean)
          .join("\n\n")
      ),
      tools: {
        record_symptom: llm.tool({
          description:
            "Record a symptom. Pick the closest category from the enum and put the user's own words in userWords.",
          parameters: z.object({
            category: symptomCategoryEnum,
            userWords: z.string(),
            // 0–5; 0 = a tracked panel symptom is NOT present today.
            severity: z.number().min(0).max(5).nullish(),
            note: z.any().nullish(),
          }),
          execute: async (args) => {
            const note =
              args.note == null
                ? undefined
                : typeof args.note === "string"
                  ? args.note
                  : JSON.stringify(args.note);
            await recordSymptom(sessionId, {
              category: args.category,
              userWords: args.userWords,
              severity: args.severity ?? undefined,
              note,
            });
            // The tool result is the model's next read — use it to re-arm the
            // interview loop. A bare "ok" makes realtime models treat the tool
            // call as a finished turn and go silent.
            return "recorded. Now speak: a few warm words, then a question — their thread first, otherwise the next open box.";
          },
        }),

        record_activity: llm.tool({
          description:
            "Record an activity the user described. Pick the closest category from the enum and put the user's own words in userWords.",
          parameters: z.object({
            category: activityCategoryEnum,
            userWords: z.string(),
            exertion: z.number().min(1).max(5).nullish(),
            durationMinutes: z
              .number()
              .min(0)
              .max(24 * 60)
              .nullish(),
          }),
          execute: async (args) => {
            await recordActivity(sessionId, {
              category: args.category,
              userWords: args.userWords,
              exertion: args.exertion ?? undefined,
              durationMinutes: args.durationMinutes ?? undefined,
            });
            return "recorded. Now speak: a few warm words, then a question — their thread first, otherwise the next open box.";
          },
        }),

        correct_last_symptom: llm.tool({
          description:
            'Patch the most recent symptom you recorded THIS session. Use when the user corrects you ("actually that was a 2 not a 4", "no — that was orthostatic intolerance, not fatigue"). Pass only the fields that change.',
          parameters: z.object({
            category: symptomCategoryEnum.nullish(),
            userWords: z.string().nullish(),
            severity: z.number().min(0).max(5).nullish(),
            note: z.any().nullish(),
          }),
          execute: async (args) => {
            const note =
              args.note == null
                ? undefined
                : typeof args.note === "string"
                  ? args.note
                  : JSON.stringify(args.note);
            await correctLastSymptom(sessionId, {
              category: args.category ?? undefined,
              userWords: args.userWords ?? undefined,
              severity: args.severity ?? undefined,
              note,
            });
            return 'corrected. Acknowledge softly ("Got it — two.") and continue with the next open question.';
          },
        }),

        correct_last_activity: llm.tool({
          description:
            "Patch the most recent activity you recorded THIS session. Use when the user corrects exertion, category, or duration. Pass only the fields that change.",
          parameters: z.object({
            category: activityCategoryEnum.nullish(),
            userWords: z.string().nullish(),
            exertion: z.number().min(1).max(5).nullish(),
            durationMinutes: z
              .number()
              .min(0)
              .max(24 * 60)
              .nullish(),
          }),
          execute: async (args) => {
            await correctLastActivity(sessionId, {
              category: args.category ?? undefined,
              userWords: args.userWords ?? undefined,
              exertion: args.exertion ?? undefined,
              durationMinutes: args.durationMinutes ?? undefined,
            });
            return "corrected. Acknowledge softly and continue with the next open question.";
          },
        }),

        record_session_context: llm.tool({
          description:
            "Record sleep hours and/or whether today is a PEM crash day. Call as soon as you learn each. You can call this multiple times.",
          parameters: z.object({
            sleepHours: z.number().min(0).max(14).nullish(),
            hadPEMToday: z.boolean().nullish(),
          }),
          execute: async (args) => {
            await recordSessionContext(sessionId, {
              sleepHours: args.sleepHours ?? undefined,
              hadPEMToday: args.hadPEMToday ?? undefined,
            });
            return "recorded. Now speak: a few warm words, then a question — their thread first, otherwise the next open box.";
          },
        }),

        end_session: llm.tool({
          description:
            "Close the check-in. Call this once, in the SAME response as your spoken goodbye — say the goodbye, then immediately call this. Never wait for another user turn.",
          parameters: z.object({
            summary: z.string(),
            energy_score: z.number().min(1).max(5),
            flags: z.array(z.string()).nullish(),
          }),
          execute: async (args) => {
            console.log(`[mecfs-agent] end_session: "${args.summary}" energy=${args.energy_score}`);
            await finalize(sessionId, {
              summary: args.summary,
              energyScore: args.energy_score,
              flags: args.flags ?? undefined,
            });
            // Disconnect only after the goodbye has PLAYED OUT. The old fixed
            // 4s window clipped longer goodbyes mid-word. Poll the agent
            // state: wait for speech to start (it may already be playing, or
            // begin right after this tool returns), then for it to end.
            // Caps: 6s for speech that never starts, 15s overall.
            const t0 = Date.now();
            let sawSpeech = agentActivity.state === "speaking";
            const timer = setInterval(() => {
              if (agentActivity.state === "speaking") sawSpeech = true;
              const elapsed = Date.now() - t0;
              const playoutDone = sawSpeech ? agentActivity.state !== "speaking" : elapsed > 6000; // model never spoke a goodbye — bail
              if (playoutDone || elapsed > 15000) {
                clearInterval(timer);
                // Small tail buffer: agent-side "stopped speaking" runs a
                // beat ahead of the phone's jitter-buffered playback.
                setTimeout(() => {
                  console.log("[mecfs-agent] disconnecting after end_session");
                  ctx.room.disconnect().catch(() => {});
                }, 800);
              }
            }, 200);
            return "session closed. Do not speak again.";
          },
        }),
      },
    });

    const session = new voice.AgentSession({
      llm: new openai.realtime.RealtimeModel({
        model: "gpt-realtime-2",
        // Voice, speaking rate, and turn detection all come from the active
        // Bot Lab variant (see variants.ts) so we can A/B them from the app.
        voice: variant.voice,
        speed: variant.speed,
        // NOTE: temperature is intentionally not set — the GA Realtime API
        // (v1) removed it ("Temperature is no longer supported" per the
        // plugin types). Voice consistency comes from the prompt + voice
        // choice, not a temperature knob.
        inputAudioTranscription: { model: "whisper-1" },
        inputAudioNoiseReduction: { type: "near_field" },
        // interrupt_response stays false across all variants — this population
        // should never be talked over mid-thought.
        turnDetection: variant.turnDetection,
      }),
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

      void appendTranscript(sessionId, item.role, text).catch((e) =>
        console.error("append transcript failed", e)
      );
    });

    session.on(voice.AgentSessionEventTypes.Error, (ev) => {
      console.error("[mecfs-agent] session error", ev);
    });

    // Track whether the agent has actually started speaking. OpenAI's Realtime
    // API intermittently returns "server is overloaded or not ready yet" during
    // the very first generation. When that happens the plugin auto-reconnects,
    // but the dropped reply is never re-issued — so the agent goes silent and
    // the app hangs forever on "getting ready". We watch the agent state and
    // re-trigger the greeting until it genuinely reaches the "speaking" state.
    let agentSpoke = false;
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      if (ev.newState === "speaking") agentSpoke = true;
      // Mirror the live state for tool closures (end_session playout wait).
      agentActivity.state = ev.newState;
    });

    await session.start({ agent, room: ctx.room });

    // Let the phone's playback path finish standing up before the first
    // word. Greeting immediately after start races the client's track
    // subscription + audio-unit spin-up, and the first syllable's frames
    // get swallowed ("the first ms are missing").
    await new Promise((r) => setTimeout(r, 600));

    const GREETING_ATTEMPTS = 4;
    const GREETING_WAIT_MS = 4000;
    const GREETING_POLL_MS = 200;
    for (let attempt = 1; attempt <= GREETING_ATTEMPTS && !agentSpoke; attempt++) {
      if (attempt > 1) {
        console.warn(
          `[mecfs-agent] greeting attempt ${attempt}/${GREETING_ATTEMPTS} — no audio yet, retrying`
        );
      }
      session.generateReply({ instructions: kickInstructionForLocale(locale) });
      const deadline = Date.now() + GREETING_WAIT_MS;
      while (!agentSpoke && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, GREETING_POLL_MS));
      }
    }
    if (!agentSpoke) {
      console.error(
        "[mecfs-agent] agent never produced greeting audio after retries — OpenAI Realtime likely degraded"
      );
    }
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    // AGENT_NAME is set ONLY in LiveKit Cloud agent secrets. A named worker
    // is excluded from automatic dispatch — prod rooms request it explicitly
    // via the token's roomConfig (see convex/livekit.ts). Locally this is
    // unset, so the dev worker registers unnamed and keeps receiving
    // automatic dispatch for dev rooms. This is what stops a deployed cloud
    // agent from stealing dev calls.
    agentName: process.env.AGENT_NAME,
  })
);
