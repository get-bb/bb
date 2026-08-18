import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Tailwind compiles `group-has-*` and `peer-has-*` variants to selectors
// like `.x:is(:where(.group):has(ARG) *)`. Blink cannot anchor a `:has()`
// that sits inside `:is()`/`:where()` with a universal subject, so while one
// such rule exists in the page, every DOM insertion or removal restyles the
// whole subtree. On a large thread that cost ~1 s per streaming update.
// Use a named `@custom-variant` in theme.css that keeps `:has()` on the group
// element itself (`:where(.group\/x):has(ARG) &`) instead.
const FORBIDDEN_VARIANT = /\b(?:group|peer)-has-(?:\[|[a-z])/u;

const here = dirname(fileURLToPath(import.meta.url));
const roots = [
  join(here, "..", ".."),
  join(here, "..", "..", "..", "..", "..", "packages", "shared-ui", "src"),
];

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* sourceFiles(path);
    } else if (/\.(?:tsx?|css)$/u.test(entry) && !entry.endsWith(".test.ts")) {
      yield path;
    }
  }
}

describe("Tailwind has-variants", () => {
  it("does not use group-has-* or peer-has-* variants", () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, index) => {
          if (FORBIDDEN_VARIANT.test(line)) {
            offenders.push(`${file}:${index + 1}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
