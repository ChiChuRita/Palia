# HealthKit integration plan

What goes through HealthKit vs the voice agent, and why.

## Principle

ME/CFS tracking has two layers:

1. **Objective biomarkers** — measurable without input. Best from HealthKit.
2. **Subjective state** — only the patient can report. Best from voice.

The voice agent should never ask about anything HealthKit already knows.
Conversely, HealthKit can't ask "did today feel like a crash from
Saturday?" — that's what voice is for.

## Tier 1 — Pull passively from HealthKit (no input)

These should be read on every check-in via `react-native-health` and either
(a) passed into `get_health_context` so the agent can reference them, or
(b) surfaced silently on the Today view.

| HKQuantityTypeIdentifier        | Why for ME/CFS                                                                                                                                         | When to read                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `heartRateVariabilitySDNN`      | Single best autonomic proxy. Patients track this religiously (Visible's wedge is HRV-via-camera). Low HRV vs personal baseline predicts PEM by 24–48h. | Overnight sample, last 7 days for trend |
| `restingHeartRate`              | Elevated RHR + low HRV is the canonical PEM early-warning duet                                                                                         | Last 14 days                            |
| `sleepAnalysis` (category)      | Duration + stage breakdown. Patients sleep 9h and still feel wrecked → distinct from healthy sleep architecture.                                       | Last night                              |
| `appleSleepingWristTemperature` | Subfebrile / temperature dysregulation is a CCC neuroendocrine criterion. Deviation from personal baseline = immune flare.                             | Last 7 nights                           |
| `respiratoryRate`               | Elevated overnight respiratory rate correlates with viral reactivation episodes in ME/CFS (still emerging research)                                    | Last 7 nights                           |
| `stepCount`                     | Objective exertion load. Crashed patients drop to <500 steps/day.                                                                                      | Yesterday + 7-day avg                   |
| `walkingHeartRateAverage`       | Inappropriate tachycardia on minimal exertion = OI/POTS signal                                                                                         | Yesterday                               |
| `oxygenSaturation`              | LC patients sometimes desaturate on exertion (silent hypoxia residual)                                                                                 | Last 24h                                |

## Tier 2 — Voice-only (the agent must ask)

These are subjective and HealthKit cannot capture them. The agent owns
each of these via `record_symptom`, `record_activity`, or
`record_session_context`.

| Field                   | Why voice                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Symptom severity (1–5)  | Two people with identical HRV experience different severities. Only the patient can rate.                              |
| PEM presence today      | Requires the patient to link today's state to past exertion. No biomarker captures the causal feeling.                 |
| Brain fog quality       | "Words won't come" vs "can't focus" vs "blank screen" — texture matters; biometrics are blind here.                    |
| Unrefreshing-sleep flag | Sleep duration is objective; the _feeling_ of restoration is not.                                                      |
| Pain location/quality   | Headache vs muscle vs joint — taxonomic discrimination needs language.                                                 |
| Sensitivity flares      | Lights, sounds, smells, chemicals — episodic, not measurable.                                                          |
| Mood                    | Self-rated affect. State of Mind in HealthKit exists but requires manual entry.                                        |
| Activity type           | HealthKit knows steps; doesn't know "showered" vs "had a hard call" — both are exertion, very different recovery cost. |

## Tier 3 — Hybrid (HealthKit primes the question)

The agent uses HealthKit context to ask a sharper question — closing the
loop between objective and subjective.

| Trigger (HealthKit)              | Agent prompt example                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| HRV down >15% vs 7-day baseline  | "I noticed your HRV is lower than usual — anything feel off?"                                   |
| RHR up >5bpm vs baseline         | "Your resting heart rate is a bit higher today — does the body feel revved up?"                 |
| Wrist temp +0.3°C above baseline | "Looks like you ran a bit warm overnight — any flu feeling today?"                              |
| Steps <500 yesterday             | "It looks like a quiet day yesterday — was that rest, or did you not feel up to moving?"        |
| Sleep <5h                        | "Sleep was short — how's the head right now?"                                                   |
| Walking HR avg >120bpm           | "I see the heart was working hard on a short walk yesterday — any standing-up dizziness today?" |

## Implementation notes (deferred)

- **Library**: `react-native-health` (community-maintained, well-typed)
- **Plugin**: add `expo-build-properties` + the `react-native-health`
  config plugin to `app.json` to set `NSHealthShareUsageDescription` and
  the `HealthKit` capability.
- **Permission**: granular per-type. Ask for the seven HKQuantityType reads
  above + sleepAnalysis + state-of-mind (optional).
- **Where to read**: from the agent worker (Node) we can't — HealthKit is
  iOS-only. Read on the client in `useVoiceSession()` right before
  `mintToken`, attach a JSON `healthContext` to the LiveKit token metadata.
  The agent reads it from `participant.metadata` just like the locale.
- **Baselines**: store per-device 7-day rolling averages of HRV / RHR /
  temp in Convex so we can flag deviations. Not in HealthKit's
  responsibility.
- **Caching**: HealthKit reads are slow; debounce + cache last value for
  the duration of one session.
- **Onboarding**: add a 4th screen to the onboarding flow asking for
  HealthKit permission (with a "skip" — the app must still work without
  it; not everyone owns an Apple Watch).

## What we are NOT going to pull from HealthKit

- **State of Mind** (iOS 17+) — requires the user to open the Health app
  and tap. Worse UX than asking via voice.
- **Workout data** — patients aren't working out; reading this would feel
  off-tone.
- **Menstrual cycle** — high-value for ME/CFS research (symptoms cycle
  with hormones, per the digital-health preprint Visible co-authored),
  but better collected via the voice agent on Day 1 of the cycle than
  pulled silently. Future iteration.
