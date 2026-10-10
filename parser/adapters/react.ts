import { folderOf, type Adapter } from "../adapter.ts";

// React, on its own (a package that depends on React and on no framework tried
// before it). Roles from folder and file-name conventions; no routes, since a
// route table needs a router and a router is a framework of its own.

const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;
const stem = (file: string): string => file.replace(/\.[^.]+$/, "");

export const react: Adapter = {
  id: "react",
  detect: (dependencies) => dependencies.has("react"),
  watch: [],
  folderOf,
  roleOf({ local }) {
    if (TEST.test(local)) return "tests";
    const base = local.startsWith("src/") ? local.slice(4) : local;
    const segments = base.split("/");
    const file = segments[segments.length - 1];
    const name = stem(file);

    if (segments.length === 1 && (name === "main" || name === "index")) return "react:entry";
    if (segments.includes("hooks") || /^use[A-Z]/.test(name)) return "react:hook";
    if (
      segments.includes("context") ||
      segments.includes("contexts") ||
      /(Context|Provider)$/.test(name)
    ) {
      return "react:context";
    }
    if (["pages", "views", "screens", "routes"].some((d) => segments.includes(d))) {
      return "react:page";
    }
    if (segments.includes("components") || (/^[A-Z]/.test(name) && /\.[jt]sx$/.test(file))) {
      return "react:component";
    }
    return null;
  },
  routes: () => [],
};
