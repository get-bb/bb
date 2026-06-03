import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentRuntimeClaudeCodeSkillRoot,
  AgentRuntimeCodexSkillRoot,
  AgentRuntimeSkillRoot,
} from "@bb/agent-runtime";
import type { HostDaemonInjectedSkillSource } from "@bb/host-daemon-contract";
import { stageInjectedSkillSources } from "./injected-skills.js";

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
      skillNames: ["release-notes"],
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
