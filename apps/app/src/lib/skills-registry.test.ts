import type { SkillSummary } from "@bb/server-contract";
import { RESOURCE_GRID_PAGE_SIZE } from "@bb/shared-ui/resource-pagination";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchRegistrySkillDetail,
  fetchRegistrySkillEntry,
  fetchRegistrySkills,
  formatInstallCount,
  formatRegistrySource,
  installRegistrySkill,
  normalizeSkillName,
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

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubJsonResponse(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

describe("registry skill contracts", () => {
  it("uses the shared page and entry schemas at the HTTP boundary", async () => {
    const page = {
      skills: [registrySkill],
      pagination: { page: 0, perPage: 12, total: 1, hasMore: false },
    };
    stubJsonResponse(page);
    await expect(fetchRegistrySkills({ query: "", page: 0 })).resolves.toEqual(
      page,
    );

    stubJsonResponse({ ...registrySkill, stars: undefined });
    await expect(fetchRegistrySkillEntry(registrySkill.id)).rejects.toThrow(
      "Invalid registry skill response",
    );
  });

  it("uses the shared detail and install schemas at the HTTP boundary", async () => {
    const detail = {
      id: registrySkill.id,
      source: registrySkill.source,
      skillId: registrySkill.skillId,
      hash: null,
      files: [{ path: "SKILL.md", contents: "# Useful skill" }],
    };
    stubJsonResponse(detail);
    await expect(
      fetchRegistrySkillDetail({
        source: registrySkill.source,
        skillId: registrySkill.skillId,
      }),
    ).resolves.toEqual(detail);

    stubJsonResponse({ ok: true, filePath: "/tmp/useful-skill/SKILL.md" });
    await expect(
      installRegistrySkill({ skill: registrySkill }),
    ).resolves.toEqual({ ok: true, filePath: "/tmp/useful-skill/SKILL.md" });
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
