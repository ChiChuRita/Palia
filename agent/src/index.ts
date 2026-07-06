import "dotenv/config";

import { fileURLToPath } from "node:url";
import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
  inference,
  voice,
} from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";

import { ttsInstructions } from "./prompts.js";
import { runCheckin, type CheckinUserData } from "./tasks.js";
import { SYMPTOM_CATEGORY_KEYS, type SymptomCategory } from "./taxonomy.js";
import { appendTranscript, finalize, generateSummary, type HealthSnapshot } from "./tools.js";

// Turn patience for this population (ported from the old Bot Lab variant A):
// generous silence before the agent replies, and it NEVER talks over the user.
const VAD_MIN_SILENCE_S = 0.8;
const ENDPOINT_MIN_DELAY_MS = 800;
const ENDPOINT_MAX_DELAY_MS = 4000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default defineAgent({
  prewarm: (proc: JobProcess) => {
    proc.userData.vad = new inference.VAD({ minSilenceDuration: VAD_MIN_SILENCE_S });
  },

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
    let locale: "en" | "de" = "en";
    let healthSnapshot: HealthSnapshot | null = null;
    let symptomPanel: SymptomCategory[] = [];
    try {
      const parsed = JSON.parse(participant.metadata || "{}");
      if (parsed.locale === "de") locale = "de";
      if (parsed.healthSnapshot && typeof parsed.healthSnapshot === "object") {
        healthSnapshot = parsed.healthSnapshot as HealthSnapshot;
      }
      if (Array.isArray(parsed.symptomPanel)) {
        symptomPanel = parsed.symptomPanel.filter(
          (c: unknown): c is SymptomCategory =>
            typeof c === "string" && (SYMPTOM_CATEGORY_KEYS as readonly string[]).includes(c)
        );
      }
    } catch {
      /* leave defaults */
    }
    console.log(`[mecfs-agent] locale=${locale} health=${healthSnapshot ? "yes" : "none"}`);

    const userData: CheckinUserData = {
      sessionId,
      locale,
      healthSnapshot,
      symptomPanel,
      recorded: { symptoms: [], activities: [] },
    };

    // Plain-text transcript mirror for the summary model (the same lines are
    // POSTed to Convex by the listener below).
    const transcriptLines: string[] = [];

    const rootAgent = voice.Agent.create<CheckinUserData>({
      id: "checkin-root",
      // The root never generates speech itself — it says deterministic lines
      // and runs the box tasks, each with its own narrow prompt. The runner
      // lives in tasks.ts so the smoke test drives the identical flow.
      instructions: "You coordinate a daily check-in. Never speak unprompted.",
      tools: {},
      onEnter: (actx) =>
        runCheckin(actx, {
          generateSummary: (recorded, statedEnergy) =>
            generateSummary(transcriptLines.join("\n"), recorded, locale, statedEnergy),
          finalize: (s) => finalize(sessionId, s),
          disconnect: () => void ctx.room.disconnect().catch(() => {}),
        }),
    });

    const session = new voice.AgentSession<CheckinUserData>({
      stt: new openai.STT({ model: "gpt-4o-transcribe", useRealtime: true, language: locale }),
      llm: new openai.LLM({ model: "gpt-5.4-mini", reasoningEffort: "low" }),
      tts: new openai.TTS({
        model: "gpt-4o-mini-tts",
        // Same companion voice as the app's insight playback. Not in the
        // plugin's typed voice union yet, but accepted by the API.
        voice: "marin" as never,
        instructions: ttsInstructions(locale),
      }),
      vad: ctx.proc.userData.vad as inference.VAD,
      userData,
      // A patient may name several symptoms in one breath — allow the model
      // to chain more record_* calls per turn than the default 3.
      maxToolSteps: 6,
      turnHandling: {
        turnDetection: "vad",
        endpointing: { minDelay: ENDPOINT_MIN_DELAY_MS, maxDelay: ENDPOINT_MAX_DELAY_MS },
        interruption: { enabled: false },
      },
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
