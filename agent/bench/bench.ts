// Voice-pipeline model benchmark — picks the OpenAI models for the agent rebuild.
//
// Measures, per candidate (median of N runs, EN + DE):
//   LLM  — streaming TTFT + total, tool-call correctness (deterministic),
//          conversation quality (gpt-5.5 judge, voice rubric)
//   STT  — batch transcription wall-time + word error rate vs known reference
//          (audio synthesized via TTS, so the reference text is exact)
//   TTS  — streaming time-to-first-byte + total, short + long replies
//
// Run:  OPENAI_API_KEY=sk-... npx tsx bench/bench.ts
// Cost: well under $1. Writes agent/bench/results.md and prints the tables.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.openai.com/v1";
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error("OPENAI_API_KEY not set");
  process.exit(1);
}

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const LATENCY_RUNS = 5;
const CORRECTNESS_RUNS = 3;

type Locale = "en" | "de";

// ── Candidates ──────────────────────────────────────────────────────────────

type LlmCandidate = { model: string; effort?: string };
const LLM_CANDIDATES: LlmCandidate[] = [
  { model: "gpt-5.4-mini", effort: "minimal" },
  { model: "gpt-5.4-mini", effort: "low" },
  { model: "gpt-5.4", effort: "minimal" },
  { model: "gpt-5.2", effort: "minimal" },
  { model: "gpt-5.1-chat-latest" },
  { model: "gpt-4.1-mini" }, // old-gen baseline
];
const STT_MODELS = ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"];
const TTS_VOICES = ["marin", "sage"];
const JUDGE_MODEL = "gpt-5.5";

// ── Shared bench fixtures ───────────────────────────────────────────────────

// Narrow interviewer prompt slice — mirrors the tone rules the rebuilt agent
// will use (distilled from agent/src/interviewer.ts).
const BENCH_SYSTEM: Record<Locale, string> = {
  en: `You are a gentle daily voice check-in companion for someone with ME/CFS or Long COVID. Rules:
- One short sentence per turn, under 15 words, ending in exactly one question.
- Warm and human, like a calm friend. Never assistant-speak, never "how can I help".
- Mirror their words ("foggy" -> "fog"). Never give medical advice or suggest exercise.
- When they mention a symptom, call record_symptom BEFORE speaking; never narrate that you recorded it.
- If they correct a detail, call correct_last_symptom with only the changed fields.
- If they say they can't talk right now, call cant_talk_now and say one warm goodbye.
- If they go off topic, gently redirect once to how they're feeling.`,
  de: `Du bist ein sanfter täglicher Sprach-Check-in-Begleiter für jemanden mit ME/CFS oder Long COVID. Regeln:
- Ein kurzer Satz pro Runde, unter 15 Wörter, endet mit genau einer Frage.
- Warm und menschlich, wie ein ruhiger Freund. Nie Assistenten-Sprache, nie "Wie kann ich helfen".
- Spiegle ihre Worte ("neblig" -> "Nebel"). Nie medizinische Ratschläge, nie Sport vorschlagen.
- Bei einem Symptom rufe record_symptom auf, BEVOR du sprichst; erzähle nie, dass du etwas aufgezeichnet hast.
- Bei einer Korrektur rufe correct_last_symptom nur mit den geänderten Feldern auf.
- Wenn sie nicht sprechen können, rufe cant_talk_now auf und verabschiede dich warm.
- Bei Off-Topic lenke einmal sanft zurück zum Befinden.`,
};

// Mirrors the zod schemas in agent/src/tools.ts.
const BENCH_TOOLS = [
  {
    type: "function",
    function: {
      name: "record_symptom",
      description: "Record a symptom the user mentioned.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: [
              "fatigue",
              "pem",
              "brain_fog",
              "unrefreshing_sleep",
              "pain",
              "orthostatic",
              "flu_feeling",
              "other",
            ],
          },
          userWords: { type: "string" },
          severity: { type: "integer", minimum: 0, maximum: 5 },
        },
        required: ["category", "userWords"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "correct_last_symptom",
      description: "Correct the most recently recorded symptom. Only include changed fields.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string" },
          userWords: { type: "string" },
          severity: { type: "integer", minimum: 0, maximum: 5 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_session_context",
      description: "Record sleep hours and/or whether the user had a crash (PEM) today.",
      parameters: {
        type: "object",
        properties: {
          sleepHours: { type: "number", minimum: 0, maximum: 14 },
          hadPEMToday: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cant_talk_now",
      description: "The user cannot talk right now; end the check-in gracefully.",
      parameters: { type: "object", properties: {} },
    },
  },
];

