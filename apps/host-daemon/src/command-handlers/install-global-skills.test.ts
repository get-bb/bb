import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { hashSkillTreeFiles } from "@bb/host-daemon-contract/skill-tree";
import type { SkillTreeTransport } from "../skill-trees.js";
import {
  installGlobalSkills,
  readGlobalSkillsStatus,
} from "./install-global-skills.js";

const logger = { debug: () => undefined, warn: () => undefined };

function createTreePayload(name: string, body: string) {
  const contents = new Map([
    [
      "SKILL.md",
      Buffer.from(
        `---\nname: ${name}\ndescription: Use ${name} outside bb.\n---\n\n${body}\n`,
      ),
    ],
    ["references/usage.md", Buffer.from(`# ${name}\n`)],
  ]);
  const files = [...contents].map(([filePath, content]) => ({
    path: filePath,
    mode: 0o644,
    sizeBytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  }));
  const treeHash = hashSkillTreeFiles(files);
  const skillTreeTransport: SkillTreeTransport = {
    fetchManifest: async () => ({ treeHash, files }),
    fetchContent: async (_treeHash, paths) =>
      (async function* () {
        for (const filePath of paths) {
          yield contents.get(filePath) ?? Buffer.alloc(0);
        }
      })(),
  };
  return { skillTreeTransport, treeHash };
}

describe("install global skills", () => {
  it("writes the skill into both global agent roots", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const payload = createTreePayload("bb-cli", "first body");

    const result = await installGlobalSkills(
      {
        type: "host.install_global_skills",
        skills: [
          { name: "bb-cli", treeHash: payload.treeHash, entryPath: "SKILL.md" },
        ],
      },
      {
        dataDir,
        homeDir,
        logger,
        skillTreeTransport: payload.skillTreeTransport,
      },
    );

    expect(result.installations.map((entry) => entry.path)).toEqual([
      path.join(homeDir, ".agents", "skills", "bb-cli"),
      path.join(homeDir, ".claude", "skills", "bb-cli"),
    ]);
    for (const installation of result.installations) {
      await expect(
        readFile(path.join(installation.path, "SKILL.md"), "utf8"),
      ).resolves.toContain("first body");
      await expect(
        readFile(
          path.join(installation.path, "references", "usage.md"),
          "utf8",
        ),
      ).resolves.toBe("# bb-cli\n");
    }
  });

  it("replaces a stale copy without leaving its removed files or staging dirs behind", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const claudeRoot = path.join(homeDir, ".claude", "skills");
    await mkdir(path.join(claudeRoot, "bb-cli"), { recursive: true });
    await writeFile(path.join(claudeRoot, "bb-cli", "SKILL.md"), "stale\n");
    await writeFile(path.join(claudeRoot, "bb-cli", "dropped.md"), "gone\n");
    await mkdir(path.join(claudeRoot, "unrelated"), { recursive: true });
    await writeFile(path.join(claudeRoot, "unrelated", "SKILL.md"), "keep\n");
    const payload = createTreePayload("bb-cli", "fresh body");

    await installGlobalSkills(
      {
        type: "host.install_global_skills",
        skills: [
          { name: "bb-cli", treeHash: payload.treeHash, entryPath: "SKILL.md" },
        ],
      },
      {
        dataDir,
        homeDir,
        logger,
        skillTreeTransport: payload.skillTreeTransport,
      },
    );

    await expect(
      readFile(path.join(claudeRoot, "bb-cli", "SKILL.md"), "utf8"),
    ).resolves.toContain("fresh body");
    expect((await readdir(path.join(claudeRoot, "bb-cli"))).sort()).toEqual([
      "SKILL.md",
      "references",
    ]);
    expect((await readdir(claudeRoot)).sort()).toEqual(["bb-cli", "unrelated"]);
  });

  it("leaves the installed copy intact when the tree cannot be fetched", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const agentsRoot = path.join(homeDir, ".agents", "skills");
    await mkdir(path.join(agentsRoot, "bb-cli"), { recursive: true });
    await writeFile(path.join(agentsRoot, "bb-cli", "SKILL.md"), "previous\n");
    const payload = createTreePayload("bb-cli", "never arrives");
    const skillTreeTransport: SkillTreeTransport = {
      ...payload.skillTreeTransport,
      fetchManifest: vi.fn(async () => {
        throw new Error("offline");
      }),
    };

    await expect(
      installGlobalSkills(
        {
          type: "host.install_global_skills",
          skills: [
            {
              name: "bb-cli",
              treeHash: payload.treeHash,
              entryPath: "SKILL.md",
            },
          ],
        },
        { dataDir, homeDir, logger, skillTreeTransport },
      ),
    ).rejects.toThrow("offline");

    await expect(
      readFile(path.join(agentsRoot, "bb-cli", "SKILL.md"), "utf8"),
    ).resolves.toBe("previous\n");
  });

  it.skipIf(process.platform === "win32")(
    "reports the installed hash as the tree hash, and detects drift",
    async () => {
      const dataDir = await makeTempDir();
      const homeDir = await makeTempDir();
      const payload = createTreePayload("bb-cli", "installed body");
      const command = {
        type: "host.install_global_skills" as const,
        skills: [
          { name: "bb-cli", treeHash: payload.treeHash, entryPath: "SKILL.md" },
        ],
      };
      const statusCommand = {
        type: "host.global_skills_status" as const,
        names: ["bb-cli"],
      };

      const before = await readGlobalSkillsStatus(statusCommand, { homeDir });
      expect(before.entries.map((entry) => entry.treeHash)).toEqual([
        null,
        null,
      ]);

      await installGlobalSkills(command, {
        dataDir,
        homeDir,
        logger,
        skillTreeTransport: payload.skillTreeTransport,
      });

      const after = await readGlobalSkillsStatus(statusCommand, { homeDir });
      expect(after.entries.map((entry) => entry.treeHash)).toEqual([
        payload.treeHash,
        payload.treeHash,
      ]);

      await writeFile(
        path.join(homeDir, ".claude", "skills", "bb-cli", "SKILL.md"),
        "---\nname: bb-cli\ndescription: Edited by hand.\n---\n",
      );
      const drifted = await readGlobalSkillsStatus(statusCommand, { homeDir });
      expect(drifted.entries[1]?.treeHash).not.toBe(payload.treeHash);
      expect(drifted.entries[0]?.treeHash).toBe(payload.treeHash);
    },
  );
});
