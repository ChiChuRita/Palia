// The check-in as ONE voice.AgentTask over one continuous context.
//
// The earlier five-box architecture (sleep → crash → … as separate tasks with
// per-box context copies) created seams on the realtime model: each handoff
// re-read history cold and re-mirrored it badly (inverted recaps, invented
// numbers, recycled openers — all caught in live calls). One task = one
// context = no seams. The interview plan lives in the prompt (prompts.ts).
//
// What survives from that era because it was verified good:
// - NO record_* tools (a realtime model narrates data capture) — records are
//   extracted from the transcript in one offline pass at the end (tools.ts).
// - Escape tools (cant_talk_now / crisis_detected) + a silent checkin_done
//   whose required `energy` param keeps the model from ending before the
//   energy question.
// - A turn-cap backstop counted via ConversationItemAdded (the SDK's
//   onUserTurnCompleted hook never fires on our paths).
//
// Greeting, goodbyes, and the nudge are GENERATED (same voice, in-context):
// the greeting via generateReply in onEnter, the goodbyes as the model's
// follow-up on the checkin_done / cant_talk_now tool output — the task then
// completes on that assistant item. Only the crisis line is scripted.

import { llm, voice } from "@livekit/agents";
import { z } from "zod";

import {
  cantTalkInstructions,
  checkinPrompt,
  crisisLine,
  crisisPrompt,
  goodbyeInstructions,
  greetingInstructions,
  nudgeInstructions,
  type Daypart,
  type Locale,
} from "./prompts.js";
import { type SymptomCategory } from "./taxonomy.js";
import {
  summarizeContinuityForPrompt,
  summarizeHealthForPrompt,
  summarizeProfileForPrompt,
  summarizeSymptomPanelForPrompt,
  type Analysis,
  type Continuity,
  type HealthSnapshot,
} from "./tools.js";

export type CheckinOutcome = "done" | "cantTalk" | "crisis" | "dropped";

export type CheckinUserData = {
  sessionId: string;
  locale: Locale;
  healthSnapshot: HealthSnapshot | null;
  symptomPanel: SymptomCategory[];
  // Continuity between calls (all optional — empty for a new user):
  lastCheckin?: Continuity["lastCheckin"];
  lastCrash?: Continuity["lastCrash"];
  symptomWords?: Record<string, string> | null;
  daypart?: Daypart | null;
  name?: string | null;
  // Soft per-person guidance from the onboarding profile (may be absent).
  careNote?: string | null;
};

type Task = voice.AgentTask<CheckinOutcome, CheckinUserData>;

// A whole check-in is ~10-14 real user turns; force-complete well above that
// so a stuck conversation can never run forever.
const MAX_USER_TURNS = 20;

