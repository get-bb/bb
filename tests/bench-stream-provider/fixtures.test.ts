import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getFixture,
  listFixtureNames,
  streamDocumentText,
} from "./src/fixtures/index.js";

const REALISTIC_RESPONSES = [
  "incident-writeup",
  "refactor-plan",
  "api-design",
  "data-analysis",
] as const;

function lines(text: string): string[] {
  return text.split("\n");
}

function tableBodies(text: string): number[] {
  const bodies: number[] = [];
  let rows = -1;
  for (const line of lines(text)) {
    if (line.startsWith("|")) {
      rows += 1;
      continue;
    }
    if (rows > 0) {
      bodies.push(rows - 1);
    }
    rows = -1;
  }
  return bodies;
}

function fencedBlocks(text: string): { info: string; lineCount: number }[] {
  const blocks: { info: string; lineCount: number }[] = [];
  let open: { info: string; lineCount: number } | null = null;
  for (const line of lines(text)) {
    const fence = /^\s*```(.*)$/u.exec(line);
    if (fence !== null) {
      if (open === null) {
        open = { info: fence[1] ?? "", lineCount: 0 };
      } else {
        blocks.push(open);
        open = null;
      }
      continue;
    }
    if (open !== null) {
      open.lineCount += 1;
    }
  }
  return blocks;
}

describe("bench fixtures", () => {
  it("lists every fixture by name and rejects unknown names", () => {
    expect(listFixtureNames()).toEqual([
      "long-response",
      "incident-writeup",
      "refactor-plan",
      "api-design",
      "data-analysis",
      "pathological",
    ]);
    expect(() => getFixture("missing")).toThrow(
      /Unknown bench fixture "missing"/,
    );
  });

  it("keeps long-response byte-identical to the benchmark's streaming response", () => {
    const text = getFixture("long-response");
    expect(Buffer.byteLength(text)).toBe(16_499);
    expect(createHash("sha256").update(text).digest("hex")).toBe(
      "e927b2598909d5b9fcf788eb42b77328c73065ad6b69aaaafa08e391626d2400",
    );
  });

  it("sizes each realistic response between 8 and 16 KB", () => {
    for (const name of REALISTIC_RESPONSES) {
      const bytes = Buffer.byteLength(getFixture(name));
      expect(bytes, name).toBeGreaterThanOrEqual(8_000);
      expect(bytes, name).toBeLessThanOrEqual(16_000);
    }
  });

  it("gives each realistic response its distinguishing constructs", () => {
    const incident = getFixture("incident-writeup");
    expect(tableBodies(incident).length).toBeGreaterThanOrEqual(3);

    const plan = getFixture("refactor-plan");
    expect(new Set(fencedBlocks(plan).map((block) => block.info))).toEqual(
      new Set(["tsx", "json", "sql", "diff", "bash"]),
    );
    expect(lines(plan).some((line) => /^ {3}\d+\. /u.test(line))).toBe(true);
    expect(lines(plan).some((line) => /^ {6}\d+\. /u.test(line))).toBe(true);

    const api = getFixture("api-design");
    expect(Math.max(...tableBodies(api))).toBeGreaterThanOrEqual(25);
    expect(api).toContain("`apps/server/src/routes/threads/data.ts:348`");
    expect(api).toMatch(/\[[^\]]+\]\(https:\/\/[^)]+\)/u);

    const analysis = getFixture("data-analysis");
    expect(
      lines(analysis).filter((line) => line === "$$").length,
    ).toBeGreaterThanOrEqual(8);
    expect(analysis).toMatch(/[^$]\$[^$\n]+\$[^$]/u);
  });

  it("builds the pathological document from the constructs that stress streaming renderers", () => {
    const text = getFixture("pathological");
    expect(lines(text)).toContain("Run `echo $$` to print the PID.");

    const bullets = lines(text).filter((line) => line.startsWith("- "));
    expect(bullets).toHaveLength(120);
    const firstBullet = text.indexOf("\n- ");
    const lastBullet = text.lastIndexOf("\n- ");
    const listBody = text.slice(
      firstBullet + 1,
      text.indexOf("\n", lastBullet + 1),
    );
    expect(listBody.split("\n\n")).toHaveLength(120);

    expect(fencedBlocks(text).map((block) => block.lineCount)).toEqual([250]);
    expect(tableBodies(text)).toEqual([60]);
    expect(
      lines(text).filter(
        (line) =>
          line.length > 80 &&
          !/^[-|`#>$\d]/u.test(line) &&
          !line.startsWith(" "),
      ).length,
    ).toBeGreaterThanOrEqual(5);
  });

  it("joins repeated stream documents with a blank line", () => {
    const fixture = getFixture("api-design");
    expect(streamDocumentText("api-design", 1)).toBe(fixture);
    expect(streamDocumentText("api-design", 3)).toBe(
      [fixture, fixture, fixture].join("\n\n"),
    );
    expect(() => streamDocumentText("api-design", 0)).toThrow(/repeat/u);
  });
});
