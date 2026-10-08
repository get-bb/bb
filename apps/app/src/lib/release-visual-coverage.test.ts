import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseChangelog, RELEASE_META } from "@bb/domain/changelog";
import { RELEASE_VISUALS } from "../../../../plugins/whats-new/release-visuals";

const NEWEST_RELEASE = parseChangelog(
  readFileSync(new URL("../../../../CHANGELOG.md", import.meta.url), "utf8"),
)[0]?.version;

describe("release visual coverage", () => {
  it("has a What's new drawing for every visual named in release metadata", () => {
    const referenced = Object.entries(RELEASE_META).flatMap(
      ([version, meta]) =>
        meta.visual === undefined ? [] : [[version, meta.visual] as const],
    );
    expect(referenced.length).toBeGreaterThan(0);
    for (const [version, visual] of referenced) {
      expect(
        Object.hasOwn(RELEASE_VISUALS, visual),
        `${version} → ${visual}`,
      ).toBe(true);
    }
  });

  it("uses every What's new drawing for a release", () => {
    const used = new Set<string | undefined>(
      Object.values(RELEASE_META).map((meta) => meta.visual),
    );
    expect(Object.keys(RELEASE_VISUALS).filter((id) => !used.has(id))).toEqual(
      [],
    );
  });

  it("has release metadata and a visual for the newest changelog release", () => {
    expect(NEWEST_RELEASE).toBeDefined();
    expect(RELEASE_META[NEWEST_RELEASE ?? ""]?.visual).toBeDefined();
  });
});
