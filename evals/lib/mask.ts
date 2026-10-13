// Hides the parts of a path that carry the convention a file's role was read
// from. The files of the role dataset were chosen BECAUSE a convention named
// them, so their paths say so (`users.service.ts`, `components/Button.tsx`).
// A model can answer "service" from that name alone, which a file no adapter
// could identify would never give it. Scoring on the real path overstates what
// the classifier can do; scoring on the masked one is closer to its real job,
// and the gap between the two is the size of the leak.

const FOLDER_MARKERS = new Set([
  "components",
  "component",
  "hooks",
  "hook",
  "lib",
  "libs",
  "utils",
  "util",
  "helpers",
  "helper",
  "services",
  "service",
  "models",
  "model",
  "entities",
  "entity",
  "schemas",
  "schema",
  "repositories",
  "repository",
  "config",
  "configs",
  "configuration",
  "middlewares",
  "middleware",
]);

const SUFFIX_MARKER =
  /\.(service|repository|entity|schema|dto|controller|module|guard|pipe|interceptor|filter|middleware|decorator|strategy|model|util|utils|hook|component|config)(?=\.[^.]+$)/i;

export function maskPath(path: string): string {
  const parts = path.split("/").map((segment) => (FOLDER_MARKERS.has(segment.toLowerCase()) ? "_" : segment));
  const last = parts.length - 1;
  parts[last] = parts[last].replace(SUFFIX_MARKER, "").replace(/^use(?=[A-Z])/, "");
  return parts.join("/");
}
