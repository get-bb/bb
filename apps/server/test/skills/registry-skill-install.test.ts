import { EventEmitter } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { installServerRegistrySkill } from "../../src/services/skills/registry-skill-install.js";
import { readSkillTreeManifest } from "../../src/services/skills/injected-skills.js";
import {
  readRegistrySkillProvenance,
  REGISTRY_SKILL_PROVENANCE_FILE_NAME,
} from "../../src/services/skills/registry-skill-provenance.js";

afterEach(() => {
  spawnMock.mockReset();
});

function stubDownloadedSkill(skillId: string, body?: string): void {
  spawnMock.mockImplementation(
    (_command: string, _args: string[], options: { cwd: string }) => {
      const child = new EventEmitter() as EventEmitter & {
        kill: ReturnType<typeof vi.fn>;
        stderr: EventEmitter;
        stdout: EventEmitter;
      };
      child.kill = vi.fn();
      child.stderr = new EventEmitter();
      child.stdout = new EventEmitter();
      void (async () => {
        const skillDirectory = join(options.cwd, ".agents", "skills", skillId);
        await mkdir(skillDirectory, { recursive: true });
        await writeFile(
          join(skillDirectory, "SKILL.md"),
          body ?? `---\nname: ${skillId}\ndescription: Test skill.\n---\n`,
        );
        child.emit("close", 0);
      })();
      return child;
    },
  );
}

async function writeUntaggedSkill(args: {
  dataDir: string;
  skillId: string;
  body?: string;
}): Promise<string> {
  const skillDirectory = join(args.dataDir, "skills", args.skillId);
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    args.body ?? `---\nname: ${args.skillId}\ndescription: Test skill.\n---\n`,
  );
  return skillDirectory;
}

describe("installServerRegistrySkill", () => {
  it("atomically persists the exact registry entry provenance", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-registry-install-test-"));
    try {
      stubDownloadedSkill("find-skills");

      const result = await installServerRegistrySkill({
        dataDir,
        packageRef: "vercel-labs/skills",
        registrySkillId: "github.com/vercel-labs/skills/find-skills",
        skillId: "find-skills",
      });
      const skillDirectory = join(dataDir, "skills", "find-skills");

      expect(result.filePath).toBe(join(skillDirectory, "SKILL.md"));
      expect(readRegistrySkillProvenance(skillDirectory)).toBe(
        "github.com/vercel-labs/skills/find-skills",
      );
      expect(
        (await stat(join(skillDirectory, REGISTRY_SKILL_PROVENANCE_FILE_NAME)))
          .mode & 0o777,
      ).toBe(0o444);
      expect(readSkillTreeManifest(skillDirectory).entries).toEqual([
        expect.objectContaining({ path: "SKILL.md" }),
      ]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("adopts an exact untagged pre-provenance install", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-registry-adopt-test-"));
    try {
      const skillDirectory = await writeUntaggedSkill({
        dataDir,
        skillId: "find-skills",
      });
      stubDownloadedSkill("find-skills");

      const result = await installServerRegistrySkill({
        dataDir,
        packageRef: "vercel-labs/skills",
        registrySkillId: "github.com/vercel-labs/skills/find-skills",
        skillId: "find-skills",
      });

      expect(result.filePath).toBe(join(skillDirectory, "SKILL.md"));
      expect(readRegistrySkillProvenance(skillDirectory)).toBe(
        "github.com/vercel-labs/skills/find-skills",
      );
      expect(await readFile(result.filePath, "utf8")).toBe(
        `---\nname: find-skills\ndescription: Test skill.\n---\n`,
      );
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("protects a differing manually-authored skill at the canonical path", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-registry-conflict-test-"));
    try {
      const skillDirectory = await writeUntaggedSkill({
        dataDir,
        skillId: "find-skills",
        body: `---\nname: find-skills\ndescription: Manual skill.\n---\nKeep my local instructions.\n`,
      });
      stubDownloadedSkill("find-skills");

      await expect(
        installServerRegistrySkill({
          dataDir,
          packageRef: "vercel-labs/skills",
          registrySkillId: "github.com/vercel-labs/skills/find-skills",
          skillId: "find-skills",
        }),
      ).rejects.toMatchObject({
        status: 409,
        body: { code: "skill_install_conflict" },
      });
      expect(readRegistrySkillProvenance(skillDirectory)).toBeNull();
      expect(
        await readFile(join(skillDirectory, "SKILL.md"), "utf8"),
      ).toContain("Keep my local instructions.");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("does not adopt an untagged tree containing a symlink", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-registry-symlink-test-"));
    try {
      const skillDirectory = await writeUntaggedSkill({
        dataDir,
        skillId: "find-skills",
      });
      const outsidePath = join(dataDir, "outside.txt");
      await writeFile(outsidePath, "outside\n");
      await symlink(outsidePath, join(skillDirectory, "outside-link"));
      stubDownloadedSkill("find-skills");

      await expect(
        installServerRegistrySkill({
          dataDir,
          packageRef: "vercel-labs/skills",
          registrySkillId: "github.com/vercel-labs/skills/find-skills",
          skillId: "find-skills",
        }),
      ).rejects.toMatchObject({
        status: 409,
        body: { code: "skill_install_conflict" },
      });
      expect(readRegistrySkillProvenance(skillDirectory)).toBeNull();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects a traversing skill id before spawning the installer", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "bb-registry-traversal-test-"),
    );
    try {
      await expect(
        installServerRegistrySkill({
          dataDir,
          packageRef: "vercel-labs/skills",
          registrySkillId: "github.com/vercel-labs/skills/find-skills",
          skillId: "../find-skills",
        }),
      ).rejects.toMatchObject({
        status: 400,
        body: { code: "invalid_registry_skill" },
      });
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects malformed downloaded skill metadata without adopting it", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "bb-registry-malformed-test-"),
    );
    try {
      stubDownloadedSkill(
        "find-skills",
        `---\nname: a-different-skill\ndescription: Test skill.\n---\n`,
      );

      await expect(
        installServerRegistrySkill({
          dataDir,
          packageRef: "vercel-labs/skills",
          registrySkillId: "github.com/vercel-labs/skills/find-skills",
          skillId: "find-skills",
        }),
      ).rejects.toMatchObject({
        status: 422,
        body: { code: "registry_skill_invalid" },
      });
      expect(
        readRegistrySkillProvenance(join(dataDir, "skills", "find-skills")),
      ).toBeNull();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
