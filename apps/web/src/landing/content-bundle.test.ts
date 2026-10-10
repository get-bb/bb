import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATIC_IMPORT =
  /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+"(\.{1,2}\/[^"?]+)"/gmu;
const EAGER_GLOB =
  /import\.meta\.glob(?:<[^(]*>)?\(\s*"([^"]+)"\s*,\s*\{[^}]*\beager:\s*true/gu;
const PAGE_CONTENT = [
  /\/(?:guides|compare|landing)\/pages\/[^/]+\.tsx$/u,
  /\/guides\/guides\.ts$/u,
  /\/compare\/comparisons\.ts$/u,
  /\/landing\/landing-pages\.tsx$/u,
];

function resolveModule(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier.replace(/\.js$/u, ""));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
    if (/\.tsx?$/u.test(candidate) && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function staticGraph(entry: string) {
  const files = new Set<string>();
  const eagerGlobs: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || files.has(file)) continue;
    files.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(EAGER_GLOB)) {
      eagerGlobs.push(resolve(dirname(file), match[1] ?? ""));
    }
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const next = resolveModule(file, match[1] ?? "");
      if (next) queue.push(next);
    }
  }
  return { files: [...files], eagerGlobs };
}

describe("site chrome bundle", () => {
  const graph = staticGraph(resolve(SRC, "landing/site-chrome.tsx"));

  it("reaches content links, so the walk covers the nav and footer", () => {
    expect(graph.files).toContain(resolve(SRC, "landing/content-links.ts"));
  });

  it("never statically imports guide, comparison, or landing page content", () => {
    const content = graph.files.filter((file) =>
      PAGE_CONTENT.some((pattern) => pattern.test(file)),
    );
    expect(content.map((file) => file.slice(SRC.length))).toEqual([]);
  });

  it("only eagerly globs page metadata files", () => {
    expect(graph.eagerGlobs.length).toBeGreaterThan(0);
    for (const pattern of graph.eagerGlobs) {
      expect(pattern).toMatch(/\.meta\.ts$/u);
    }
  });
});
