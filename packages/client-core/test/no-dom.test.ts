import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src",
);

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    return /\.tsx?$/u.test(entry.name) ? [fullPath] : [];
  });
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:"'`])\/\/.*$/gmu, "$1");
}

/**
 * Browser globals a shared module must not reach for, in any of the shapes a
 * "safe" probe tends to take: bare (`location.href`), hung off a host object
 * (`globalThis.window?.location`, `self.navigator`), `typeof` checks,
 * `"localStorage" in globalThis`, or `window as Window`. `typeof window`
 * guards count too: the native runtime has no window and the code path would
 * be dead there anyway, so the module belongs in `apps/app`.
 */
const BROWSER_GLOBALS =
  "window|document|localStorage|sessionStorage|navigator|location|history|matchMedia|requestAnimationFrame";
const GLOBAL_HOSTS = "globalThis|self|window";
const BROWSER_GLOBAL_PATTERN = new RegExp(
  [
    // `window.x`, `window?.x`, `window!.x`, `window[`, `window(`, `window;`,
    // `window ?? x`, `window && x`, `window === x`, `window as Window`, and a
    // bare `window` at end of line — optionally behind a `globalThis.`/`self.`
    // host. A trailing `:` (object key, type member) or quote stays allowed.
    String.raw`(?<![\w$.])(?:(?:${GLOBAL_HOSTS})\s*\??\.\s*)?(?:${BROWSER_GLOBALS})(?![\w$])\s*(?:[?!]?[.[(]|[;,)]|\?\?|\|\||&&|[!=]==?|as\b|$)`,
    String.raw`\btypeof\s+(?:(?:${GLOBAL_HOSTS})\s*\??\.\s*)?(?:${BROWSER_GLOBALS})\b`,
    String.raw`["'](?:${BROWSER_GLOBALS})["']\s+in\s+(?:${GLOBAL_HOSTS})\b`,
  ].join("|"),
  "mu",
);

const FORBIDDEN_IMPORT_PATTERN =
  /from\s+["'](?:react|react-dom|react-router|react-router-dom|jotai|@tanstack\/[\w-]+|@\/[^"']*)(?:\/[^"']*)?["']/u;

describe("@bb/client-core stays DOM-free", () => {
  const files = listSourceFiles(SRC_DIR);

  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [path.relative(SRC_DIR, file), file]))(
    "%s does not reference browser globals or UI-framework imports",
    (_label, file) => {
      const source = stripComments(readFileSync(file, "utf8"));
      const globalMatch = BROWSER_GLOBAL_PATTERN.exec(source);
      expect(
        globalMatch?.[0] ?? null,
        `browser global reference: ${globalMatch?.[0] ?? ""}`,
      ).toBeNull();
      const importMatch = FORBIDDEN_IMPORT_PATTERN.exec(source);
      expect(
        importMatch?.[0] ?? null,
        `forbidden import: ${importMatch?.[0] ?? ""}`,
      ).toBeNull();
    },
  );

  it("catches a window reference (self-check)", () => {
    const caught = [
      "const w = window.location;",
      'if (typeof window === "undefined")',
      "localStorage.getItem(key)",
      "const host = globalThis.window?.location.hostname ?? null;",
      'if (typeof globalThis.localStorage !== "undefined")',
      'if ("localStorage" in globalThis)',
      "self.navigator.userAgent",
      "window?.location",
      "const w = window as Window;",
      "const w = window ?? null;",
      "location.href",
      "history.pushState(null, '', url);",
      'matchMedia("(prefers-color-scheme: dark)")',
      "requestAnimationFrame(() => {});",
    ];
    for (const snippet of caught) {
      expect(BROWSER_GLOBAL_PATTERN.test(snippet), snippet).toBe(true);
    }
    expect(
      FORBIDDEN_IMPORT_PATTERN.test(
        'import { matchPath } from "react-router-dom";',
      ),
    ).toBe(true);
    const allowed = [
      "const windowed = true;",
      "row.document.id",
      "this.history.push(entry)",
      "type Row = { location: string; history: Entry[] }",
      "return { history: rows, location: at };",
      'kind: "document",',
    ];
    for (const snippet of allowed) {
      expect(BROWSER_GLOBAL_PATTERN.test(snippet), snippet).toBe(false);
    }
  });
});
