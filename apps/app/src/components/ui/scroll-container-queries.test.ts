import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLASS_STRING = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/gu;
const QUERY_CONTAINER =
  /(?:^|\s)(?:@container(?:-size)?(?:\/[\w-]+)?|\[container-type:[^\]]+\])(?=\s|$)/u;
const SCROLL_CONTAINER = /(?:^|\s)overflow-(?:[xy]-)?(?:auto|scroll)(?=\s|$)/u;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");
const roots = [
  join(here, "..", ".."),
  join(repoRoot, "packages", "shared-ui", "src"),
  join(repoRoot, "plugins"),
];

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* sourceFiles(path);
    } else if (/\.tsx?$/u.test(entry) && !/\.test\.tsx?$/u.test(entry)) {
      yield path;
    }
  }
}

describe("scroll containers and container queries", () => {
  it("never makes a scroll container a container-query container", () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(CLASS_STRING)) {
          const classes = match[0].slice(1, -1);
          if (QUERY_CONTAINER.test(classes) && SCROLL_CONTAINER.test(classes)) {
            const line = source.slice(0, match.index).split("\n").length;
            offenders.push(`${file}:${line}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
