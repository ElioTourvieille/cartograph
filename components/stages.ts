// The stages of a run as they are named on screen, in order. "access" is only
// in a run on a private repository: it is where the installation is checked.
export const STAGE_ORDER = ["access", "fetch", "select", "parse", "store"] as const;
export type StageId = (typeof STAGE_ORDER)[number];

export const STAGE_LABEL: Record<StageId, string> = {
  access: "Accès au dépôt privé",
  fetch: "Récupération de l'archive",
  select: "Sélection des fichiers",
  parse: "Analyse du code",
  store: "Enregistrement",
};