function makeCheckinTask(ud: CheckinUserData): Task {
  let task!: Task;
  let userTurns = 0;
  let nudgeTimer: ReturnType<typeof setInterval> | undefined;
  let nudgesLeft = 2;
  // Set by checkin_done / cant_talk_now — the model's follow-up on the tool
  // output is the goodbye; the task completes when that assistant item lands.
  let pendingOutcome: CheckinOutcome | null = null;

  const briefing = [
    summarizeProfileForPrompt(ud.careNote, ud.locale),
    summarizeHealthForPrompt(ud.healthSnapshot, ud.locale, ud.daypart),
    summarizeSymptomPanelForPrompt(ud.symptomPanel, ud.locale, ud.symptomWords),
    summarizeContinuityForPrompt(
      { lastCheckin: ud.lastCheckin, lastCrash: ud.lastCrash, daypart: ud.daypart },
      ud.locale
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  // Turn counting via the session event — the SDK's onUserTurnCompleted hook
  // only fires on the STT pipeline, which both the realtime path and the
  // session.run test path bypass (caught by bench/traces).
  let lastItemAt = Date.now();
  const onItem = (ev: { item: { type: string; role?: string; content?: unknown[] } }) => {
    if (ev.item.type !== "message") return;
    lastItemAt = Date.now();
    if (ev.item.role === "user" && isRealUserTurn(ev.item)) {
      userTurns += 1;
    } else if (ev.item.role === "assistant" && !task.done) {
      if (pendingOutcome) {
        // The goodbye just landed — done.
        task.complete(pendingOutcome);
      } else if (userTurns >= MAX_USER_TURNS) {
        // Backstop — complete only AFTER the model's reply to the cap-hitting
        // turn; completing on the user item races that generation's escape
        // tools. ponytail: no goodbye on this rare path.
        console.log("[mecfs-agent] turn cap reached, closing the check-in");
        task.complete("done");
      }
    }
  };

  task = voice.AgentTask.create<CheckinOutcome, CheckinUserData>({
    id: "checkin",
    instructions: checkinPrompt(ud.locale, briefing),
    tools: {
      checkin_done: llm.tool({
        description:
          "Call the moment all five topics are covered (or clearly declined) — silently, never announcing it ('I'll wrap up now'); the tool output tells you how to say goodbye. NEVER call it in a turn where you also ask a question — if the energy question hasn't been answered yet, ask it and wait.",
        parameters: z.object({
          // Forcing function: the model cannot end the check-in before the
          // energy question was actually answered (or clearly declined/vague).
          // The value itself is ignored — the transcript extractor is the
          // source of truth.
          energy: z
            .number()
            .min(1)
            .max(5)
            .nullable()
            .describe(
              "The energy they stated, 1-5. null when they declined or answered only vaguely ('middling', 'so-so') — a vague answer is final, never ask again."
            ),
        }),
        execute: async () => {
          // Blocks a stray done-call before the patient has said anything.
          // NOT stricter than that: one answer can legitimately cover all
          // five topics, and rejecting then forces a re-ask (bench-caught).
          if (userTurns < 1) return "not yet — the patient hasn't answered anything yet.";
          pendingOutcome = "done";
          // The follow-up generation on this output IS the goodbye.
          return goodbyeInstructions(ud.locale);
        },
      }),
      cant_talk_now: llm.tool({
        description:
          'Call IMMEDIATELY when the user indicates in ANY words that they cannot or do not want to continue — "I can\'t talk", "not now", "I have to go", "can we stop", "too tired for this". Never offer alternatives, never ask if they are sure.',
        parameters: z.object({}),
        execute: async () => {
          pendingOutcome = "cantTalk";
          return cantTalkInstructions(ud.locale);
        },
      }),
      crisis_detected: llm.tool({
        description:
          "Call IMMEDIATELY on any mention of self-harm, suicide, or immediate danger. Do not speak — the crisis response is handled for you.",
        parameters: z.object({}),
        execute: async () => {
          task.complete("crisis");
          throw new voice.StopResponse();
        },
      }),
    },
    onEnter: (ctx) => {
      ctx.session.on(voice.AgentSessionEventTypes.ConversationItemAdded, onItem);
      // The greeting — generated in the realtime voice, guided per daypart/name.
      ctx.session.generateReply({
        instructions: greetingInstructions(ud.locale, { daypart: ud.daypart, name: ud.name }),
        allowInterruptions: false,
      });
      // Gentle silence nudge: foggy mornings need time — after ~18s of
      // nothing, one soft generated "I'm still here", at most twice per
      // call. Transcription lag can make lastItemAt stale while someone IS
      // talking, so the threshold stays generous.
      // ponytail: no agent/user speaking-state check — the 18s window plus
      // the 2-nudge cap keeps a mistimed nudge rare and harmless.
      nudgeTimer = setInterval(() => {
        if (task.done) return;
        if (nudgesLeft <= 0 || Date.now() - lastItemAt < 18_000) return;
        nudgesLeft -= 1;
        lastItemAt = Date.now();
        ctx.session.generateReply({ instructions: nudgeInstructions(ud.locale) });
      }, 3_000);
    },
    onExit: (ctx) => {
      if (nudgeTimer) clearInterval(nudgeTimer);
      ctx.session.off(voice.AgentSessionEventTypes.ConversationItemAdded, onItem);
    },
  });
  return task;
}

// STT noise ("Hm.", ".", "Äh") must not count toward the turn cap — only
// turns with actual verbal content do.
function isRealUserTurn(message: { content?: unknown[] } | undefined): boolean {
  const text = (message?.content ?? []).filter((c): c is string => typeof c === "string").join(" ");
  return /[\p{L}\p{N}]{2,}/u.test(text);
}

// ── The deterministic runner ────────────────────────────────────────────────
//
// Lives here (not index.ts) so the headless smoke/trace harnesses drive the
// exact production flow. Must run inside an agent hook — AgentTask.run()
// needs the activity context — so index.ts wires it as the root agent's
// onEnter.

export async function runCheckin(
  actx: voice.AgentContext<CheckinUserData>,
  deps: {
    // One offline gpt-5.5 pass over the transcript → summary + every
    // structured record (there are no in-call record tools). null = nothing
    // worth analyzing (zero user lines, e.g. an instantly dropped call) —
    // the runner then skips persist/finalize and just disconnects.
    analyze: () => Promise<Analysis | null>;
    persist: (a: Analysis) => Promise<void>;
    finalize: (s: { summary: string; energyScore: number; flags?: string[] }) => Promise<void>;
    disconnect: () => void;
    // Fires when the patient's participant leaves the room mid-call — the
    // callback completes the task as "dropped" so the transcript still gets
    // analyzed and persisted. Optional: the bench harnesses don't wire it.
    onPatientLeft?: (completeDropped: () => void) => void;
    warmupMs?: number;
  }
): Promise<void> {
  const session = actx.session;
  const ud = session.userData;
  const locale = ud.locale;

  // Register the drop handler BEFORE the warmup sleep — a hang-up inside the
  // warmup window must still be seen.
  const task = makeCheckinTask(ud);
  deps.onPatientLeft?.(() => {
    if (!task.done) task.complete("dropped");
  });

  // Let the phone's playback path finish standing up before the first word —
  // greeting immediately after start races the client's track subscription
  // and the first syllable gets swallowed. The greeting itself is generated
  // in the task's onEnter.
  await new Promise((r) => setTimeout(r, deps.warmupMs ?? 600));
  const outcome = await task.run();
  console.log(`[mecfs-agent] checkin complete: ${outcome}`);
  if (outcome === "crisis") {
    console.log("[mecfs-agent] crisis detected — handing off, session stays open");
    session.updateAgent(makeCrisisAgent(locale));
    return; // no finalize, no disconnect — the crisis agent takes over
  }
  // The goodbye was already spoken inside the task (the model's follow-up on
  // the done/cant-talk tool output) — no dead air during extraction below.

  // Extraction + persistence + finalize are code, not model side-tasks.
  // Plain HTTP — they finish fine even if the participant already hung up.
  const a = await deps.analyze();
  if (!a) {
    console.log("[mecfs-agent] no patient speech captured — nothing to save, disconnecting");
    deps.disconnect();
    return;
  }
  await deps.persist(a);
  // Set-dedupe: the extractor may itself emit "cant_talk" for a cut-short call.
  const extraFlag =
    outcome === "cantTalk" ? "cant_talk" : outcome === "dropped" ? "call_dropped" : null;
  const flags = extraFlag ? [...new Set([...(a.flags ?? []), extraFlag])] : a.flags;
  console.log(
    `[mecfs-agent] finalize: "${a.summary}" energy=${a.energyScore} ` +
      `symptoms=${a.symptoms.length} activities=${a.activities.length}`
  );
  await deps.finalize({ summary: a.summary, energyScore: a.energyScore, flags });

  // Small tail: agent-side playout runs a beat ahead of the phone's
  // jitter-buffered playback.
  await new Promise((r) => setTimeout(r, 800));
  console.log("[mecfs-agent] disconnecting");
  deps.disconnect();
}

// ── Crisis agent (a handoff — it never "completes") ─────────────────────────

export function makeCrisisAgent(locale: Locale): voice.Agent {
  return voice.Agent.create({
    id: "crisis",
    instructions: crisisPrompt(locale),
    tools: {},
    onEnter: (ctx) => {
      // The scripted crisis sentence is deterministic — never left to the LLM.
      ctx.session.say(crisisLine(locale), { allowInterruptions: false });
    },
  });
}