type Msg = { role: "system" | "user" | "assistant"; content: string };
const history = (locale: Locale, ...turns: Msg[]): Msg[] => [
  { role: "system", content: BENCH_SYSTEM[locale] },
  ...turns,
];

// The latency-representative turn: user reports a symptom mid-interview.
const LATENCY_TURN: Record<Locale, Msg[]> = {
  en: history(
    "en",
    { role: "assistant", content: "Did anything else feel off today?" },
    { role: "user", content: "My head is really foggy, words keep slipping away." }
  ),
  de: history(
    "de",
    { role: "assistant", content: "Hat sich heute sonst noch etwas komisch angefühlt?" },
    { role: "user", content: "Mein Kopf ist total neblig, mir entgleiten ständig die Wörter." }
  ),
};

// Tool-correctness cases: expected tool + args checked deterministically.
type ToolCase = {
  id: string;
  messages: Msg[];
  expectTool: string;
  checkArgs?: (args: Record<string, unknown>) => string | null; // null = pass
};
const TOOL_CASES: ToolCase[] = [
  {
    id: "symptom-en",
    messages: history(
      "en",
      { role: "assistant", content: "Did anything else feel off today?" },
      { role: "user", content: "My head is foggy, maybe a three." }
    ),
    expectTool: "record_symptom",
    checkArgs: (a) =>
      a.category !== "brain_fog"
        ? `category=${a.category}`
        : a.severity !== 3
          ? `severity=${a.severity}`
          : null,
  },
  {
    id: "correction-en",
    messages: history(
      "en",
      { role: "assistant", content: "How heavy is the fatigue, one to five?" },
      { role: "user", content: "A four, I think." },
      { role: "assistant", content: "That sounds heavy. Did you sleep okay?" },
      { role: "user", content: "Actually the fatigue is more like a two." }
    ),
    expectTool: "correct_last_symptom",
    checkArgs: (a) =>
      a.severity !== 2 ? `severity=${a.severity}` : a.category ? "sent unchanged category" : null,
  },
  {
    id: "cant-talk-de",
    messages: history("de", {
      role: "user",
      content: "Tut mir leid, ich kann heute wirklich nicht sprechen.",
    }),
    expectTool: "cant_talk_now",
  },
];

// Quality cases: judged by gpt-5.5 against the voice rubric.
type QualityCase = { id: string; locale: Locale; messages: Msg[] };
const QUALITY_CASES: QualityCase[] = [
  {
    id: "greeting-reply-en",
    locale: "en",
    messages: history(
      "en",
      { role: "assistant", content: "Good morning. I'm here. How are you feeling this morning?" },
      { role: "user", content: "Honestly pretty wiped out today." }
    ),
  },
  {
    id: "symptom-followup-en",
    locale: "en",
    messages: history(
      "en",
      { role: "assistant", content: "Is the fog heavy today?" },
      { role: "user", content: "Yeah, it's bad. I keep losing my train of thought mid-sentence." }
    ),
  },
  {
    id: "off-topic-en",
    locale: "en",
    messages: history("en", {
      role: "user",
      content: "Can you tell me what the weather will be like tomorrow?",
    }),
  },
  {
    id: "greeting-reply-de",
    locale: "de",
    messages: history(
      "de",
      { role: "assistant", content: "Guten Morgen. Ich bin da. Wie fühlst du dich heute Morgen?" },
      { role: "user", content: "Ehrlich gesagt ziemlich erschöpft heute." }
    ),
  },
  {
    id: "symptom-followup-de",
    locale: "de",
    messages: history(
      "de",
      { role: "assistant", content: "Ist der Nebel heute stark?" },
      { role: "user", content: "Ja, ziemlich. Ich verliere mitten im Satz den Faden." }
    ),
  },
  {
    id: "off-topic-de",
    locale: "de",
    messages: history("de", {
      role: "user",
      content: "Kannst du mir sagen, wie das Wetter morgen wird?",
    }),
  },
];

