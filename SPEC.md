# Palia — Product Spec & Requirements

Voice-first companion for **ME/CFS & Long COVID**. This document lists every feature we
want, prioritized, plus the carved-out scope for the first prototype.

## Context — why this exists / the wedge

The market leader, **Visible**, requires a **proprietary ~$80 Polar armband** plus a
**$180–260/yr** subscription, has **no Apple Watch support**, and still makes users tap
through daily logs. Every other tracker (Bearable, Flaredown, Mymee, HRV apps) is either a
generic manual-form tracker or HRV-only — none is ME/CFS-aware *and* low-friction.

Research confirms two unmet needs: **~82% of Long COVID patients prefer voice over typing**,
and HR/HRV-based **pacing is evidence-based** for preventing PEM (post-exertional malaise).
**No competitor occupies "voice capture + passive (your own watch) + AI daily analysis."**
That triad is our white space.

### Three differentiation pillars
1. **Passive, no proprietary hardware** — read from the watch you already own via Apple
   Health (Apple Watch) and Android Health Connect (Samsung, Fitbit, Oura). Just wear it.
2. **Zero-typing voice capture** — a calm ~2-min daily voice check-in.
3. **Two-stage AI** — a *fast realtime* model **captures** (talking); a *separate, more
   capable* model (gpt-5.5; latency irrelevant) runs **once daily** to **analyze**
   (thinking): energy envelope, PEM risk, crash root-cause. Decoupling capture from
   analysis is the architectural bet.

### Honest constraints (from research)
- Apple does **not** expose **wrist temperature** to third-party apps → not in our health set.
- "Common smartwatches" passively = Apple Watch + (via Health Connect) Samsung / Fitbit /
  Oura. **Garmin & WHOOP HRV are largely not exposed** — position accordingly.
- Core passive triad for ME/CFS: **HRV (SDNN) · resting HR · sleep · activity timing**.
  Defensible PEM signal: morning HRV ↓ >15% vs baseline + RHR ↑ >5% vs 7-day avg + short/
  fragmented sleep.

## Current state — already built (✅)
Voice capture pipeline (LiveKit + gpt-realtime-2), sessions/symptoms/activities/transcript
data model, research-grounded taxonomy, Today view, history/explore (weekly aggregates,
transcript replay, post-call edit), onboarding (language/mic/health), EN/DE i18n, **Bot Lab**
(5 voice variants), Android Health Connect readers, Convex backend + cron cleanup.

**Critical gap:** iOS HealthKit readers in `src/lib/health.ts` are **stubbed (return null)**,
and health is only passed transiently via token metadata — **never stored**. No baselines,
no trends, nothing for an analyst to read yet.

---

## Feature spec — every feature, prioritized
Legend: ✅ built · 🎯 **P0 (first prototype)** · ▶️ P1 (next) · 📋 P2 (vision)

### 1 · Capture — voice check-in
- ✅ Realtime voice agent; records symptoms/activities/sleep/PEM; corrections; transcript.
- ✅ Bilingual (EN/DE); Bot Lab 5 variants.
- 🎯 **Lock the winning voice** (default **A · Marin**) + tighten flow.
- ▶️ Agent references stored baselines ("your HRV is lower than usual — anything off?").
- 📋 Voice biomarkers (vocal fatigue / brain-fog signal) — emerging research.

### 2 · Passive health — the wedge (enabler for the AI insight)
- ✅ Android Health Connect reads (HRV RMSSD, RHR, sleep, steps).
- 🎯 **Implement the stubbed iOS HealthKit reads**: HRV (SDNN), resting HR, sleep hours, steps.
- 🎯 **Store a daily snapshot** in Convex + compute **7-day baselines** (HRV, RHR).
- ▶️ Heart-rate recovery, respiratory rate; richer sleep (fragmentation / WASO).
- 📋 Real-time HR streaming for live overexertion alerts.

