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
   └── Convex action mints LiveKit JWT                    └── OpenAI gpt-realtime-2
       (carries locale + health snapshot)                     voice interviewer
                                                              │
                          Convex backend  <──HTTPS (shared secret)──┘
                          sessions · transcripts · symptoms · activities
```

- **App** — Expo 56 / React Native 0.85 / Expo Router, `@livekit/react-native`,
  `@kingstinct/react-native-healthkit`.
- **Backend** — [Convex](https://convex.dev) (schema, mutations, queries, HTTP
  endpoint for agent writebacks, JWT minting).
- **Voice agent** — `@livekit/agents` + OpenAI Realtime, deployed to LiveKit Cloud.
  Lives in [`agent/`](./agent) as a separate Node project.

HealthKit data is read **on-demand** on the device and attached to the LiveKit token
metadata — no cron, no background fetch, no health data stored server-side.

## Project layout

| Path | What |
| --- | --- |
| `src/` | Expo app — screens, components, hooks, i18n |
| `convex/` | Convex backend functions and schema |
| `agent/` | LiveKit voice agent worker (Node.js) |
| `HEALTHKIT.md` | HealthKit field tier mapping (voice vs. passive vs. hybrid) |

## Getting started

```bash
npm install

# Start the Convex backend (dev deployment)
npx convex dev

# Run the voice agent worker locally
cd agent && npm install && npm run dev

# Build & run the iOS app (custom dev client — LiveKit can't run in Expo Go)
npx expo run:ios
```

Environment variables (LiveKit, OpenAI, and the agent shared secret) live in Convex
env vars and the agent's local `.env` — never committed.

## Status

Early MVP. iOS-only for now (HealthKit); Android Health Connect is a later
consideration. No auth yet — the device is the user for the prototype.
