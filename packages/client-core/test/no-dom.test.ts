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
 * Browser globals a shared module must not reach for. `typeof window` guards
 * count too: the native runtime has no window and the code path would be
 * dead there anyway, so the module belongs in `apps/app`.
 */
const BROWSER_GLOBAL_PATTERN =
  /(?<![\w$.])(?:window|document|localStorage|sessionStorage|navigator)(?![\w$])\s*(?:[.[(]|;|,|\)|$)|\btypeof\s+(?:window|document|localStorage|sessionStorage|navigator)\b/mu;

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
    expect(BROWSER_GLOBAL_PATTERN.test("const w = window.location;")).toBe(
      true,
    );
    expect(
      BROWSER_GLOBAL_PATTERN.test('if (typeof window === "undefined")'),
    ).toBe(true);
    expect(BROWSER_GLOBAL_PATTERN.test("localStorage.getItem(key)")).toBe(true);
    expect(
      FORBIDDEN_IMPORT_PATTERN.test(
        'import { matchPath } from "react-router-dom";',
      ),
    ).toBe(true);
    expect(BROWSER_GLOBAL_PATTERN.test("const windowed = true;")).toBe(false);
    expect(BROWSER_GLOBAL_PATTERN.test("row.document.id")).toBe(false);
  });
});
