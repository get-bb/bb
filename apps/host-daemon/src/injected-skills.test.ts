import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentRuntimeClaudeCodeSkillRoot,
  AgentRuntimeCodexSkillRoot,
  AgentRuntimeSkillRoot,
} from "@bb/agent-runtime";
import type { HostDaemonInjectedSkillSource } from "@bb/host-daemon-contract";
import {
  cleanupInjectedSkillStagingDirs,
  ensureDataDirSkillsRootPath,
  stageInjectedSkillSources,
} from "./injected-skills.js";

interface WriteSkillArgs {
  body?: string;
  name: string;
  rootPath: string;
}

interface StageSourceArgs {
  dataDir: string;
  skillRootPath: string;
  skillName: string;
}

interface CapturedWarning {
  context: object;
  message: string;
}

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "bb-host-skills-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function isCodexSkillRoot(
  root: AgentRuntimeSkillRoot,
): root is AgentRuntimeCodexSkillRoot {
  return root.providerId === "codex";
}

function isClaudeCodeSkillRoot(
  root: AgentRuntimeSkillRoot,
): root is AgentRuntimeClaudeCodeSkillRoot {
  return root.providerId === "claude-code";
}

async function writeSkill(args: WriteSkillArgs): Promise<string> {
  const skillRootPath = path.join(args.rootPath, args.name);
  await mkdir(path.join(skillRootPath, "references"), { recursive: true });
  await writeFile(
    path.join(skillRootPath, "SKILL.md"),
    [
      "---",
      `name: ${args.name}`,
      `description: Use ${args.name} when host staging tests run.`,
      "---",
      "",
      args.body ?? "# Skill",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(skillRootPath, "references", "notes.md"),
    "supporting notes\n",
    "utf8",
  );
  return skillRootPath;
}

function createDataDirSource(args: StageSourceArgs): HostDaemonInjectedSkillSource {
  return {
    sourceType: "data-dir",
    applicationId: null,
    name: args.skillName,
    description: `Use ${args.skillName} when host staging tests run.`,
    sourceRootPath: args.skillRootPath,
    skillFilePath: path.join(args.skillRootPath, "SKILL.md"),
  };
}

describe("data-dir skills root", () => {
  it("creates the global skills root so the watcher can subscribe", async () => {
    const dataDir = await makeTempDir();

    const skillsRootPath = await ensureDataDirSkillsRootPath(dataDir);

    expect(skillsRootPath).toBe(path.join(dataDir, "skills"));
    await expect(
      lstat(skillsRootPath).then((stats) => stats.isDirectory()),
    ).resolves.toBe(true);
  });
});

describe("injected skill staging", () => {
  it("creates a shared staged snapshot for Codex and Claude Code", async () => {
    const dataDir = await makeTempDir();
    const skillRootPath = await writeSkill({
      rootPath: path.join(dataDir, "source-skills"),
      name: "release-notes",
    });

    const staged = await stageInjectedSkillSources({
      dataDir,
      injectedSkillSources: [
        createDataDirSource({
          dataDir,
          skillName: "release-notes",
          skillRootPath,
        }),
      ],
    });

    const codexRoot = staged.skillRoots.find(isCodexSkillRoot);
    const claudeRoot = staged.skillRoots.find(isClaudeCodeSkillRoot);
    expect(codexRoot).toEqual({
      id: `global-skills:${staged.catalogHash}:codex`,
      providerId: "codex",
      skillDirectoryRootPath: path.join(
        dataDir,
        "runtime",
        "global-skills",
        staged.catalogHash,
        "skills",
      ),
    });
    expect(claudeRoot).toEqual({
      id: `global-skills:${staged.catalogHash}:claude-code`,
      providerId: "claude-code",
      localPluginPath: path.join(
        dataDir,
        "runtime",
        "global-skills",
        staged.catalogHash,
      ),
    });

    if (!claudeRoot) {
      throw new Error("Expected Claude Code skill root");
    }
    await expect(
      readFile(
        path.join(claudeRoot.localPluginPath, "skills", "release-notes", "SKILL.md"),
        "utf8",
      ),
    ).resolves.toContain("name: release-notes");
    await expect(
      readFile(
        path.join(
          claudeRoot.localPluginPath,
          "skills",
          "release-notes",
          "references",
          "notes.md",
        ),
        "utf8",
      ),
    ).resolves.toBe("supporting notes\n");
    await expect(
      readFile(
        path.join(claudeRoot.localPluginPath, ".claude-plugin", "plugin.json"),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      name: "bb-global-skills",
      skills: ["./skills/release-notes"],
    });
  });

  it("stages built-in skill sources into the shared catalog", async () => {
    const dataDir = await makeTempDir();
    const bundledRoot = await makeTempDir();
    const skillRootPath = await writeSkill({
      rootPath: bundledRoot,
      name: "building-bb-apps",
    });

    const staged = await stageInjectedSkillSources({
      dataDir,
      injectedSkillSources: [
        {
          sourceType: "builtin",
          applicationId: null,
          name: "building-bb-apps",
          description: "Use building-bb-apps when host staging tests run.",
          sourceRootPath: skillRootPath,
          skillFilePath: path.join(skillRootPath, "SKILL.md"),
        },
      ],
    });

    const claudeRoot = staged.skillRoots.find(isClaudeCodeSkillRoot);
    if (!claudeRoot) {
      throw new Error("Expected Claude Code skill root");
    }
    await expect(
      readFile(
        path.join(claudeRoot.localPluginPath, ".claude-plugin", "plugin.json"),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      skills: ["./skills/building-bb-apps"],
    });
    await expect(
      readFile(
        path.join(claudeRoot.localPluginPath, "catalog.json"),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      catalogHash: staged.catalogHash,
      skills: [
        {
          applicationId: null,
          name: "building-bb-apps",
          sourceRootPath: skillRootPath,
          sourceType: "builtin",
        },
      ],
    });
  });

  it("changes the catalog hash when skill content changes", async () => {
    const dataDir = await makeTempDir();
    const sourceRootPath = path.join(dataDir, "source-skills");
    const skillRootPath = await writeSkill({
      body: "first body",
      rootPath: sourceRootPath,
      name: "release-notes",
    });
    const source = createDataDirSource({
      dataDir,
      skillName: "release-notes",
      skillRootPath,
    });
    const first = await stageInjectedSkillSources({
      dataDir,
      injectedSkillSources: [source],
    });

    await writeFile(
      path.join(skillRootPath, "SKILL.md"),
      [
        "---",
        "name: release-notes",
        "description: Use release-notes when host staging tests run.",
        "---",
        "",
        "second body",
        "",
      ].join("\n"),
      "utf8",
    );
    const second = await stageInjectedSkillSources({
      dataDir,
      injectedSkillSources: [source],
    });

    expect(second.catalogHash).not.toBe(first.catalogHash);
  });

  it("stages the same catalog concurrently without sharing temp directories", async () => {
    const dataDir = await makeTempDir();
    const skillRootPath = await writeSkill({
      rootPath: path.join(dataDir, "source-skills"),
      name: "release-notes",
    });
    const source = createDataDirSource({
      dataDir,
      skillName: "release-notes",
      skillRootPath,
    });
    const fixedTime = vi.spyOn(Date, "now").mockReturnValue(1_781_053_873_372);

    try {
      const staged = await Promise.all(
        Array.from({ length: 12 }, () =>
          stageInjectedSkillSources({
            dataDir,
            injectedSkillSources: [source],
          }),
        ),
      );

      const catalogHashes = new Set(staged.map((entry) => entry.catalogHash));
      expect(catalogHashes.size).toBe(1);
      const firstStaged = staged[0];
      if (!firstStaged) {
        throw new Error("Expected staged skill catalogs");
      }
      for (const entry of staged) {
        const codexRoot = entry.skillRoots.find(isCodexSkillRoot);
        expect(codexRoot?.skillDirectoryRootPath).toBe(
          path.join(
            dataDir,
            "runtime",
            "global-skills",
            entry.catalogHash,
            "skills",
          ),
        );
      }
      await expect(
        readFile(
          path.join(
            dataDir,
            "runtime",
            "global-skills",
            firstStaged.catalogHash,
            "skills",
            "release-notes",
            "SKILL.md",
          ),
          "utf8",
        ),
      ).resolves.toContain("Use release-notes");
    } finally {
      fixedTime.mockRestore();
    }
  });

  it("skips symlinked files during staging", async () => {
    const dataDir = await makeTempDir();
    const outsideDir = await makeTempDir();
    const skillRootPath = await writeSkill({
      rootPath: path.join(dataDir, "source-skills"),
      name: "release-notes",
    });
    await writeFile(path.join(outsideDir, "escape.md"), "escape\n", "utf8");
    await symlink(
      path.join(outsideDir, "escape.md"),
      path.join(skillRootPath, "references", "escape.md"),
    );
    const warnings: CapturedWarning[] = [];

    const staged = await stageInjectedSkillSources({
      dataDir,
      injectedSkillSources: [
        createDataDirSource({
          dataDir,
          skillName: "release-notes",
          skillRootPath,
        }),
      ],
      logger: {
        debug: () => undefined,
        warn: (context, message) => {
          warnings.push({ context, message });
        },
      },
    });

    expect(staged.skillRoots).toEqual([]);
    expect(warnings).toEqual([
      expect.objectContaining({
        message: "Skipping injected skill during staging",
      }),
    ]);
  });
});

describe("cleanupInjectedSkillStagingDirs", () => {
  async function makeStagingRoot(): Promise<{
    dataDir: string;
    stagingRootPath: string;
  }> {
    const dataDir = await makeTempDir();
    const stagingRootPath = path.join(dataDir, "runtime", "global-skills");
    await mkdir(stagingRootPath, { recursive: true });
    return { dataDir, stagingRootPath };
  }

  async function exists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  it("keeps fresh .tmp- dirs that may belong to an in-flight staging", async () => {
    const { dataDir, stagingRootPath } = await makeStagingRoot();
    const inFlightTempPath = path.join(stagingRootPath, ".tmp-hash-123-456");
    await mkdir(path.join(inFlightTempPath, "skills"), { recursive: true });

    await cleanupInjectedSkillStagingDirs({ dataDir, keepCatalogHashes: [] });

    expect(await exists(inFlightTempPath)).toBe(true);
  });

  it("removes stale .tmp- dirs left behind by crashed stagings", async () => {
    const { dataDir, stagingRootPath } = await makeStagingRoot();
    const staleTempPath = path.join(stagingRootPath, ".tmp-hash-789-101");
    await mkdir(staleTempPath, { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(staleTempPath, twoHoursAgo, twoHoursAgo);

    await cleanupInjectedSkillStagingDirs({ dataDir, keepCatalogHashes: [] });

    expect(await exists(staleTempPath)).toBe(false);
  });

  it("removes unkept catalog dirs while keeping kept ones", async () => {
    const { dataDir, stagingRootPath } = await makeStagingRoot();
    const keptPath = path.join(stagingRootPath, "hash-keep");
    const unkeptPath = path.join(stagingRootPath, "hash-drop");
    await mkdir(keptPath, { recursive: true });
    await mkdir(unkeptPath, { recursive: true });

    await cleanupInjectedSkillStagingDirs({
      dataDir,
      keepCatalogHashes: ["hash-keep"],
    });

    expect(await exists(keptPath)).toBe(true);
    expect(await exists(unkeptPath)).toBe(false);
  });
});

describe("concurrent staging", () => {
  it("lets parallel stagings of the same catalog all succeed", async () => {
    const dataDir = await makeTempDir();
    const skillRootPath = await writeSkill({
      rootPath: path.join(dataDir, "source-skills"),
      name: "release-notes",
    });
    const source = createDataDirSource({
      dataDir,
      skillName: "release-notes",
      skillRootPath,
    });

    const staged = await Promise.all(
      Array.from({ length: 8 }, () =>
        stageInjectedSkillSources({
          dataDir,
          injectedSkillSources: [source],
        }),
      ),
    );

    const hashes = new Set(staged.map((result) => result.catalogHash));
    expect(hashes.size).toBe(1);
    const [catalogHash] = hashes;
    await expect(
      readFile(
        path.join(
          dataDir,
          "runtime",
          "global-skills",
          catalogHash ?? "",
          "catalog.json",
        ),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({ catalogHash });
  });
});
