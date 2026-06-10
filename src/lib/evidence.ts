// Curated research that backs the pacing read. The Stage-2 analyst may tag an
// insight only with the allow-listed tags below (validated server-side in
// convex/insights.ts); it NEVER emits study names or URLs. Every citation here
// is human-vetted and fixed in code, so the "science behind this" screen can
// never show a hallucinated source.
//
// Titles + plain-language summaries are i18n keys (see src/i18n/en.ts → science
// .entries.<tag>). Source labels are proper nouns shown verbatim in both locales.

export type EvidenceTag =
  | "hrv_pacing"
  | "rhr_strain"
  | "sleep_quality"
  | "energy_envelope"
  | "pem_avoidance"
  | "pacing_general";

export type EvidenceSource = { label: string; url: string };

export type EvidenceEntry = {
  tag: EvidenceTag;
  titleKey: string; // science.entries.<tag>.title
  summaryKey: string; // science.entries.<tag>.summary
  sources: EvidenceSource[];
};

export const EVIDENCE: EvidenceEntry[] = [
  {
    tag: "hrv_pacing",
    titleKey: "science.entries.hrv_pacing.title",
    summaryKey: "science.entries.hrv_pacing.summary",
    sources: [
      {
        label: "Workwell Foundation — Pacing with a heart-rate monitor",
        url: "https://workwellfoundation.org/pacing-with-a-heart-rate-monitor-to-minimize-post-exertional-malaise-pem-in-me-cfs-and-long-covid/",
      },
      {
        label: "ME Association — HR-monitored pacing feasibility study (2025)",
        url: "https://www.tandfonline.com/doi/full/10.1080/21641846.2025.2565103",
      },
      {
        label: "M. Altini — On HRV and readiness",
        url: "https://medium.com/@altini_marco/on-heart-rate-variability-hrv-and-readiness-394a499ed05b",
      },
    ],
  },
  {
    tag: "rhr_strain",
    titleKey: "science.entries.rhr_strain.title",
    summaryKey: "science.entries.rhr_strain.summary",
    sources: [
      {
        label: "Workwell Foundation — Pacing with a heart-rate monitor",
        url: "https://workwellfoundation.org/pacing-with-a-heart-rate-monitor-to-minimize-post-exertional-malaise-pem-in-me-cfs-and-long-covid/",
      },
      {
        label: "Bateman Horne Center — ME/CFS management guidance",
        url: "https://batemanhornecenter.org/providers/mecfs/criteria-specific-guidance/",
      },
    ],
  },
  {
    tag: "sleep_quality",
    titleKey: "science.entries.sleep_quality.title",
    summaryKey: "science.entries.sleep_quality.summary",
    sources: [
      {
        label: "Bateman Horne Center — ME/CFS diagnostic criteria",
        url: "https://batemanhornecenter.org/providers/mecfs/criteria-specific-guidance/",
      },
      {
        label: "NICE NG206 — ME/CFS guideline (2021)",
        url: "https://www.nice.org.uk/guidance/ng206",
      },
    ],
  },
  {
    tag: "energy_envelope",
    titleKey: "science.entries.energy_envelope.title",
    summaryKey: "science.entries.energy_envelope.summary",
    sources: [
      {
        label: "American ME and CFS Society — Pacing",
        url: "https://ammes.org/pacing/",
      },
      {
        label: "Bateman Horne Center — Activity intolerance & pacing",
        url: "https://batemanhornecenter.org/providers/mecfs/criteria-specific-guidance/",
      },
    ],
  },
  {
    tag: "pem_avoidance",
    titleKey: "science.entries.pem_avoidance.title",
    summaryKey: "science.entries.pem_avoidance.summary",
    sources: [
      {
        label: "CDC — Preventing worsening of ME/CFS symptoms",
        url: "https://www.cdc.gov/me-cfs/hcp/clinical-care/treating-the-most-disruptive-symptoms-first-and-preventing-worsening-of-symptoms.html",
      },
      {
        label: "Workwell Foundation — Pacing with a heart-rate monitor",
        url: "https://workwellfoundation.org/pacing-with-a-heart-rate-monitor-to-minimize-post-exertional-malaise-pem-in-me-cfs-and-long-covid/",
      },
    ],
  },
  {
    tag: "pacing_general",
    titleKey: "science.entries.pacing_general.title",
    summaryKey: "science.entries.pacing_general.summary",
    sources: [
      {
        label: "NICE NG206 — ME/CFS guideline (2021)",
        url: "https://www.nice.org.uk/guidance/ng206",
      },
      {
        label: "Patient-Led Research — Clinician's pacing guide",
        url: "https://patientresearchcovid19.com/clinicians-pacing-and-management-guide-for-me-cfs-and-long-covid/",
      },
      {
        label: "Visible — How morning Stability Score works",
        url: "https://help.makevisible.com/en/articles/10125371-morning-stability-score",
      },
    ],
  },
];

const BY_TAG: Record<string, EvidenceEntry> = Object.fromEntries(
  EVIDENCE.map((e) => [e.tag, e])
);

/**
 * Split the evidence list into the entries relevant to this insight (pinned,
 * in tag order) and the rest. Unknown tags are ignored. `pacing_general` is
 * always demoted to the "rest" section so it doesn't crowd the specific drivers.
 */
export function evidenceForTags(tags: string[] | undefined): {
  pinned: EvidenceEntry[];
  rest: EvidenceEntry[];
} {
  const wanted = (tags ?? []).filter((t) => t !== "pacing_general" && BY_TAG[t]);
  const seen = new Set(wanted);
  const pinned = wanted.map((t) => BY_TAG[t]);
  const rest = EVIDENCE.filter((e) => !seen.has(e.tag));
  return { pinned, rest };
}
