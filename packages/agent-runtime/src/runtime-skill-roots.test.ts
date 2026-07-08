import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterSkillRootsForProvider,
  normalizeSkillRoots,
} from "./runtime-skill-roots.js";

describe("runtime skill roots", () => {
  it("normalizes provider-specific skill roots", () => {
    const roots = normalizeSkillRoots({
      skillRoots: [
        {
          id: "codex-root",
          providerId: "codex",
          skillDirectoryRootPath: "/tmp/codex-skills",
        },
        {
          id: "claude-root",
          providerId: "claude-code",
          localPluginPath: "/tmp/claude-plugin",
        },
        {
          id: "pi-root",
          providerId: "pi",
          skillDirectoryRootPath: "/tmp/pi-skills",
        },
        {
          id: "acp-root",
          providerId: "acp",
          skillDirectoryRootPath: "/tmp/acp-skills",
          skills: [
            {
              description: "Use the ACP test skill.",
              name: "acp-test",
            },
          ],
        },
      ],
    });

    expect(roots).toEqual([
      {
        id: "codex-root",
        providerId: "codex",
        skillDirectoryRootPath: "/tmp/codex-skills",
      },
      {
        id: "claude-root",
        providerId: "claude-code",
        localPluginPath: "/tmp/claude-plugin",
      },
      {
        id: "pi-root",
        providerId: "pi",
        skillDirectoryRootPath: "/tmp/pi-skills",
      },
      {
        id: "acp-root",
        providerId: "acp",
        skillDirectoryRootPath: "/tmp/acp-skills",
        skills: [
          {
            description: "Use the ACP test skill.",
            name: "acp-test",
          },
        ],
      },
    ]);
  });

  it("filters roots to the exact provider", () => {
    const roots = normalizeSkillRoots({
      skillRoots: [
        {
          id: "codex-root",
          providerId: "codex",
          skillDirectoryRootPath: "/tmp/codex-skills",
        },
        {
          id: "pi-root",
          providerId: "pi",
          skillDirectoryRootPath: "/tmp/pi-skills",
        },
      ],
    });

    expect(
      filterSkillRootsForProvider({ providerId: "codex", skillRoots: roots }),
    ).toEqual([
      {
        id: "codex-root",
        providerId: "codex",
        skillDirectoryRootPath: "/tmp/codex-skills",
      },
    ]);
    expect(
      filterSkillRootsForProvider({
        providerId: "claude-code",
        skillRoots: roots,
      }),
    ).toEqual([]);
  });

  it("filters generic ACP roots to any ACP provider id", () => {
    const roots = normalizeSkillRoots({
      skillRoots: [
        {
          id: "acp-root",
          providerId: "acp",
          skillDirectoryRootPath: "/tmp/acp-skills",
          skills: [
            {
              description: "Use the ACP test skill.",
              name: "acp-test",
            },
          ],
        },
      ],
    });

    expect(
      filterSkillRootsForProvider({
        providerId: "acp-cursor",
        skillRoots: roots,
      }),
    ).toEqual([
      {
        id: "acp-root",
        providerId: "acp",
        skillDirectoryRootPath: "/tmp/acp-skills",
        skills: [
          {
            description: "Use the ACP test skill.",
            name: "acp-test",
          },
        ],
      },
    ]);
    expect(
      filterSkillRootsForProvider({
        providerId: "acp-custom",
        skillRoots: roots,
      }),
    ).toHaveLength(1);
    expect(
      filterSkillRootsForProvider({
        providerId: "codex",
        skillRoots: roots,
      }),
    ).toEqual([]);
  });

  it("rejects relative provider-specific paths", () => {
    expect(() =>
      normalizeSkillRoots({
        skillRoots: [
          {
            id: "codex-root",
            providerId: "codex",
            skillDirectoryRootPath: join("relative", "codex-skills"),
          },
        ],
      }),
    ).toThrow(/absolute skillDirectoryRootPath/);

    expect(() =>
      normalizeSkillRoots({
        skillRoots: [
          {
            id: "claude-root",
            providerId: "claude-code",
            localPluginPath: join("relative", "claude-plugin"),
          },
        ],
      }),
    ).toThrow(/absolute localPluginPath/);

    expect(() =>
      normalizeSkillRoots({
        skillRoots: [
          {
            id: "acp-root",
            providerId: "acp",
            skillDirectoryRootPath: join("relative", "acp-skills"),
            skills: [],
          },
        ],
      }),
    ).toThrow(/absolute skillDirectoryRootPath/);
  });
});
