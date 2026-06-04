import "dotenv/config";

import { fileURLToPath } from "node:url";
import { type JobContext, ServerOptions, cli, defineAgent, llm, voice } from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import { z } from "zod";

import { kickInstructionForLocale, promptForLocale } from "./interviewer.js";
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
  formatHealthContext,
  recordActivity,
  recordSessionContext,
  recordSymptom,
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
    try {
      const meta = participant.metadata;
      if (meta) {
        const parsed = JSON.parse(meta);
        if (typeof parsed.locale === "string") locale = parsed.locale;
        if (parsed.healthSnapshot && typeof parsed.healthSnapshot === "object") {
          healthSnapshot = parsed.healthSnapshot as HealthSnapshot;
        }
      }
    } catch {
      /* leave defaults */
    }
    console.log(`[mecfs-agent] locale=${locale} health=${healthSnapshot ? "yes" : "none"}`);

    const agent = new voice.Agent({
      instructions: promptForLocale(locale),
      tools: {
        get_health_context: llm.tool({
          description:
            "Retrieve the user's recent HRV (with 7-day baseline), resting heart rate, last night's sleep, and yesterday's step count. Each field is a number or null. NULL means the data wasn't available — do not reference any field that is null. If ALL fields are null, do not mention biomarkers at all.",
          execute: async () => JSON.stringify(formatHealthContext(healthSnapshot)),
        }),

        record_symptom: llm.tool({
          description:
            "Record a symptom. Pick the closest category from the enum and put the user's own words in userWords.",
          parameters: z.object({
            category: symptomCategoryEnum,
            userWords: z.string(),
            severity: z.number().min(1).max(5).nullish(),
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
            return "ok";
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
            return "ok";
          },
        }),

        correct_last_symptom: llm.tool({
          description:
            'Patch the most recent symptom you recorded THIS session. Use when the user corrects you ("actually that was a 2 not a 4", "no — that was orthostatic intolerance, not fatigue"). Pass only the fields that change.',
          parameters: z.object({
            category: symptomCategoryEnum.nullish(),
            userWords: z.string().nullish(),
            severity: z.number().min(1).max(5).nullish(),
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
            return "ok";
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
            return "ok";
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
            return "ok";
          },
        }),

        end_session: llm.tool({
          description:
            "Close the check-in. Call exactly once at the end of the conversation, AFTER you have already spoken your goodbye.",
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
            // 4s grace window: gives any post-tool model speech room to play
            // out. The prompt now also instructs the agent to say its goodbye
            // BEFORE calling this tool, so this is mostly insurance.
            setTimeout(() => {
              console.log("[mecfs-agent] disconnecting after end_session");
              ctx.room.disconnect().catch(() => {});
            }, 4000);
            return "ok";
          },
        }),
      },
    });

    const session = new voice.AgentSession({
      llm: new openai.realtime.RealtimeModel({
        model: "gpt-realtime-2",
        voice: "ballad",
        // NOTE: temperature is intentionally not set — the GA Realtime API
        // (v1) removed it ("Temperature is no longer supported" per the
        // plugin types). Voice consistency comes from the prompt + voice
        // choice, not a temperature knob.
        inputAudioTranscription: { model: "whisper-1" },
        inputAudioNoiseReduction: { type: "near_field" },
        turnDetection: {
          type: "server_vad",
          // 0.6 = balanced. Was 0.8 (very aggressive — felt slow). OpenAI's
          // default is 0.5; we sit slightly above to avoid VAD-on-breath.
          threshold: 0.6,
          prefix_padding_ms: 300,
          // 300ms silence before responding — matches natural human turn-
          // taking (research pegs it around 200ms gap between turns). Below
          // 300ms it starts cutting people off mid-thought; above 500ms it
          // feels like a slow assistant. Trade-off note: brain-fog users
          // who pause >300ms mid-sentence will get interrupted; if real
          // users complain about this, bump back to 500–600ms.
          silence_duration_ms: 300,
          // Do not let VAD interrupt the agent's playout — false-positives
          // would cut it off mid-word.
          interrupt_response: false,
        },
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
    });

    await session.start({ agent, room: ctx.room });

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

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
