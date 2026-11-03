import { describe, expect, it } from "vitest";
import { hashSkillTreeFiles } from "../src/skill-tree.js";

function file(path: string) {
  return { path, mode: 0o644, sizeBytes: 1, sha256: "a".repeat(64) };
}

describe("hashSkillTreeFiles", () => {
  it("hashes the same files identically in any input order", () => {
    expect(hashSkillTreeFiles(["ä", "z", "A", "a"].map(file))).toBe(
      hashSkillTreeFiles(["A", "a", "z", "ä"].map(file)),
    );
  });

  it("binds each file's path, mode, size, and content hash", () => {
    const baseline = hashSkillTreeFiles([file("SKILL.md")]);

    expect(hashSkillTreeFiles([{ ...file("SKILL.md"), mode: 0o755 }])).not.toBe(
      baseline,
    );
    expect(
      hashSkillTreeFiles([{ ...file("SKILL.md"), sizeBytes: 2 }]),
    ).not.toBe(baseline);
    expect(
      hashSkillTreeFiles([{ ...file("SKILL.md"), sha256: "b".repeat(64) }]),
    ).not.toBe(baseline);
    expect(hashSkillTreeFiles([file("skill.md")])).not.toBe(baseline);
  });
});
