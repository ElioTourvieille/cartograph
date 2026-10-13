import { existsSync } from "node:fs";
import { join } from "node:path";

// Lets a script outside the web app load the same environment the app runs
// with: .env.local, read by Node itself, with nothing added to the project.
// Values that are already set in the shell win, as they do for Next.js.

export function loadEnv(required: readonly string[] = []): void {
  const file = join(process.cwd(), ".env.local");
  if (!existsSync(file)) {
    throw new Error("Lancez ce script depuis la racine du projet : .env.local est introuvable.");
  }
  process.loadEnvFile(file);
  const missing = required.filter((name) => (process.env[name] ?? "") === "");
  if (missing.length > 0) {
    throw new Error(`Variables manquantes dans .env.local : ${missing.join(", ")}.`);
  }
}

/** The value of `--name value` on the command line, or undefined. */
export function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

export const flag = (name: string): boolean => process.argv.includes(`--${name}`);

export function requiredOption(name: string): string {
  const value = option(name);
  if (value === undefined) {
    throw new Error(`Option manquante : --${name} (l'identifiant de l'organisation, org_…).`);
  }
  return value;
}