// STT reference utterances (synthesized via TTS so the reference is exact).
const STT_UTTERANCES: Record<Locale, string[]> = {
  en: [
    "I slept maybe five hours and woke up feeling completely unrefreshed.",
    "My head is foggy and my arms feel heavy, maybe a three out of five.",
    "Yesterday I walked to the kitchen and had to lie down afterwards.",
  ],
  de: [
    "Ich habe vielleicht fünf Stunden geschlafen und bin völlig gerädert aufgewacht.",
    "Mein Kopf ist neblig und meine Arme fühlen sich schwer an, vielleicht eine drei von fünf.",
    "Gestern bin ich zur Küche gelaufen und musste mich danach hinlegen.",
  ],
};

// TTS latency samples (short ≈ typical reply, long ≈ crisis/closing sentence).
const TTS_SAMPLES: Record<Locale, { short: string; long: string }> = {
  en: {
    short: "That sounds heavy. Did the fog lift at all by the afternoon?",
    long: "Thank you for telling me. Rest is healing, not weakness — I'll check in with you again tomorrow morning, okay?",
  },
  de: {
    short: "Das klingt schwer. Hat sich der Nebel am Nachmittag etwas gelichtet?",
    long: "Danke, dass du es mir erzählst. Ruhe ist Heilung, keine Schwäche — ich melde mich morgen früh wieder bei dir, okay?",
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const ms = (n: number) => `${Math.round(n)}ms`;

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
}

// Some model generations reject certain reasoning_effort values ("minimal" vs
// "none") or the param entirely. Try as configured, then degrade gracefully.
async function chatWithEffortFallback(
  body: Record<string, unknown>,
  effort: string | undefined
): Promise<Response> {
  const attempts: (string | undefined)[] = effort
    ? [effort, effort === "minimal" ? "none" : "minimal", undefined]
    : [undefined];
  let lastRes: Response | undefined;
  for (const e of attempts) {
    const b = { ...body };
    if (e) b.reasoning_effort = e;
    const res = await post("/chat/completions", b);
    if (res.ok) return res;
    const text = await res.text();
    lastRes = new Response(text, { status: res.status });
    if (!text.includes("reasoning_effort") && !text.includes("reasoning")) {
      throw new Error(`chat ${res.status}: ${text.slice(0, 300)}`);
    }
  }
  throw new Error(`chat failed after effort fallbacks: ${await lastRes?.text()}`);
}

// Streaming chat: returns TTFT (first content/tool delta) + total.
async function timeStreamingChat(cand: LlmCandidate, messages: Msg[]) {
  const start = performance.now();
  const res = await chatWithEffortFallback(
    { model: cand.model, messages, tools: BENCH_TOOLS, stream: true },
    cand.effort
  );
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let ttft: number | null = null;
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    if (ttft === null) {
      for (const line of buf.split("\n")) {
        if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
        try {
          const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta;
          if (delta?.content || delta?.tool_calls) {
            ttft = performance.now() - start;
            break;
          }
        } catch {
          // partial JSON line — wait for more
        }
      }
    }
  }
  return { ttft: ttft ?? NaN, total: performance.now() - start };
}

// Non-streaming chat: returns the message (for correctness + quality checks).
async function chatOnce(cand: LlmCandidate, messages: unknown[], withTools: boolean) {
  const res = await chatWithEffortFallback(
    { model: cand.model, messages, ...(withTools ? { tools: BENCH_TOOLS } : {}) },
    cand.effort
  );
  const json = await res.json();
  return json.choices?.[0]?.message ?? {};
}

// Mirrors the re-prompts the real tools return (agent/src/tools.ts), so the
// judged reply is what the patient would actually hear after a tool call.
function toolReprompt(name: string): string {
  if (name === "cant_talk_now") return "acknowledged. Say one warm goodbye, nothing else.";
  return "recorded. Now speak: warm words, then the next question — their thread first.";
}

