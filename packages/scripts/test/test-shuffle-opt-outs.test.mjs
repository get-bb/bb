import { describe, expect, it } from "vitest";
import {
  checkOptOuts,
  findShuffleOptOuts,
  isScannedPath,
  parseAllowlist,
} from "../../../scripts/check-test-shuffle-opt-outs.mjs";

const optOut = ["shuffle", "false"].join(": ");

describe("findShuffleOptOuts", () => {
  it.each([
    ["a suite option", `describe("paths", { ${optOut} }, () => {});`],
    ["a quoted key", `const options = { "shuffle"${": false"} };`],
    ["a config field", `export default { test: { sequence: { ${optOut} } } };`],
    ["an assignment", `config.sequence.shuffle${" = false"};`],
    ["a CLI flag", `"test": "vitest run --sequence.shuffle${"=false"}"`],
    ["a negated CLI flag", `"test": "vitest run --no-sequence${".shuffle"}"`],
  ])("finds %s", (_name, source) => {
    expect(findShuffleOptOuts(source)).toEqual([1]);
  });

  it.each([
    ["shuffling on", `describe.shuffle("paths", () => {});`],
    ["a seeded CLI run", `vitest run --sequence.shuffle --sequence.seed=3`],
    [
      "an unrelated key",
      `const options = { reshuffle: true, shuffled: false };`,
    ],
  ])("accepts %s", (_name, source) => {
    expect(findShuffleOptOuts(source)).toEqual([]);
  });

  it("reports the line of each opt-out", () => {
    expect(
      findShuffleOptOuts(`const a = 1;\n\ndescribe("x", { ${optOut} }, f);\n`),
    ).toEqual([3]);
  });
});

describe("checkOptOuts", () => {
  const reason = "Replays one scripted scenario against a shared fixture";

  it("accepts an opt-out listed with a reason", () => {
    expect(
      checkOptOuts(new Map([["a.test.ts", [3]]]), [
        { path: "a.test.ts", reason },
      ]),
    ).toEqual([]);
  });

  it("rejects an unlisted opt-out", () => {
    expect(checkOptOuts(new Map([["a.test.ts", [3]]]), [])).toEqual([
      expect.stringContaining("a.test.ts:3: disables test shuffling"),
    ]);
  });

  it("rejects an entry without a reason", () => {
    expect(
      checkOptOuts(new Map([["a.test.ts", [3]]]), [
        { path: "a.test.ts", reason: " " },
      ]),
    ).toEqual([expect.stringContaining("needs a reason")]);
  });

  it("rejects a stale entry", () => {
    expect(checkOptOuts(new Map(), [{ path: "a.test.ts", reason }])).toEqual([
      expect.stringContaining("no longer disables shuffling"),
    ]);
  });

  it("rejects a duplicate entry", () => {
    expect(
      checkOptOuts(new Map([["a.test.ts", [3]]]), [
        { path: "a.test.ts", reason },
        { path: "a.test.ts", reason },
      ]),
    ).toEqual([expect.stringContaining("listed more than once")]);
  });
});

describe("parseAllowlist", () => {
  it("rejects an entry without a path", () => {
    expect(() =>
      parseAllowlist(JSON.stringify({ optOuts: [{ reason: "x" }] })),
    ).toThrow("needs a string path and reason");
  });
});

describe("isScannedPath", () => {
  it.each([
    ["apps/server/test/perf/request-path-statements.test.ts", true],
    ["apps/app/vitest.config.ts", true],
    ["packages/scripts/package.json", true],
    ["docs/debugging-and-qa.md", false],
    ["node_modules/vitest/index.js", false],
  ])("%s → %s", (path, scanned) => {
    expect(isScannedPath(path)).toBe(scanned);
  });
});
