# Palia — Research & Literature

Every source the app's pacing read is grounded in. These are the human-vetted
citations pinned in `src/lib/evidence.ts` (the "science behind this" screen);
the analyst LLM can only tag insights against this allow-list and never emits
its own citations. Thresholds in the deterministic PEM signal
(`convex/insights.ts`) are tuned from the same sources.

## Clinical guidelines

- **NICE NG206 — ME/CFS: diagnosis and management (2021)**
  <https://www.nice.org.uk/guidance/ng206>
  UK national guideline. Basis for the app's tone rules (validate, never
  prescribe exercise or "pushing through") and general pacing guidance.

- **CDC — Treating the most disruptive symptoms first and preventing worsening of symptoms**
  <https://www.cdc.gov/me-cfs/hcp/clinical-care/treating-the-most-disruptive-symptoms-first-and-preventing-worsening-of-symptoms.html>
  PEM avoidance: rest and activity management to prevent symptom worsening.

- **Bateman Horne Center — ME/CFS criteria-specific guidance for providers**
  <https://batemanhornecenter.org/providers/mecfs/criteria-specific-guidance/>
  Diagnostic criteria (incl. unrefreshing sleep), activity intolerance,
  orthostatic strain, and management guidance. Backs the resting-HR strain,
  sleep-quality, and energy-envelope reads.

## Heart-rate & HRV-based pacing

- **Workwell Foundation — Pacing with a heart-rate monitor to minimize PEM in ME/CFS and Long COVID**
  <https://workwellfoundation.org/pacing-with-a-heart-rate-monitor-to-minimize-post-exertional-malaise-pem-in-me-cfs-and-long-covid/>
  The core HR-monitored pacing method. Source of the HRV-drop and
  resting-HR-elevation flag thresholds.

- **ME Association — Feasibility of heart-rate-monitored pacing (2025, Fatigue: Biomedicine, Health & Behavior)**
  <https://www.tandfonline.com/doi/full/10.1080/21641846.2025.2565103>
  Recent feasibility study of HR-monitor-guided pacing in ME/CFS.

- **Marco Altini — On heart rate variability (HRV) and readiness**
  <https://medium.com/@altini_marco/on-heart-rate-variability-hrv-and-readiness-394a499ed05b>
  (HRV4Training) Interpreting morning HRV vs. personal baseline — why a
  15–20 % drop below your usual is a meaningful load signal.

## Energy envelope & pacing practice

- **American ME and CFS Society — Pacing**
  <https://ammes.org/pacing/>
  The energy-envelope concept: staying within available energy to avoid crashes.

- **Patient-Led Research Collaborative — Clinician's pacing and management guide for ME/CFS and Long COVID**
  <https://patientresearchcovid19.com/clinicians-pacing-and-management-guide-for-me-cfs-and-long-covid/>
  Patient-researcher-authored pacing guide for clinicians.

## Peer-reviewed primary studies (2020–2026)

Added from a systematic search + 3-vote adversarial verification (2026-07-06).
These are the primary-literature backing behind the guideline/practitioner
sources above — cited here as the evidence base, not (yet) pinned into
`evidence.ts` for the in-app "science" screen.

### HRV-guided pacing & PEM

- **Ruijgt / Wüst et al. — Autonomic recovery after exertion in Long COVID (medRxiv 2025)**
  <https://www.medrxiv.org/content/10.1101/2025.03.18.25320115v1>
  127 LC patients vs 21 controls: HRV lower during activity/sleep and stayed
  depressed for 24 h after exercise in patients only — a physiological basis
  for next-morning pacing.
- **Clague-Baker et al. — Feasibility of HR-monitored pacing (Fatigue, 2025)**
  <https://www.tandfonline.com/doi/full/10.1080/21641846.2025.2565103>
  47 participants: HR-monitor pacing feasible and acceptable, no serious
  adverse events, 89 % still using it at 8 weeks; participants reported it
  helped them avoid PEM. (Same DOI as the ME Association entry above.)
- **HRV-biofeedback Phase-II feasibility trial (PMC12347631)**
  <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12347631/>
  10 sessions of HRV-biofeedback significantly reduced severe fatigue vs
  controls (H = 4.083, p = 0.043).

### Resting-HR / HRV as a strain signal

