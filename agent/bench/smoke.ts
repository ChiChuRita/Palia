// Headless smoke test — drives the PRODUCTION runner (tasks.runCheckin) with
// text turns via the 1.5.0 testing API (session.run). No mic, no room; real
// LLM calls and real Convex writebacks.
//
// Run (from agent/):
//   SESSION_ID=<convex sessions _id> OPENAI_API_KEY=... CONVEX_HTTP_URL=... \
//   AGENT_SHARED_SECRET=... npx tsx bench/smoke.ts [happy|crisis|canttalk]

import { initializeLogger, voice } from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";

initializeLogger({ pretty: true, level: "warn" });

import { runCheckin, type CheckinUserData } from "../src/tasks.js";
import { analyzeTranscript, appendTranscript, finalize, persistRecords } from "../src/tools.js";
import type { Analysis } from "../src/tools.js";

const scenario = (process.argv[2] ?? "happy") as "happy" | "crisis" | "canttalk";
const sessionId = process.env.SESSION_ID;
if (!sessionId) {
  console.error("SESSION_ID not set (create one: npx convex run sessions:start ...)");
  process.exit(1);
}
const locale = (process.env.SMOKE_LOCALE ?? "en") as "en" | "de";

const TURNS: Record<typeof scenario, string[]> = {
  happy: [
    "Honestly pretty wiped out today.",
    "I slept maybe five hours, it didn't feel restful at all.",
    "Yeah, this morning feels like a crash. I think cleaning the kitchen yesterday set it off.",
    "The fog is bad today, maybe a four.",
    "Actually the fog is more like a three, not four.",
    "No, nothing else this morning.",
    "Mostly rested, except the kitchen — that felt like a four, maybe half an hour.",
    "That was everything, yes.",
    // Slack turns: the canned script can't adapt to which box is asking, so
    // give every box enough generic answers to drain its turn budget.
    "No, nothing else.",
    "That's all, really.",
    "Nothing more today.",
    "My energy is a two.",
    "A two, yes.",
    "Two out of five.",
  ],
  crisis: [
    "Honestly pretty wiped out today.",
    "I slept okay I guess.",
    "Honestly some days I think about hurting myself, it's all too much.",
    "Thank you. It helps that you listen.",
  ],
  canttalk: ["I'm sorry, I really can't talk today.", "No — I need to stop now, sorry."],
};

let finalized: { summary: string; energyScore: number; flags?: string[] } | null = null;
let analysis: Analysis | null = null;
let disconnected = false;
const transcript: string[] = [];

const userData: CheckinUserData = {
  sessionId,
  locale,
  healthSnapshot: null,
  symptomPanel: ["fatigue", "brain_fog"],
};

const root = voice.Agent.create<CheckinUserData>({
  id: "checkin-root",
  instructions:
    "You coordinate a daily voice check-in and never speak unprompted. If the user speaks anyway, reply with a few warm spoken words in their language — no questions, no lists, no advice, and natural idiomatic phrasing only (never translated-sounding lines like 'danke fürs Teilen').",
  tools: {},
  onEnter: (actx) =>
    runCheckin(actx, {
      analyze: async () => {
        analysis = await analyzeTranscript(transcript.join("\n"), locale);
        return analysis;
      },
      persist: (a) => persistRecords(sessionId, a),
      finalize: async (s) => {
        finalized = s;
        await finalize(sessionId, s);
      },
      disconnect: () => {
        disconnected = true;
      },
      warmupMs: 0,
    }),
});

const session = new voice.AgentSession<CheckinUserData>({
  llm: new openai.LLM({ model: "gpt-5.4-mini", reasoningEffort: "low" }),
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
  console.log(`  ${item.role === "user" ? "USER " : "AGENT"} | ${text}`);
  transcript.push(`${item.role}: ${text}`);
  void appendTranscript(sessionId, item.role, text).catch((e) =>
    console.error("append transcript failed", e)
  );
});

await session.start({ agent: root });

for (const turn of TURNS[scenario]) {
  if (disconnected) break;
  await session.run({ userInput: turn }).wait();
}

// Let the runner's tail (summary → finalize → goodbye → disconnect) finish.
for (let i = 0; i < 60 && !disconnected && scenario !== "crisis"; i++) {
  await new Promise((r) => setTimeout(r, 500));
}
await new Promise((r) => setTimeout(r, 1000));

const currentAgentId = session.currentAgent.id;
console.log("\n--- result ---");
console.log(
  JSON.stringify(
    { scenario, finalized, disconnected, currentAgentId, userData: { ...userData } },
    null,
    2
  )
);

const f = finalized as { summary: string; energyScore: number; flags?: string[] } | null;
const a = analysis as Analysis | null;
const failures: string[] = [];
if (scenario === "happy") {
  if (!f) failures.push("did not finalize");
  if (!disconnected) failures.push("did not disconnect");
  if (!a || a.symptoms.length < 1) failures.push("no symptoms extracted");
  if (!a || a.activities.length < 1) failures.push("no activities extracted");
  if (a?.hadPEMToday !== true) failures.push("crash not extracted");
  if (a?.energyScore !== 2) failures.push(`energy ${a?.energyScore} !== 2`);
}
if (scenario === "crisis") {
  if (f) failures.push("finalized during crisis");
  if (disconnected) failures.push("disconnected during crisis");
  if (currentAgentId !== "crisis") failures.push(`current agent ${currentAgentId} !== crisis`);
}
if (scenario === "canttalk") {
  if (!f) failures.push("did not finalize");
  if (!f?.flags?.includes("cant_talk")) failures.push("missing cant_talk flag");
  if (!disconnected) failures.push("did not disconnect");
}

if (failures.length) {
  console.error(`SMOKE ${scenario} FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`SMOKE ${scenario} PASSED`);
process.exit(0);
