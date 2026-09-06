import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBuiltinSkillsRootPath } from "../../src/services/skills/builtin-skills-copy.js";

function readBuiltinSkillDoc(skillName: string, ...segments: string[]): string {
  return readFileSync(
    path.join(resolveBuiltinSkillsRootPath(), skillName, ...segments),
    "utf8",
  );
}

describe("builtin skills shell forms", () => {
  it("bb-cli common checks name both the POSIX and PowerShell env forms", () => {
    const skill = readBuiltinSkillDoc("bb-cli", "SKILL.md");

    expect(skill).toContain('"$BB_ENVIRONMENT_ID"');
    expect(skill).toContain('"$BB_THREAD_ID"');
    expect(skill).toContain("$env:BB_ENVIRONMENT_ID");
    expect(skill).toContain("$env:BB_THREAD_ID");
  });

  it("skill-creator evaluation names both the POSIX and PowerShell project forms", () => {
    const evaluation = readBuiltinSkillDoc(
      "skill-creator",
      "references",
      "evaluation.md",
    );

    expect(evaluation).toContain('"$BB_PROJECT_ID"');
    expect(evaluation).toContain("$env:BB_PROJECT_ID");
  });
});