- **Persistent post-COVID heart-rate elevation (Nature Scientific Reports 2025)**
  <https://www.nature.com/articles/s41598-025-15208-0>
  Large wearable cohort (663 COVID+ vs 2,513 controls): the commonest
  persistent change is elevated nightly HR averaging ~7 bpm (~13 % above
  baseline) for months, with RMSSD dropping ~65 → ~45 ms in the persistent
  subgroup. Caveat: cohort largely asymptomatic — the PEM-warning framing is
  inferential.

### Sleep as a day-to-day capacity predictor

- **Rusinek et al. — Actigraphy in Long COVID (PMC10856322, 2024)**
  <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10856322/>
  61 LC patients: 16.6 awakenings/night, 61 min WASO, preserved total sleep
  time — LC sleep is _fragmented_, not short. Supports asking about restful
  quality over hours.
- **Daily-diary sleep → next-day fatigue (BMC Geriatrics 2023, PMC10704841)**
  <https://link.springer.com/article/10.1186/s12877-023-04539-0>
  7-day within-person study: sleep quality _and_ time-in-bed independently
  predicted next-day fatigue. Caveat: older-adult cohort, adjacent to ME/CFS.

### Energy-envelope theory & pacing outcomes

- **O'Connor / Jason et al. — Energy envelope, n=461 (PMC5750135, 2019)**
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC5750135/>
  Staying within the envelope reduces flares; overexerters with higher
  available energy fared no better than lower-energy patients.
- **Jason et al. — Envelope theory review + RCT, n=114 (PMC3596172)**
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC3596172/>
  Operationalizes daily energy balance and reports improved physical
  functioning and fatigue severity for those who maintain it. Distinct from
  (discredited) GET.

### Consumer-wearable validity — a design constraint

- **Living meta-analysis of consumer wearables (npj Digital Medicine 2025)**
  <https://www.nature.com/articles/s41746-025-02238-1>
  Apple Watch HR bias −0.27 bpm but wide limits (~±8 bpm); good sleep/wake but
  moderate-to-poor sleep-_stage_ accuracy.
- **Bellenger / Miller et al. — 6-device validation (PMC9412437, 2022)**
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC9412437/>
  Apple Watch HR ICC 0.96 but RMSSD underestimated 9.6 ms (ICC 0.67); all six
  valid for two-state sleep/wake, none adequate for stages.
- **van Lier et al. — Empatica E4 vs ECG at rest (PMC7511462, 2020)**
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC7511462/>
  HR differed 1.6 % but RMSSD differed 32.6 % and was statistically unreliable.
  **Why it matters here:** motion-degraded RMSSD is why the app leans on
  overnight/resting HR and HRV-vs-baseline trends, not absolute HRV values.

### Patient preference for voice capture

- **Fischer / Aguayo et al. — Co-design of a voice-based Long COVID app (Digital Health / SAGE 2024, PMC11384972)**
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC11384972/>
  Mixed-method study, n=201 people with Long COVID: **82 % interested in
  voice-based monitoring**, driven by reduced screen/typing fatigue. This is
  the citable source for the previously-uncited "82 % prefer voice" claim.
- **Multimodal conversational-agent usage, 113,780 interactions (PMC12148993, 2025)**
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC12148993/>
  Counter-nuance: voice dominated fallback/small-talk, but _screen_ input was
  more common for structured clinical logging (61 %). General-population app,
  not LC — a reminder that stated preference ≠ real-world logging modality.

## Product reference

- **Visible — How the morning Stability Score works**
  <https://help.makevisible.com/en/articles/10125371-morning-stability-score>
  Market-leader reference for the 1–5 stability-score presentation the
  Insights card mirrors.

## How the sources map to the app's evidence tags

| Tag (`evidenceTags`) | Sources                                     |
| -------------------- | ------------------------------------------- |
| `hrv_pacing`         | Workwell · ME Association 2025 · Altini     |
| `rhr_strain`         | Workwell · Bateman Horne                    |
| `sleep_quality`      | Bateman Horne · NICE NG206                  |
| `energy_envelope`    | AMMES · Bateman Horne                       |
| `pem_avoidance`      | CDC · Workwell                              |
| `pacing_general`     | NICE NG206 · Patient-Led Research · Visible |

## Noted in SPEC.md without a pinned citation

- "~82 % of Long COVID patients prefer voice over typing" — now sourced:
  Fischer et al. 2024 (PMC11384972, n=201), see the voice-capture section above.
- Elevated overnight respiratory rate ↔ viral reactivation (HEALTHKIT.md) —
  flagged as _emerging research_, no citation pinned.
- Voice biomarkers for vocal fatigue / brain fog — listed as emerging, no
  citation pinned.
