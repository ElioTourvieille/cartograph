// Runs once when the server boots. A missing value crashes here, with its
// name, instead of surfacing as a confusing error three screens later.
const REQUIRED = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CONVEX_URL",
] as const;

export function register() {
  const missing = REQUIRED.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Variables d'environnement manquantes dans .env.local : ${missing.join(", ")}`,
    );
  }
}
