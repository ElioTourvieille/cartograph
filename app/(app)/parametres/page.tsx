import { Installations } from "@/components/installations";

// Only these codes are ever turned into text. What the URL carries is never
// shown as is.
const NOTICE: Record<string, string> = {
  connecte: "Installation connectée.",
  "erreur:etat":
    "La demande de connexion a expiré, ou ne vient pas de cette session. Recommencez depuis le bouton ci-dessous.",
  "erreur:installation": "GitHub ne reconnaît pas cette installation.",
  "erreur:autre": "Cette installation GitHub est déjà connectée à une autre organisation.",
  "erreur:ancienne":
    "Cette installation date de plus de dix minutes : désinstallez l'App sur GitHub, puis recommencez depuis ici.",
  "erreur:refus": "La connexion a été refusée.",
  "erreur:github": "GitHub n'a pas pu confirmer l'installation. Réessayez dans un instant.",
  "erreur:configuration": "L'App GitHub n'est pas configurée sur ce serveur.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const key =
    one(query.connecte) !== undefined
      ? "connecte"
      : one(query.erreur) !== undefined
        ? `erreur:${one(query.erreur)}`
        : undefined;
  const notice = key === undefined ? undefined : NOTICE[key];

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xs font-semibold">Paramètres de l&apos;organisation</h1>
      {notice !== undefined && <p className="text-xs">{notice}</p>}
      <Installations />
    </div>
  );
}