### 3 · Stage-2 daily analyst — the brain (🎯 headline)
- 🎯 **Daily energy envelope**: green / yellow / red from the PEM signal.
- 🎯 **Plain-language daily insight** (2–4 sentences) + **top suspected trigger**, from
  today's health snapshot + voice-captured symptoms/activities + recent history.
- ▶️ PEM **48h forecast**; **weekly pattern**; treatment-response tracker.
- 📋 **Clinician-ready PDF report**; symptom×trigger correlation heatmap; doctor-question prep.
- **PEM signal (daily):** `(baselineHRV − morningHRV)/baselineHRV > 0.15` OR
  `(RHR − rhr7dAvg)/rhr7dAvg > 0.05` OR `sleepHours < 5` → elevate risk; map to R/Y/G.
- **Architecture:** daily Convex cron → action batches snapshot+symptoms to **gpt-5.5** →
  writes an `insights` row. Also a manual **"Analyze now"** trigger.

### 4 · Surfacing insights (UI)
- 🎯 **Energy-envelope insight card** on Today + a simple **Insights tab** ("Analyze now").
- ▶️ Trends/charts: energy line, symptom frequency, HRV/RHR over 7/30 days.
- 📋 Apple Watch complication; check-in reminder + insight notification.

### 5 · Pacing guidance
- ▶️ Personal **safe-HR zone** estimate; "energy budget left this week".
- 📋 Live overexertion alert; activity-cost ledger.

### 6 · Sharing / clinician
- 📋 PDF/CSV export; shareable read-only report link; appointment-prep summary.

### 7 · Platform / infra
- ✅ Convex + LiveKit + Expo (iOS working; Android partial).
- ▶️ Auth + multi-device sync (today deviceId = user).
- 📋 Notifications, offline queueing, E2E-encrypted transcripts, automated tests.

---

## 🎯 First prototype (P0) — demo story
**"Wear the watch you already own, talk for two minutes, get AI pacing guidance."**
Demoed on a **real iPhone**.

1. **Real iOS HealthKit reads** — implement the stubbed readers in `src/lib/health.ts`.
2. **Persist daily health** — `convex/health.ts` `upsertSnapshot` + `healthSnapshots` table +
   7-day baselines. Client calls it on app open / after a check-in.
3. **Polished voice capture** — lock one Bot Lab voice (default **A · Marin**).
4. **Stage-2 analyst** — `convex/insights.ts` action: snapshot + today's symptoms + last 7
   days → gpt-5.5 → `{ energyLevel, pemRisk, summary, topTrigger, recommendation }` → row.
   Daily cron + manual `analyzeToday`.
5. **Insight card + Insights tab** — render the R/Y/G envelope + summary on Today and a tab.

Non-goals for the prototype: trends/charts, PEM 48h forecast, clinician export, auth, Android.

## Data model additions (`convex/schema.ts`)
- **`healthSnapshots`**: `deviceId`, `dateKey` (YYYY-MM-DD local), `hrvMs`, `hrvBaselineMs`,
  `restingHrBpm`, `rhrBaseline7d`, `sleepHours`, `steps`, `capturedAt`; index
  `by_device_date` on `["deviceId","dateKey"]`.
- **`insights`**: `deviceId`, `dateKey`, `energyLevel` (green|yellow|red), `pemRisk`
  (low|medium|high), `summary`, `topTrigger?`, `recommendation?`, `model`, `createdAt`;
  index `by_device_date`.

## Verification (end-to-end on a real iPhone)
1. `npm run dev`; build to a physical iPhone (`npm run ios`), grant Health + mic.
2. App open writes a `healthSnapshots` row with real HRV/RHR/sleep/steps + a baseline.
3. Voice check-in persists symptoms/activities (existing flow).
4. **Analyze now** (or cron) writes an `insights` row with a sane `energyLevel` + readable
   `summary` + `topTrigger`.
5. Insight card shows on Today and the Insights tab, in EN and DE.
6. `npm run typecheck` + `npm run lint` green.
