// Client-facing list of the Bot Lab variants shown in the picker. The ids must
// stay in sync with `agent/src/variants.ts` (which holds the real voice / speed
// / turn-detection config). The selected id is passed to mintToken → token
// metadata → the agent.

export type BotId = "A" | "B" | "C" | "D" | "E";

export interface Bot {
  id: BotId;
  name: string;
  blurb: string;
}

export const BOTS: Bot[] = [
  { id: "A", name: "Marin", blurb: "Warm · natural" },
  { id: "B", name: "Sage", blurb: "Soothing · patient" },
  { id: "C", name: "Coral", blurb: "Friendly · relational" },
  { id: "D", name: "Ballad", blurb: "Tender · expressive" },
  { id: "E", name: "Ash", blurb: "Grounded · steady" },
];

export const DEFAULT_BOT: BotId = "A";
