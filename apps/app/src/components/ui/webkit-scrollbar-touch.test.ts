import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FINE_POINTER_MEDIA = /^@media\b[^{]*\(\s*pointer\s*:\s*fine\s*\)/u;
const HIDDEN_ONLY = /^\s*display\s*:\s*none\s*;?\s*$/u;
const TAILWIND_SCROLLBAR_VARIANT =
  /\[&::-webkit-scrollbar[\w-]*\]:([\w[\]:-]+)/gu;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");
const roots = [
  join(here, "..", ".."),
  join(repoRoot, "packages", "shared-ui", "src"),
  join(repoRoot, "plugins"),
];

function* sourceFiles(dir: string, pattern: RegExp): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* sourceFiles(path, pattern);
    } else if (pattern.test(entry) && !/\.test\.tsx?$/u.test(entry)) {
      yield path;
    }
  }
}

type CssRule = {
  prelude: string;
  body: string;
  ancestors: string[];
  offset: number;
};

function cssRules(source: string): CssRule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//gu, (comment) =>
    " ".repeat(comment.length),
  );
  const rules: CssRule[] = [];
  const stack: { prelude: string; bodyStart: number; offset: number }[] = [];
  let preludeStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") {
      const rawPrelude = text.slice(preludeStart, index);
      stack.push({
        prelude: rawPrelude.trim(),
        bodyStart: index + 1,
        offset:
          preludeStart + rawPrelude.length - rawPrelude.trimStart().length,
      });
      preludeStart = index + 1;
    } else if (char === "}") {
      const block = stack.pop();
      if (block) {
        rules.push({
          prelude: block.prelude,
          body: text.slice(block.bodyStart, index),
          ancestors: stack.map((ancestor) => ancestor.prelude),
          offset: block.offset,
        });
      }
      preludeStart = index + 1;
    } else if (char === ";" && stack.length > 0) {
      preludeStart = index + 1;
    }
  }
  return rules;
}

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

describe("::-webkit-scrollbar styling on touch devices", () => {
  it("keeps sized or painted ::-webkit-scrollbar rules behind a fine pointer", () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root, /\.css$/u)) {
        const source = readFileSync(file, "utf8");
        for (const rule of cssRules(source)) {
          if (!rule.prelude.includes("::-webkit-scrollbar")) continue;
          if (HIDDEN_ONLY.test(rule.body)) continue;
          if (
            rule.ancestors.some((ancestor) => FINE_POINTER_MEDIA.test(ancestor))
          )
            continue;
          const location = `${relative(repoRoot, file)}:${lineOf(source, rule.offset)}`;
          offenders.push(location);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only uses Tailwind ::-webkit-scrollbar variants to hide the scrollbar", () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root, /\.tsx?$/u)) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(TAILWIND_SCROLLBAR_VARIANT)) {
          if (match[1] === "hidden") continue;
          const location = `${relative(repoRoot, file)}:${lineOf(source, match.index)}`;
          offenders.push(location);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
