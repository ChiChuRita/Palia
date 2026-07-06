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

- "~82 % of Long COVID patients prefer voice over typing" — market-research
  claim in the spec; no source URL is recorded in the repo.
- Elevated overnight respiratory rate ↔ viral reactivation (HEALTHKIT.md) —
  flagged as _emerging research_, no citation pinned.
- Voice biomarkers for vocal fatigue / brain fog — listed as emerging, no
  citation pinned.
