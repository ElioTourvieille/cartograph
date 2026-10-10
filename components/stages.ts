// The four stages of a run as they are named on screen, in order.
export const STAGE_ORDER = ["fetch", "select", "parse", "store"] as const;
export type StageId = (typeof STAGE_ORDER)[number];

export const STAGE_LABEL: Record<StageId, string> = {
  fetch: "Récupération de l'archive",
  select: "Sélection des fichiers",
  parse: "Analyse du code",
  store: "Enregistrement",
};
