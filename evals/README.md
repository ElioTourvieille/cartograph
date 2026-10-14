# Évaluations

Scripts hors de l'application web. Ils lisent le même `.env.local` et les analyses
stockées, uniquement par les fonctions internes de `convex/evalData.ts` (lancées
avec la CLI Convex, avec une organisation explicite). Depuis la racine du projet :

| Commande | Ce qu'elle mesure | Modèle ? |
|---|---|---|
| `pnpm eval:paths --self-test` | Prouve que le contrôle attrape un nom de fichier inventé. | Non |
| `pnpm eval:paths --org org_…` | Chemins inventés dans les explications réelles : tout chemin qui n'est pas dans l'ensemble montré au modèle. | Non, exact |
| `pnpm eval:roles --org org_…` | Précision des rôles déduits, sur des fichiers dont la convention donne la vérité. Deux chiffres : chemin masqué (à retenir) et chemin réel. | Haiku 4.5 |
| `pnpm eval:prompts --org org_… [--n 20]` | Prompt actuel (v1) contre le prompt de référence (v0, `evals/retired/`), en deux expériences LangSmith côte à côte. | Sonnet 5.5 écrit, Opus 5.5 juge |

| `pnpm eval:agent --self-test` | Prouve que les détecteurs (plomberie, refus, note, chemin inventé) savent échouer. | Non |
| `pnpm eval:agent --org org_… --analysis <id>` | L'agent consulte-t-il avant de répondre, décline-t-il le jugement, cite-t-il des chemins hors de ce que les consultations ont renvoyé, parle-t-il de son fonctionnement ? Agent (`pnpm agent:dev`) et app (`pnpm dev`) lancés. | Sonnet 5.5 répond, aucun juge |

`--org` est l'identifiant Clerk de l'organisation (`org_…`).

## À savoir

- **Le contrôle des chemins est exact** (appartenance à un ensemble). La note de
  « précision utile » est l'avis d'un modèle : plus fragile, et donnée comme telle.
- **v0 n'a jamais été livré.** C'est une référence simplifiée écrite pour la
  comparaison : le même prompt sans la consigne de voisinage ni la règle des chemins.
- **Les jeux de données contiennent du code** de dépôts analysés (`evals/data/`,
  ignoré par git, et le jeu LangSmith). Même décision de confidentialité que les traces.
- Un jeu écrit à moitié est un fichier `.partial` (rôles) ou un jeu LangSmith marqué
  « EN CONSTRUCTION » : jamais réutilisé, supprimé au lancement suivant.
- Un score manquant fait échouer la comparaison au lieu d'afficher un chiffre.
