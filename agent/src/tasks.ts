// The check-in as bounded AgentTasks over shared typed userData.
//
// Each box (greeter → sleep → crash → symptoms → yesterday → closing) is a
// voice.AgentTask with a narrow prompt and only the tools it needs. Every task
// carries two escape tools (crisis_detected / cant_talk_now) plus a *_done
// tool; completing returns a BoxOutcome to the deterministic runner in
// index.ts, which decides what happens next. No box order or "already asked"
// state lives in a prompt — it's all code.

import { llm, voice } from "@livekit/agents";
import { z } from "zod";

import {
  cantTalkGoodbye,
  coveredBriefing,
  crashPrompt,
  crisisLine,
  crisisPrompt,
  closingPrompt,
  goodbyeLine,
  greeterPrompt,
  openingLine,
  sharedStyle,
  styleReminder,
  sleepPrompt,
  symptomsPrompt,
  yesterdayPrompt,
  type Locale,
} from "./prompts.js";
import {
  ACTIVITY_CATEGORY_KEYS,
  SYMPTOM_CATEGORY_KEYS,
  type ActivityCategory,
  type SymptomCategory,
} from "./taxonomy.js";
import {
  correctLastActivity,
  correctLastSymptom,
  recordActivity,
  recordSessionContext,
  recordSymptom,
  summarizeHealthForPrompt,
  summarizeSymptomPanelForPrompt,
  type HealthSnapshot,
} from "./tools.js";

export type BoxOutcome = "done" | "cantTalk" | "crisis";

export type CheckinUserData = {
  sessionId: string;
  locale: Locale;
  healthSnapshot: HealthSnapshot | null;
  symptomPanel: SymptomCategory[];
  // Short labels of everything recorded so far — feeds the "already covered"
  // briefing of later boxes and the summary fallback.
  recorded: { symptoms: string[]; activities: string[] };
  sleepHours?: number;
  hadPEMToday?: boolean;
  energy?: number;
};

type Task = voice.AgentTask<BoxOutcome, CheckinUserData>;
type Ctx = { userData: CheckinUserData };

// z.enum needs a tuple type with at least one element. Cast through unknown.
const symptomCategoryEnum = z.enum(
  SYMPTOM_CATEGORY_KEYS as unknown as [SymptomCategory, ...SymptomCategory[]]
);
const activityCategoryEnum = z.enum(
  ACTIVITY_CATEGORY_KEYS as unknown as [ActivityCategory, ...ActivityCategory[]]
);

const REARM = "recorded. Now reply: a few warm words, then your one question.";

// ── Recording tools (shared; sessionId + state come from ctx.userData) ──────

