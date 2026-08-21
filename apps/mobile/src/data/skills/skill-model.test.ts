import type { RegistrySkill, SkillSummary } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  accumulateRegistryPage,
  groupSkillsByScope,
  isSkillDeletable,
  pickRegistrySkillFile,
  resolveInstalledRegistrySkill,
  skillScopeLabel,
} from "./skill-model";

function skill(overrides: Partial<SkillSummary>): SkillSummary {
  return {
    id: "skill_" + "a".repeat(64),
    name: "bb-cli",
    description: null,
    provider: null,
    scope: "bb-builtin",
    pluginId: null,
    filePath: "/skills/bb-cli/SKILL.md",
    manageable: false,
    registrySkillId: null,
    ...overrides,
  };
}

function registrySkill(id: string): RegistrySkill {
  return {
    id,
    source: "github.com/acme/skills",
    skillId: id.split("/").at(-1) ?? id,
    name: id,
    installs: 10,
    stars: null,
    installUrl: null,
    url: "https://www.skills.sh/x",
    topic: null,
    summary: null,
  };
}

describe("groupSkillsByScope", () => {
  it("orders user scopes before built-ins, splits provider scopes per provider, sorts names", () => {
    const groups = groupSkillsByScope(
      [
        skill({
          id: "skill_1".padEnd(70, "0"),
          name: "zeta",
          scope: "bb-builtin",
        }),
        skill({
          id: "skill_2".padEnd(70, "0"),
          name: "mine",
          scope: "bb-user",
          manageable: true,
        }),
        skill({
          id: "skill_3".padEnd(70, "0"),
          name: "codex-thing",
          scope: "provider-user",
          provider: "codex",
        }),
        skill({
          id: "skill_4".padEnd(70, "0"),
          name: "claude-thing",
          scope: "provider-user",
          provider: "claude-code",
        }),
        skill({
          id: "skill_5".padEnd(70, "0"),
          name: "alpha",
          scope: "bb-builtin",
        }),
      ],
      new Map([["claude-code", "Claude Code"]]),
    );
    expect(groups.map((group) => group.label)).toEqual([
      "bb · user",
      "Claude Code · user",
      "codex · user",
      "Built-in",
    ]);
    expect(groups.at(-1)?.skills.map((entry) => entry.name)).toEqual([
      "alpha",
      "zeta",
    ]);
  });
});

describe("skill editability", () => {
  it("labels provider scopes from the provider and only deletes manageable local skills", () => {
    expect(
      skillScopeLabel({ scope: "provider-project", provider: "acp-foo" }),
    ).toBe("acp-foo · project");
    expect(
      isSkillDeletable(skill({ scope: "bb-user", manageable: true })),
    ).toBe(true);
    expect(
      isSkillDeletable(skill({ scope: "bb-user", manageable: false })),
    ).toBe(false);
    expect(
      isSkillDeletable(skill({ scope: "provider-user", manageable: true })),
    ).toBe(true);
    expect(isSkillDeletable(skill({ scope: "plugin", manageable: true }))).toBe(
      false,
    );
  });
});

describe("accumulateRegistryPage", () => {
  it("appends pages, dedupes by id, and restarts on a search or ranking change", () => {
    const start = {
      ranking: "trending" as const,
      search: "",
      skills: [],
      hasMore: true,
    };
    const one = accumulateRegistryPage(
      start,
      {
        ranking: "trending",
        skills: [registrySkill("a/s/one")],
        hasMore: true,
      },
      "",
    );
    const two = accumulateRegistryPage(
      one,
      {
        ranking: "trending",
        skills: [registrySkill("a/s/one"), registrySkill("a/s/two")],
        hasMore: false,
      },
      "",
    );
    expect(two.skills.map((entry) => entry.id)).toEqual(["a/s/one", "a/s/two"]);
    expect(two.hasMore).toBe(false);
    const searched = accumulateRegistryPage(
      two,
      {
        ranking: "all-time",
        skills: [registrySkill("a/s/three")],
        hasMore: false,
      },
      "three",
    );
    expect(searched.skills.map((entry) => entry.id)).toEqual(["a/s/three"]);
    expect(searched.ranking).toBe("all-time");
  });
});

describe("pickRegistrySkillFile", () => {
  it("prefers the selection, then SKILL.md, then any markdown, then the first file", () => {
    const files = [
      { path: "scripts/run.sh", contents: "#!/bin/sh" },
      { path: "README.md", contents: "# readme" },
      { path: "SKILL.md", contents: "# skill" },
    ];
    expect(pickRegistrySkillFile(files, null)?.path).toBe("SKILL.md");
    expect(pickRegistrySkillFile(files, "README.md")?.path).toBe("README.md");
    expect(pickRegistrySkillFile(files, "missing.txt")?.path).toBe("SKILL.md");
    expect(pickRegistrySkillFile(files.slice(0, 2), null)?.path).toBe(
      "README.md",
    );
    expect(pickRegistrySkillFile(files.slice(0, 1), null)?.path).toBe(
      "scripts/run.sh",
    );
    expect(pickRegistrySkillFile(null, null)).toBeNull();
  });
});

describe("resolveInstalledRegistrySkill", () => {
  it("matches only the manageable user-scope install recorded for the registry id", () => {
    const entry = registrySkill("acme/skills/x");
    const installed = skill({
      scope: "bb-user",
      manageable: true,
      registrySkillId: entry.id,
    });
    expect(resolveInstalledRegistrySkill(entry, [installed])).toBe(installed);
    expect(
      resolveInstalledRegistrySkill(entry, [
        { ...installed, scope: "bb-project" },
      ]),
    ).toBeNull();
  });
});