// Run the model like the production loop: feed tool results back until it
// produces a spoken reply (max 3 rounds).
async function spokenReply(cand: LlmCandidate, messages: Msg[]): Promise<string> {
  const msgs: unknown[] = [...messages];
  for (let round = 0; round < 3; round++) {
    const msg = await chatOnce(cand, msgs, true);
    if (msg.content) return msg.content;
    if (!msg.tool_calls?.length) break;
    msgs.push(msg);
    for (const tc of msg.tool_calls) {
      msgs.push({ role: "tool", tool_call_id: tc.id, content: toolReprompt(tc.function.name) });
    }
  }
  return "(no spoken reply)";
}

// Word error rate via word-level Levenshtein.
function wer(reference: string, hypothesis: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .split(/\s+/)
      .filter(Boolean);
  const r = norm(reference);
  const h = norm(hypothesis);
  const d: number[][] = Array.from({ length: r.length + 1 }, (_, i) =>
    Array.from({ length: h.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1)
      );
  return r.length ? d[r.length][h.length] / r.length : 0;
}

async function judge(caseId: string, userTurn: string, reply: string, locale: Locale) {
  const res = await post("/chat/completions", {
    model: JUDGE_MODEL,
    reasoning_effort: "low",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You judge one reply from a voice check-in companion for ME/CFS patients (locale ${locale}). Score 1-10 each, strict JSON only:
{"brevity": <under 15 words, one sentence>, "one_question": <exactly one question, or zero if a goodbye/redirect>, "warmth": <human, kind, no assistant-speak>, "mirroring": <picks up the user's own words>, "safety": <no medical advice, no exercise suggestions, no alarm>, "overall": <holistic: would this feel good to a crashed patient?>}`,
      },
      {
        role: "user",
        content: `Case: ${caseId}\nUser said: "${userTurn}"\nCompanion replied: "${reply}"`,
      },
    ],
  });
  if (!res.ok) throw new Error(`judge ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return JSON.parse(json.choices[0].message.content) as Record<string, number>;
}

// ── TTS bench (also synthesizes the STT test audio) ─────────────────────────

async function ttsOnce(text: string, voice: string, locale: Locale) {
  const start = performance.now();
  const res = await post("/audio/speech", {
    model: "gpt-4o-mini-tts",
    voice,
    input: text,
    instructions:
      locale === "de"
        ? "Sprich langsam, ruhig und warm — wie ein fürsorglicher Begleiter."
        : "Speak slowly, calmly and warmly — a gentle companion.",
    response_format: "mp3",
  });
  if (!res.ok) throw new Error(`tts ${res.status}: ${await res.text()}`);
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let ttfb: number | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (ttfb === null) ttfb = performance.now() - start;
    chunks.push(value);
  }
  return {
    ttfb: ttfb ?? NaN,
    total: performance.now() - start,
    audio: Buffer.concat(chunks),
  };
}

type TtsRow = { voice: string; locale: Locale; len: string; ttfb: number; total: number };

async function benchTts(): Promise<TtsRow[]> {
  const rows: TtsRow[] = [];
  for (const voice of TTS_VOICES) {
    for (const locale of ["en", "de"] as Locale[]) {
      for (const len of ["short", "long"] as const) {
        const runs: { ttfb: number; total: number }[] = [];
        for (let i = 0; i < LATENCY_RUNS; i++) {
          runs.push(await ttsOnce(TTS_SAMPLES[locale][len], voice, locale));
        }
        rows.push({
          voice,
          locale,
          len,
          ttfb: median(runs.map((r) => r.ttfb)),
          total: median(runs.map((r) => r.total)),
        });
        console.log(
          `  tts ${voice}/${locale}/${len}: ttfb ${ms(rows.at(-1)!.ttfb)} total ${ms(rows.at(-1)!.total)}`
        );
      }
    }
  }
  return rows;
}

// ── STT bench ───────────────────────────────────────────────────────────────

type SttRow = { model: string; locale: Locale; time: number; wer: number };

async function benchStt(): Promise<SttRow[]> {
  // Synthesize reference audio once (marin, the production voice).
  const clips: { locale: Locale; text: string; audio: Buffer }[] = [];
  for (const locale of ["en", "de"] as Locale[]) {
    for (const text of STT_UTTERANCES[locale]) {
      clips.push({ locale, text, audio: (await ttsOnce(text, "marin", locale)).audio });
    }
  }
  const rows: SttRow[] = [];
  for (const model of STT_MODELS) {
    for (const locale of ["en", "de"] as Locale[]) {
      const times: number[] = [];
      const wers: number[] = [];
      for (const clip of clips.filter((c) => c.locale === locale)) {
        const form = new FormData();
        form.append("model", model);
        form.append("language", locale);
        form.append("file", new File([clip.audio], "clip.mp3", { type: "audio/mpeg" }));
        const start = performance.now();
        const res = await fetch(`${API}/audio/transcriptions`, {
          method: "POST",
          headers: { authorization: `Bearer ${KEY}` },
          body: form,
        });
        if (!res.ok) throw new Error(`stt ${model} ${res.status}: ${await res.text()}`);
        const json = await res.json();
        times.push(performance.now() - start);
        wers.push(wer(clip.text, json.text ?? ""));
      }
      rows.push({ model, locale, time: median(times), wer: median(wers) });
      console.log(
        `  stt ${model}/${locale}: ${ms(rows.at(-1)!.time)} wer ${(rows.at(-1)!.wer * 100).toFixed(1)}%`
      );
    }
  }
  return rows;
}

// ── LLM bench ───────────────────────────────────────────────────────────────

type LlmRow = {
  id: string;
  ttft: Record<Locale, number>;
  total: Record<Locale, number>;
  toolPass: string; // "8/9"
  toolFails: string[];
  quality: Record<string, number>; // averaged rubric
  samples: { caseId: string; reply: string }[];
};

async function benchLlm(): Promise<LlmRow[]> {
  const rows: LlmRow[] = [];
  for (const cand of LLM_CANDIDATES) {
    const id = cand.effort ? `${cand.model} (${cand.effort})` : cand.model;
    console.log(`  llm ${id}…`);
    try {
      // Latency (sequential, unloaded)
      const ttft = {} as Record<Locale, number>;
      const total = {} as Record<Locale, number>;
      for (const locale of ["en", "de"] as Locale[]) {
        const runs: { ttft: number; total: number }[] = [];
        for (let i = 0; i < LATENCY_RUNS; i++) {
          runs.push(await timeStreamingChat(cand, LATENCY_TURN[locale]));
        }
        ttft[locale] = median(runs.map((r) => r.ttft));
        total[locale] = median(runs.map((r) => r.total));
      }

      // Tool correctness
      let pass = 0;
      let totalChecks = 0;
      const toolFails: string[] = [];
      for (const tc of TOOL_CASES) {
        for (let i = 0; i < CORRECTNESS_RUNS; i++) {
          totalChecks++;
          const msg = await chatOnce(cand, tc.messages, true);
          const call = msg.tool_calls?.[0];
          if (!call || call.function.name !== tc.expectTool) {
            toolFails.push(`${tc.id}: called ${call?.function.name ?? "nothing"}`);
            continue;
          }
          const argErr = tc.checkArgs?.(JSON.parse(call.function.arguments || "{}")) ?? null;
          if (argErr) toolFails.push(`${tc.id}: ${argErr}`);
          else pass++;
        }
      }

      // Quality (reply generation sequential, judging parallel)
      const replies = [] as { qc: QualityCase; reply: string }[];
      for (const qc of QUALITY_CASES) {
        replies.push({ qc, reply: await spokenReply(cand, qc.messages) });
      }
      const verdicts = await Promise.all(
        replies.map(({ qc, reply }) =>
          judge(qc.id, qc.messages.at(-1)!.content, reply, qc.locale).catch(() => null)
        )
      );
      const quality: Record<string, number> = {};
      const ok = verdicts.filter(Boolean) as Record<string, number>[];
      for (const key of ["brevity", "one_question", "warmth", "mirroring", "safety", "overall"]) {
        quality[key] = ok.length ? ok.reduce((s, v) => s + (v[key] ?? 0), 0) / ok.length : NaN;
      }

      rows.push({
        id,
        ttft,
        total,
        toolPass: `${pass}/${totalChecks}`,
        toolFails,
        quality,
        samples: replies.map(({ qc, reply }) => ({ caseId: qc.id, reply })),
      });
    } catch (e) {
      console.log(`    SKIPPED (${(e as Error).message.slice(0, 120)})`);
      rows.push({
        id: `${id} — UNAVAILABLE`,
        ttft: { en: NaN, de: NaN },
        total: { en: NaN, de: NaN },
        toolPass: "-",
        toolFails: [],
        quality: {},
        samples: [],
      });
    }
  }
  return rows;
}

// ── Report ──────────────────────────────────────────────────────────────────

function buildReport(llm: LlmRow[], stt: SttRow[], tts: TtsRow[]): string {
  const L: string[] = [];
  L.push(`# Voice pipeline benchmark — ${new Date().toISOString().slice(0, 16)}Z`);
  L.push("");
  L.push(`Median of ${LATENCY_RUNS} runs per cell. Judge: ${JUDGE_MODEL}.`);
  L.push("");
  L.push("## LLM candidates");
  L.push("");
  L.push(
    "| Model | TTFT en | TTFT de | Total en | Total de | Tools | Brevity | 1-Question | Warmth | Mirroring | Safety | Overall |"
  );
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of llm) {
    const q = (k: string) => (Number.isFinite(r.quality[k]) ? r.quality[k].toFixed(1) : "-");
    L.push(
      `| ${r.id} | ${ms(r.ttft.en)} | ${ms(r.ttft.de)} | ${ms(r.total.en)} | ${ms(r.total.de)} | ${r.toolPass} | ${q("brevity")} | ${q("one_question")} | ${q("warmth")} | ${q("mirroring")} | ${q("safety")} | ${q("overall")} |`
    );
  }
  const fails = llm.flatMap((r) => r.toolFails.map((f) => `- ${r.id}: ${f}`));
  if (fails.length) {
    L.push("");
    L.push("Tool-check failures:");
    L.push(...fails);
  }
  L.push("");
  L.push("## STT (batch wall-time — streaming will be faster; ranks models relatively)");
  L.push("");
  L.push("| Model | en time | en WER | de time | de WER |");
  L.push("|---|---|---|---|---|");
  for (const model of STT_MODELS) {
    const en = stt.find((r) => r.model === model && r.locale === "en")!;
    const de = stt.find((r) => r.model === model && r.locale === "de")!;
    L.push(
      `| ${model} | ${ms(en.time)} | ${(en.wer * 100).toFixed(1)}% | ${ms(de.time)} | ${(de.wer * 100).toFixed(1)}% |`
    );
  }
  L.push("");
  L.push("## TTS (gpt-4o-mini-tts)");
  L.push("");
  L.push("| Voice | Locale | Length | TTFB | Total |");
  L.push("|---|---|---|---|---|");
  for (const r of tts)
    L.push(`| ${r.voice} | ${r.locale} | ${r.len} | ${ms(r.ttfb)} | ${ms(r.total)} |`);
  L.push("");
  L.push("## Sample replies (what the judge scored)");
  L.push("");
  for (const qc of QUALITY_CASES) {
    L.push(`**${qc.id}** — user: "${qc.messages.at(-1)!.content}"`);
    L.push("");
    for (const r of llm) {
      const s = r.samples.find((s) => s.caseId === qc.id);
      if (s) L.push(`- ${r.id}: "${s.reply}"`);
    }
    L.push("");
  }
  L.push("## Estimated pipeline turn latency (STT batch + LLM TTFT + TTS TTFB, en)");
  L.push("");
  L.push("| LLM | + gpt-4o-transcribe | + whisper-1 |");
  L.push("|---|---|---|");
  const ttsTtfb = median(
    tts.filter((r) => r.voice === "marin" && r.len === "short").map((r) => r.ttfb)
  );
  for (const r of llm.filter((r) => Number.isFinite(r.ttft.en))) {
    const est = (sttModel: string) => {
      const s = stt.find((x) => x.model === sttModel && x.locale === "en")!;
      return ms(s.time + r.ttft.en + ttsTtfb);
    };
    L.push(`| ${r.id} | ${est("gpt-4o-transcribe")} | ${est("whisper-1")} |`);
  }
  L.push("");
  return L.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log("TTS…");
const tts = await benchTts();
console.log("STT…");
const stt = await benchStt();
console.log("LLM…");
const llm = await benchLlm();

const report = buildReport(llm, stt, tts);
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "results.md"), report);
console.log(`\n${report}\nWritten to bench/results.md`);
