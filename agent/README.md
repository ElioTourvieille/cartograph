# Agent

Le service qui répond aux questions sur un dépôt analysé. C'est un processus à
part : s'il est arrêté, le reste de l'application fonctionne.

Moteur : Deep Agents (`deepagents`), servi par le serveur LangGraph local
(`langgraphjs dev`). Modèle : Anthropic, `claude-sonnet-5-5`.

## Lancer

```
cp agent/.env.example agent/.env     # puis renseigner ANTHROPIC_API_KEY
pnpm agent:dev                       # http://localhost:2024
```

`agent/.env` ne contient que ce dont l'agent a besoin. Aucun secret de
l'application (Clerk, Convex, secret du pipeline) n'y va.

## Ce qu'il sait faire

Six consultations, toutes en lecture seule, qui passent par l'application
(`/api/agent/tools/*`) avec un jeton valable cinq minutes pour une seule
analyse : résumé, recherche de fichiers par morceau de chemin, fichiers par
rôle, voisins directs, parcours transitif, table des routes.

Aucune consultation n'a d'argument qui désigne une analyse ou une organisation :
c'est le jeton qui les porte, pas le prompt.

## Clés

`pnpm agent:keys` fabrique la paire qui signe le jeton. La clé privée va dans
`.env.local` (`AGENT_PRIVATE_KEY`), la publique sur Convex
(`npx convex env set AGENT_JWKS_URI "<valeur>"`).
