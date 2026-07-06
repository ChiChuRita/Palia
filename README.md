# Palia

A voice-first companion for people living with **ME/CFS** and **Long COVID**.

Most symptom-tracking apps fail the same way: they demand manual logging at exactly
the moment a patient is too crashed to log. Palia's wedge is a calm, conversational
voice check-in that gathers symptom and activity data with **zero typing** — built
for brain-fog days when tapping through a form is too much.

## What it does

- **Daily voice check-in** — a gentle, ME/CFS-aware interviewer asks how you're
  doing, listens, and records symptoms and activities in your own words. No streaks,
  no goals, no pressure.
- **Passive health context** — with permission, Palia reads Apple HealthKit
  (HRV, resting heart rate, sleep, steps) and lets the agent reference it softly
  ("your HRV is a bit lower than usual — anything feel off?"). Read-only, never written.
- **Today & history views** — a quiet energy-envelope summary and a week-at-a-glance
  recap. Edit anything the agent got wrong.
- **Bilingual** — English and German.

## Architecture

```
Expo iOS app  ──WebRTC──>  LiveKit Cloud  <──joins──  Agent worker (Node.js)
   │                                                      │
   └── Convex action mints LiveKit JWT                    └── STT→LLM→TTS pipeline
       (carries locale + health snapshot)                     (gpt-4o-transcribe ·
                                                              gpt-5.4-mini · marin TTS)
                                                              │
                          Convex backend  <──HTTPS (shared secret)──┘
                          sessions · transcripts · symptoms · activities
```

- **App** — Expo 56 / React Native 0.85 / Expo Router, `@livekit/react-native`,
  `@kingstinct/react-native-healthkit`.
- **Backend** — [Convex](https://convex.dev) (schema, mutations, queries, HTTP
  endpoint for agent writebacks, JWT minting).
- **Voice agent** — `@livekit/agents` multi-agent workflow (greeter → interview
  boxes as bounded tasks → crisis handoff), STT→LLM→TTS pipeline on OpenAI models,
  deployed to LiveKit Cloud. Lives in [`agent/`](./agent) as a separate Node project.

HealthKit data is read **on-demand** on the device and attached to the LiveKit token
metadata — no cron, no background fetch, no health data stored server-side.

## Project layout

| Path            | What                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| `src/`          | Expo app — screens, components, hooks, i18n                             |
| `convex/`       | Convex backend functions and schema                                     |
| `agent/`        | LiveKit voice agent worker (Node.js)                                    |
| `HEALTHKIT.md`  | HealthKit field tier mapping (voice vs. passive vs. hybrid)             |
| `LITERATURE.md` | Research the pacing read is grounded in (mirrors `src/lib/evidence.ts`) |

## Getting started

This walks you from a fresh clone to a working voice loop. Budget ~20 minutes the
first time (most of it is the iOS native build and creating the three accounts).

For the deep runbook — deploying the agent to LiveKit Cloud, troubleshooting, etc. —
see [`SETUP.md`](./SETUP.md).

### Prerequisites

- **Node.js 18+** and npm
- **macOS + Xcode** with an iOS simulator (or a real iPhone) — LiveKit needs a custom
  dev client and **cannot run in Expo Go**
- **Homebrew** (for the LiveKit CLI)
- Accounts/keys for the three services Palia talks to:
  - **[Convex](https://convex.dev)** — backend (free tier is fine)
  - **[LiveKit Cloud](https://cloud.livekit.io)** — WebRTC transport + agent hosting
    (create a project in an **EU/Frankfurt** region)
  - **[OpenAI](https://platform.openai.com)** — STT, LLM, and TTS (`gpt-4o-transcribe`, `gpt-5.4-mini`, `gpt-4o-mini-tts`)

### 1. Install dependencies

```bash
git clone https://github.com/ChiChuRita/Palia.git
cd Palia
npm install
cd agent && npm install && cd ..
```

### 2. Wire up Convex

```bash
# Links this checkout to a Convex dev deployment and writes .env.local
npx convex dev --once
```

Then set the backend secrets (the app mints LiveKit tokens server-side, so these live
in Convex, never in the app):

```bash
npx convex env set LIVEKIT_URL wss://your-project.livekit.cloud
npx convex env set LIVEKIT_API_KEY   <livekit-key>
npx convex env set LIVEKIT_API_SECRET <livekit-secret>
# Shared secret the agent uses to write back to Convex — generate one:
npx convex env set AGENT_SHARED_SECRET "$(openssl rand -hex 32)"
```

LiveKit key/secret/URL come from your LiveKit Cloud project's **Settings → Keys**.

### 3. Configure the voice agent

```bash
cd agent
cp .env.example .env
```

Fill in `agent/.env`:

| Var                                                      | Value                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | same as the Convex values above                                                          |
| `OPENAI_API_KEY`                                         | your OpenAI key                                                                          |
| `CONVEX_HTTP_URL`                                        | your deployment's `.convex.site` URL (see `EXPO_PUBLIC_CONVEX_SITE_URL` in `.env.local`) |
| `AGENT_SHARED_SECRET`                                    | **must match** the value you set in Convex above                                         |

### 4. Build the iOS dev client (first time only)

```bash
npm run ios:rebuild   # expo prebuild --clean && expo run:ios — ~5 min
```

Re-run this only when you add a native module or change `app.json` plugins. JS changes
hot-reload after that.

### 5. Run the whole stack

```bash
npm run dev   # starts Convex + agent worker + Expo metro, one terminal, colored logs
```

Open the app, tap **Start**, and within ~3s you should hear _"Hi. I'm here. How are
you doing right now?"_. Mention a symptom ("brain fog") and an activity ("walked to
the kitchen"), then tap **End**. Check the Convex dashboard — `sessions`,
`transcriptMessages`, `symptoms`, and `activities` tables should have new rows.

> **Note:** the iOS _simulator_ has no microphone and no real HealthKit data. For a
> true end-to-end test (mic + Apple Watch metrics), run on a physical iPhone.

### Handy scripts

| Command                | What                               |
| ---------------------- | ---------------------------------- |
| `npm run dev`          | Convex + agent + Expo, all at once |
| `npm run ios:rebuild`  | Clean prebuild + native iOS build  |
| `npm run typecheck`    | `tsc --noEmit`                     |
| `npm run lint`         | `expo lint`                        |
| `npm run deploy:agent` | Deploy the agent to LiveKit Cloud  |

Environment variables (LiveKit, OpenAI, and the agent shared secret) live in Convex
env vars and the agent's local `.env` — both gitignored, never committed.

## Status

Early MVP. iOS-only for now (HealthKit); Android Health Connect is a later
consideration. No auth yet — the device is the user for the prototype.
