import type { SkillSummary } from "@bb/server-contract";
import { RESOURCE_GRID_PAGE_SIZE } from "@bb/shared-ui/resource-pagination";
import { describe, expect, it } from "vitest";
import {
  formatInstallCount,
  formatRegistrySource,
  normalizeSkillName,
  parseRegistrySkill,
  parseRegistrySkills,
  REGISTRY_PAGE_SIZE,
  resolveInstalledRegistrySkill,
} from "./skills-registry";
import type { RegistrySkill } from "./skills-registry";

const registrySkill: RegistrySkill = {
  id: "owner/repo/useful-skill",
  source: "owner/repo",
  skillId: "useful-skill",
  name: "Useful skill",
  installs: 1_234,
  stars: 56,
  installUrl: null,
  url: "https://skills.sh/owner/repo/useful-skill",
  topic: "Development",
  summary: "A useful skill.",
};

function installedSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id: `skill_${"a".repeat(64)}`,
    name: "useful-skill",
    description: "A useful skill.",
    provider: null,
    scope: "bb-user",
    pluginId: null,
    filePath: "/home/u/.bb/skills/useful-skill/SKILL.md",
    manageable: true,
    registrySkillId: registrySkill.id,
    ...overrides,
  };
}

describe("registry skill parsing", () => {
  it("parses a complete registry skill and normalizes an omitted stars value", () => {
    expect(parseRegistrySkill(registrySkill)).toEqual(registrySkill);
    expect(parseRegistrySkill({ ...registrySkill, stars: undefined })).toEqual({
      ...registrySkill,
      stars: null,
    });
  });

  it("rejects malformed entries and filters them from registry pages", () => {
    const malformed = { ...registrySkill, installs: "1234" };

    expect(parseRegistrySkill(malformed)).toBeNull();
    expect(parseRegistrySkill(null)).toBeNull();
    expect(parseRegistrySkills({ skills: [malformed, registrySkill] })).toEqual(
      [registrySkill],
    );
    expect(parseRegistrySkills({ skills: "not-an-array" })).toEqual([]);
  });
});

describe("registry skill matching", () => {
  it("matches only manageable bb-user skills with exact registry provenance", () => {
    const exactMatch = installedSkill();
    const candidates = [
      installedSkill({
        id: `skill_${"b".repeat(64)}`,
        registrySkillId: "other/repo/useful-skill",
      }),
      exactMatch,
    ];

    expect(resolveInstalledRegistrySkill(registrySkill, candidates)).toBe(
      exactMatch,
    );
    expect(
      resolveInstalledRegistrySkill(registrySkill, [
        installedSkill({ manageable: false }),
        installedSkill({ scope: "claude-user" }),
        installedSkill({ provider: "codex" }),
      ]),
    ).toBeNull();
  });
});

describe("registry skill formatting", () => {
  it("normalizes names using the existing registry slug behavior", () => {
    expect(normalizeSkillName("  Ship & Review_IT  ")).toBe("ship-review-it");
  });

  it("formats sources and compact install counts at the existing thresholds", () => {
    expect(formatRegistrySource("github.com/owner/repo")).toBe("owner/repo");
    expect(formatRegistrySource("owner/repo")).toBe("owner/repo");
    expect(formatInstallCount(999)).toBe("999");
    expect(formatInstallCount(1_000)).toBe("1.0K");
    expect(formatInstallCount(1_250_000)).toBe("1.3M");
  });

  it("uses the shared resource grid page size", () => {
    expect(REGISTRY_PAGE_SIZE).toBe(RESOURCE_GRID_PAGE_SIZE);
  });
});
