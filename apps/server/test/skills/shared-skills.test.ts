import { describe, expect, it, vi } from "vitest";
import type { DiscoveredSkill } from "@bb/host-daemon-contract";
import type { ServerLogger } from "../../src/types.js";
import { excludeNativeSkillDuplicates } from "../../src/services/skills/shared-skills.js";

function discoveredSkill(args: {
  contentHash?: string;
  filePath: string;
  name: string;
  rootKind: DiscoveredSkill["rootKind"];
}): DiscoveredSkill {
  return {
    ...(args.contentHash === undefined
      ? {}
      : { contentHash: args.contentHash }),
    id: `skill_${"a".repeat(64)}`,
    name: args.name,
    description: "Test skill.",
    filePath: args.filePath,
    rootKind: args.rootKind,
    linked: false,
  };
}

describe("excludeNativeSkillDuplicates", () => {
  it("removes a non-project injected skill with the same whole-tree hash", () => {
    const logger: ServerLogger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const contentHash = "b".repeat(64);
    const result = excludeNativeSkillDuplicates(logger, {
      providerId: "codex",
      nativeSkills: [
        discoveredSkill({
          contentHash,
          filePath: "/home/test/.agents/skills/coder/SKILL.md",
          name: "coder",
          rootKind: "provider-user",
        }),
      ],
      skillCatalog: [
        {
          provenance: { kind: "user" },
          runtimeSource: {
            kind: "tree",
            sourceType: "data-dir",
            name: "coder",
            description: "Test skill.",
            treeHash: contentHash,
            entryPath: "SKILL.md",
          },
        },
      ],
    });

    expect(result).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("preserves and warns about a same-name skill with different content", () => {
    const logger: ServerLogger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const result = excludeNativeSkillDuplicates(logger, {
      providerId: "codex",
      nativeSkills: [
        discoveredSkill({
          contentHash: "b".repeat(64),
          filePath: "/home/test/.codex/skills/coder/SKILL.md",
          name: "coder",
          rootKind: "provider-user",
        }),
      ],
      skillCatalog: [
        {
          provenance: { kind: "user" },
          runtimeSource: {
            kind: "tree",
            sourceType: "data-dir",
            name: "coder",
            description: "Shared test skill.",
            treeHash: "c".repeat(64),
            entryPath: "SKILL.md",
          },
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "coder",
        providerId: "codex",
      }),
      "Injected skill conflicts with a provider native skill; preserving both",
    );
  });

  it("preserves a project skill even when its native counterpart is identical", () => {
    const logger: ServerLogger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const contentHash = "b".repeat(64);
    const result = excludeNativeSkillDuplicates(logger, {
      providerId: "codex",
      nativeSkills: [
        discoveredSkill({
          contentHash,
          filePath: "/home/test/.agents/skills/coder/SKILL.md",
          name: "coder",
          rootKind: "provider-user",
        }),
      ],
      skillCatalog: [
        {
          provenance: { kind: "project" },
          runtimeSource: {
            kind: "workspace-path",
            sourceType: "project",
            name: "coder",
            description: "Project override.",
            sourceRootPath: "/workspace/.bb/skills/coder",
            skillFilePath: "/workspace/.bb/skills/coder/SKILL.md",
          },
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it("surfaces differing native content while suppressing an identical injected copy", () => {
    const logger: ServerLogger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const matchingHash = "b".repeat(64);
    const result = excludeNativeSkillDuplicates(logger, {
      providerId: "codex",
      nativeSkills: [
        discoveredSkill({
          contentHash: matchingHash,
          filePath: "/home/test/.agents/skills/coder/SKILL.md",
          name: "coder",
          rootKind: "provider-user",
        }),
        discoveredSkill({
          contentHash: "c".repeat(64),
          filePath: "/workspace/.agents/skills/coder/SKILL.md",
          name: "coder",
          rootKind: "provider-project",
        }),
      ],
      skillCatalog: [
        {
          provenance: { kind: "user" },
          runtimeSource: {
            kind: "tree",
            sourceType: "data-dir",
            name: "coder",
            description: "Test skill.",
            treeHash: matchingHash,
            entryPath: "SKILL.md",
          },
        },
      ],
    });

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHash: matchingHash,
        name: "coder",
        nativeContentHashes: [matchingHash, "c".repeat(64)],
        providerId: "codex",
      }),
      "Provider native skills have conflicting content; suppressing identical injected skill",
    );
  });
});