function recordingTools() {
  return {
    record_symptom: llm.tool({
      description:
        "Record a symptom. Pick the closest category from the enum and put the user's own words in userWords. severity 0-5; 0 = a tracked symptom is NOT present today.",
      parameters: z.object({
        category: symptomCategoryEnum,
        userWords: z.string(),
        severity: z.number().min(0).max(5).nullish(),
        note: z.string().nullish(),
      }),
      execute: async (args, { ctx }) => {
        const ud = (ctx as Ctx).userData;
        await recordSymptom(ud.sessionId, {
          category: args.category,
          userWords: args.userWords,
          severity: args.severity ?? undefined,
          note: args.note ?? undefined,
        });
        ud.recorded.symptoms.push(
          `${args.category}${args.severity != null ? ` (${args.severity}/5)` : ""}`
        );
        return REARM;
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
      execute: async (args, { ctx }) => {
        const ud = (ctx as Ctx).userData;
        await recordActivity(ud.sessionId, {
          category: args.category,
          userWords: args.userWords,
          exertion: args.exertion ?? undefined,
          durationMinutes: args.durationMinutes ?? undefined,
        });
        ud.recorded.activities.push(
          `${args.category}${args.exertion != null ? ` (${args.exertion}/5)` : ""}`
        );
        return REARM;
      },
    }),

    correct_last_symptom: llm.tool({
      description:
        'Patch the most recent symptom recorded THIS session. Use on a correction ("a 2, not 4"). Pass only the fields that change.',
      parameters: z.object({
        category: symptomCategoryEnum.nullish(),
        userWords: z.string().nullish(),
        severity: z.number().min(0).max(5).nullish(),
        note: z.string().nullish(),
      }),
      execute: async (args, { ctx }) => {
        await correctLastSymptom((ctx as Ctx).userData.sessionId, {
          category: args.category ?? undefined,
          userWords: args.userWords ?? undefined,
          severity: args.severity ?? undefined,
          note: args.note ?? undefined,
        });
        return 'corrected. Acknowledge softly ("Got it — two.") and continue.';
      },
    }),

    correct_last_activity: llm.tool({
      description:
        "Patch the most recent activity recorded THIS session. Pass only the fields that change.",
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
      execute: async (args, { ctx }) => {
        await correctLastActivity((ctx as Ctx).userData.sessionId, {
          category: args.category ?? undefined,
          userWords: args.userWords ?? undefined,
          exertion: args.exertion ?? undefined,
          durationMinutes: args.durationMinutes ?? undefined,
        });
        return "corrected. Acknowledge softly and continue.";
      },
    }),

    record_session_context: llm.tool({
      description:
        "Record sleep hours and/or whether today is a PEM crash day. Call as soon as you learn each; multiple calls OK.",
      parameters: z.object({
        sleepHours: z.number().min(0).max(14).nullish(),
        hadPEMToday: z.boolean().nullish(),
      }),
      execute: async (args, { ctx }) => {
        const ud = (ctx as Ctx).userData;
        if (args.sleepHours != null) ud.sleepHours = args.sleepHours;
        if (args.hadPEMToday != null) ud.hadPEMToday = args.hadPEMToday;
        await recordSessionContext(ud.sessionId, {
          sleepHours: args.sleepHours ?? undefined,
          hadPEMToday: args.hadPEMToday ?? undefined,
        });
        return REARM;
      },
    }),
  };
}

// ── Task factory ────────────────────────────────────────────────────────────

// Escape hatches present in EVERY task: the closure over `getTask` lets the
// tool complete the running task so the runner regains control immediately.
function escapeTools(getTask: () => Task) {
  return {
    cant_talk_now: llm.tool({
      description:
        'Call IMMEDIATELY when the user indicates in ANY words that they cannot or do not want to continue — "I can\'t talk", "not now", "I have to go", "can we stop", "too tired for this". Never offer alternatives, never ask if they are sure. Do not speak — the goodbye is handled for you.',
      parameters: z.object({}),
      execute: async () => {
        getTask().complete("cantTalk");
        return "acknowledged. Do not speak.";
      },
    }),
    crisis_detected: llm.tool({
      description:
        "Call IMMEDIATELY on any mention of self-harm, suicide, or immediate danger. Do not speak — the crisis response is handled for you.",
      parameters: z.object({}),
      execute: async () => {
        getTask().complete("crisis");
        return "acknowledged. Do not speak.";
      },
    }),
  };
}

function makeBoxTask(opts: {
  id: string;
  locale: Locale;
  instructions: string;
  chatCtx?: llm.ChatContext;
  doneDescription: string;
  speakOnEnter: boolean;
  // Deterministic backstop: after this many user turns the box force-
  // completes — a model that forgets its *_done tool must never stall the
  // check-in. Interview flow is code, not prompt discipline.
  maxUserTurns: number;
  withRecordingTools?: boolean;
}): Task {
  let task!: Task;
  let userTurns = 0;
  const control = {
    [`${opts.id}_done`]: llm.tool({
      description: `${opts.doneDescription} Do not speak in the same turn — the next question is handled for you.`,
      parameters: z.object({}),
      execute: async () => {
        task.complete("done");
        return "done. Do not speak — the next question is handled for you.";
      },
    }),
    ...escapeTools(() => task),
  };
  task = voice.AgentTask.create<BoxOutcome, CheckinUserData>({
    id: opts.id,
    instructions: `${sharedStyle(opts.locale)}\n\n${opts.instructions}\n\n${styleReminder(opts.locale)}`,
    chatCtx: opts.chatCtx,
    tools: { ...(opts.withRecordingTools === false ? {} : recordingTools()), ...control },
    onEnter: (ctx) => {
      if (opts.speakOnEnter) ctx.session.generateReply();
    },
    onUserTurnCompleted: () => {
      userTurns += 1;
      if (userTurns >= opts.maxUserTurns) {
        console.log(`[mecfs-agent] box ${opts.id}: turn budget reached, moving on`);
        // Let the current reply generation finish naturally; complete() takes
        // effect when the turn settles.
        task.complete("done");
      }
    },
  });
  return task;
}

// ── The boxes ───────────────────────────────────────────────────────────────

export function makeGreeterTask(ud: CheckinUserData, chatCtx?: llm.ChatContext): Task {
  return makeBoxTask({
    id: "greeter",
    locale: ud.locale,
    instructions: greeterPrompt(ud.locale),
    chatCtx,
    doneDescription: "Call after the user's first answer is heard (and any symptom recorded).",
    // The opening line was already spoken deterministically by the runner —
    // this task only listens to the reply.
    speakOnEnter: false,
    maxUserTurns: 1,
  });
}

export function makeSleepTask(ud: CheckinUserData, chatCtx?: llm.ChatContext): Task {
  return makeBoxTask({
    id: "sleep",
    locale: ud.locale,
    instructions: sleepPrompt(ud.locale, summarizeHealthForPrompt(ud.healthSnapshot, ud.locale)),
    chatCtx,
    doneDescription:
      "Call THE MOMENT you know whether sleep felt restful (and recorded what you heard).",
    speakOnEnter: true,
    maxUserTurns: 2,
  });
}

export function makeCrashTask(ud: CheckinUserData, chatCtx?: llm.ChatContext): Task {
  return makeBoxTask({
    id: "crash",
    locale: ud.locale,
    instructions: crashPrompt(ud.locale),
    chatCtx,
    doneDescription:
      "Call THE MOMENT the crash question is answered and recorded (including the trigger, if any).",
    speakOnEnter: true,
    maxUserTurns: 3,
  });
}

export function makeSymptomsTask(ud: CheckinUserData, chatCtx?: llm.ChatContext): Task {
  const covered = [
    ...ud.recorded.symptoms.map((s) => `symptom: ${s}`),
    ud.hadPEMToday != null ? `crash today: ${ud.hadPEMToday ? "yes" : "no"}` : "",
    ud.sleepHours != null ? `sleep hours: ${ud.sleepHours}` : "",
  ].filter(Boolean);
  return makeBoxTask({
    id: "symptoms",
    locale: ud.locale,
    instructions: symptomsPrompt(
      ud.locale,
      summarizeSymptomPanelForPrompt(ud.symptomPanel, ud.locale),
      coveredBriefing(ud.locale, covered)
    ),
    chatCtx,
    doneDescription:
      "Call THE MOMENT the tracked symptoms and the open 'anything else' question are covered — especially when they say nothing else is wrong.",
    speakOnEnter: true,
    maxUserTurns: 6,
  });
}

export function makeYesterdayTask(ud: CheckinUserData, chatCtx?: llm.ChatContext): Task {
  const steps = ud.healthSnapshot?.stepsYesterday;
  const stepsBriefing =
    steps == null
      ? ""
      : ud.locale === "de"
        ? `# Kontext\nSchritte gestern: ca. ${Math.round(steps)}. Nur Kontext — frag trotzdem, wie es sich ANFÜHLTE, und lies die Zahl nicht vor.`
        : `# Context\nSteps yesterday: about ${Math.round(steps)}. Context only — still ask how it FELT, and never read the number aloud.`;
  return makeBoxTask({
    id: "yesterday",
    locale: ud.locale,
    instructions: yesterdayPrompt(ud.locale, stepsBriefing),
    chatCtx,
    doneDescription:
      "Call THE MOMENT yesterday's activities and how they felt are recorded — especially when they say that was everything.",
    speakOnEnter: true,
    maxUserTurns: 3,
  });
}

export function makeClosingTask(ud: CheckinUserData, chatCtx?: llm.ChatContext): Task {
  let task!: Task;
  let userTurns = 0;
  const control = {
    closing_done: llm.tool({
      description:
        "Call with the user's stated energy (1-5) THE MOMENT they answer. Do not speak — the goodbye is handled for you.",
      parameters: z.object({ energy: z.number().min(1).max(5) }),
      execute: async (args, { ctx }) => {
        (ctx as Ctx).userData.energy = args.energy;
        task.complete("done");
        return "done. Do not speak — the goodbye is handled for you.";
      },
    }),
    ...escapeTools(() => task),
  };
  task = voice.AgentTask.create<BoxOutcome, CheckinUserData>({
    id: "closing",
    instructions: `${sharedStyle(ud.locale)}\n\n${closingPrompt(ud.locale)}\n\n${styleReminder(ud.locale)}`,
    chatCtx,
    tools: control,
    onEnter: (ctx) => {
      ctx.session.generateReply();
    },
    onUserTurnCompleted: () => {
      userTurns += 1;
      // Two chances to state a number, then move on — the summary model
      // estimates energy when unstated.
      if (userTurns >= 2) {
        console.log("[mecfs-agent] box closing: turn budget reached, moving on");
        task.complete("done");
      }
    },
  });
  return task;
}

// ── The deterministic runner ────────────────────────────────────────────────
//
// Lives here (not index.ts) so the headless smoke test can drive the exact
// production flow. Must run inside an agent hook — AgentTask.run() needs the
// activity context — so index.ts wires it as the root agent's onEnter.

export async function runCheckin(
  actx: voice.AgentContext<CheckinUserData>,
  deps: {
    finalize: (s: { summary: string; energyScore: number; flags?: string[] }) => Promise<void>;
    generateSummary: (
      recorded: CheckinUserData["recorded"],
      statedEnergy?: number
    ) => Promise<{ summary: string; energyScore: number; flags?: string[] }>;
    disconnect: () => void;
    warmupMs?: number;
  }
): Promise<void> {
  const session = actx.session;
  const ud = session.userData;
  const locale = ud.locale;

  // Let the phone's playback path finish standing up before the first word —
  // greeting immediately after start races the client's track subscription
  // and the first syllable gets swallowed.
  await new Promise((r) => setTimeout(r, deps.warmupMs ?? 600));

  // Deterministic opening — no LLM drift possible. One retry: with plain TTS
  // a failure is an HTTP error, not the old Realtime silent-drop.
  try {
    await session.say(openingLine(locale)).waitForPlayout();
  } catch (e) {
    console.warn("[mecfs-agent] opening line failed once, retrying", e);
    await session.say(openingLine(locale)).waitForPlayout();
  }

  const boxes = [
    makeGreeterTask,
    makeSleepTask,
    makeCrashTask,
    makeSymptomsTask,
    makeYesterdayTask,
    makeClosingTask,
  ];

  let outcome: BoxOutcome = "done";
  for (const make of boxes) {
    // Fresh chat context copy per task: full conversation so far, without the
    // previous task's instructions.
    const chatCtx = session.history.copy({ excludeInstructions: true, excludeFunctionCall: true });
    outcome = await make(ud, chatCtx).run();
    if (outcome === "crisis") {
      console.log("[mecfs-agent] crisis detected — handing off, session stays open");
      session.updateAgent(makeCrisisAgent(locale));
      return; // no finalize, no disconnect — the crisis agent takes over
    }
    if (outcome === "cantTalk") break;
  }

  // Summary + finalize are code now, not a model's goodbye-turn side task.
  const s = await deps.generateSummary(ud.recorded, ud.energy);
  const flags = outcome === "cantTalk" ? [...(s.flags ?? []), "cant_talk"] : s.flags;
  console.log(`[mecfs-agent] finalize: "${s.summary}" energy=${s.energyScore}`);
  await deps.finalize({ summary: s.summary, energyScore: s.energyScore, flags });

  const bye = outcome === "cantTalk" ? cantTalkGoodbye(locale) : goodbyeLine(locale);
  try {
    await session.say(bye).waitForPlayout();
  } catch (e) {
    console.error("[mecfs-agent] goodbye failed", e);
  }
  // Small tail: agent-side playout runs a beat ahead of the phone's
  // jitter-buffered playback.
  await new Promise((r) => setTimeout(r, 800));
  console.log("[mecfs-agent] disconnecting");
  deps.disconnect();
}

// ── Crisis agent (a handoff, not a task — it never "completes") ─────────────

export function makeCrisisAgent(locale: Locale): voice.Agent {
  return voice.Agent.create({
    id: "crisis",
    instructions: crisisPrompt(locale),
    tools: {},
    onEnter: (ctx) => {
      // The scripted crisis sentence is deterministic — never left to the LLM.
      ctx.session.say(crisisLine(locale));
    },
  });
}
