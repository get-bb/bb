import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBuiltinSkillsRootPath } from "../../src/services/skills/builtin-skills-copy.js";
import { resolveInjectedSkillSources } from "../../src/services/skills/injected-skills.js";
import type { ServerLogger } from "../../src/types.js";

interface CapturedLog {
  context: object;
  message: string;
}

interface CapturingLogger {
  infos: CapturedLog[];
  logger: ServerLogger;
  warnings: CapturedLog[];
}

interface WriteSkillArgs {
  description?: string;
  name: string;
  rootPath: string;
}

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "bb-injected-skills-"));
  tempDirs.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function createCapturingLogger(): CapturingLogger {
  const infos: CapturedLog[] = [];
  const warnings: CapturedLog[] = [];
  function captureTo(target: CapturedLog[]) {
    return (...args: Parameters<ServerLogger["warn"]>): void => {
      const firstArg = args[0];
      const secondArg = args[1];
      target.push({
        context:
          typeof firstArg === "object" && firstArg !== null ? firstArg : {},
        message:
          typeof secondArg === "string"
            ? secondArg
            : typeof firstArg === "string"
              ? firstArg
              : "",
      });
    };
  }
  return {
    infos,
    warnings,
    logger: {
      debug: () => undefined,
      error: () => undefined,
      info: captureTo(infos),
      warn: captureTo(warnings),
    },
  };
}

async function writeSkill(args: WriteSkillArgs): Promise<string> {
  const skillRootPath = path.join(args.rootPath, args.name);
  await mkdir(skillRootPath, { recursive: true });
  await writeFile(
    path.join(skillRootPath, "SKILL.md"),
    [
      "---",
      `name: ${args.name}`,
      `description: ${args.description ?? `Use ${args.name} when tests need it.`}`,
      "---",
      "",
      `# ${args.name}`,
      "",
    ].join("\n"),
    "utf8",
  );
  return skillRootPath;
}

describe("injected skill source discovery", () => {
  it("aggregates valid data-dir skills", async () => {
    const dataDir = await makeTempDir();
    const dataDirSkillRoot = await writeSkill({
      rootPath: path.join(dataDir, "skills"),
      name: "release-notes",
    });
    const { logger } = createCapturingLogger();

    const sources = await resolveInjectedSkillSources(logger, {
      builtinSkillsRootPath: path.join(dataDir, "builtin-skills"),
      dataDir,
    });

    expect(sources).toEqual([
      {
        sourceType: "data-dir",
        name: "release-notes",
        description: "Use release-notes when tests need it.",
        sourceRootPath: dataDirSkillRoot,
        skillFilePath: path.join(dataDirSkillRoot, "SKILL.md"),
      },
    ]);
  });

  it("skips invalid skills and logs the reason", async () => {
    const dataDir = await makeTempDir();
    const skillRootPath = path.join(dataDir, "skills", "valid-name");
    await mkdir(skillRootPath, { recursive: true });
    await writeFile(
      path.join(skillRootPath, "SKILL.md"),
      [
        "---",
        "name: other-name",
        "description: Use when the mismatch test runs.",
        "---",
        "",
      ].join("\n"),
      "utf8",
    );
    const { logger, warnings } = createCapturingLogger();

    expect(
      resolveInjectedSkillSources(logger, {
        builtinSkillsRootPath: path.join(dataDir, "builtin-skills"),
        dataDir,
      }),
    ).toEqual([]);
    expect(warnings).toEqual([
      expect.objectContaining({
        message: "Skipping invalid injected skill",
      }),
    ]);
    expect(warnings[0]?.context).toMatchObject({
      candidatePath: skillRootPath,
      reason: "Frontmatter name must match the skill directory name",
      sourceType: "data-dir",
    });
  });

  it("rejects symlinked skill directories", async () => {
    const dataDir = await makeTempDir();
    const outsideRoot = await makeTempDir();
    const skillsRootPath = path.join(dataDir, "skills");
    await mkdir(skillsRootPath, { recursive: true });
    await writeSkill({
      rootPath: outsideRoot,
      name: "outside-skill",
    });
    await symlink(
      path.join(outsideRoot, "outside-skill"),
      path.join(skillsRootPath, "outside-skill"),
    );
    const { logger, warnings } = createCapturingLogger();

    expect(
      resolveInjectedSkillSources(logger, {
        builtinSkillsRootPath: path.join(dataDir, "builtin-skills"),
        dataDir,
      }),
    ).toEqual([]);
    expect(warnings[0]?.context).toMatchObject({
      reason: "Skill directory is a symlink",
      sourceType: "data-dir",
    });
  });

  it("aggregates built-in skills alongside user skills", async () => {
    const dataDir = await makeTempDir();
    const builtinSkillsRootPath = path.join(dataDir, "builtin-skills");
    const builtinSkillRoot = await writeSkill({
      rootPath: builtinSkillsRootPath,
      name: "bb-cli",
    });
    const dataDirSkillRoot = await writeSkill({
      rootPath: path.join(dataDir, "skills"),
      name: "release-notes",
    });
    const { logger, warnings } = createCapturingLogger();

    const sources = await resolveInjectedSkillSources(logger, {
      builtinSkillsRootPath,
      dataDir,
    });

    expect(sources).toEqual([
      {
        sourceType: "builtin",
        name: "bb-cli",
        description: "Use bb-cli when tests need it.",
        sourceRootPath: builtinSkillRoot,
        skillFilePath: path.join(builtinSkillRoot, "SKILL.md"),
      },
      {
        sourceType: "data-dir",
        name: "release-notes",
        description: "Use release-notes when tests need it.",
        sourceRootPath: dataDirSkillRoot,
        skillFilePath: path.join(dataDirSkillRoot, "SKILL.md"),
      },
    ]);
    expect(warnings).toEqual([]);
  });

  it("lets a data-dir skill override a built-in skill with the same name", async () => {
    const dataDir = await makeTempDir();
    const builtinSkillsRootPath = path.join(dataDir, "builtin-skills");
    await writeSkill({
      rootPath: builtinSkillsRootPath,
      name: "bb-cli",
      description: "Built-in copy.",
    });
    const overrideSkillRoot = await writeSkill({
      rootPath: path.join(dataDir, "skills"),
      name: "bb-cli",
      description: "User override copy.",
    });
    const { logger, infos, warnings } = createCapturingLogger();

    const sources = await resolveInjectedSkillSources(logger, {
      builtinSkillsRootPath,
      dataDir,
    });

    expect(sources).toEqual([
      {
        sourceType: "data-dir",
        name: "bb-cli",
        description: "User override copy.",
        sourceRootPath: overrideSkillRoot,
        skillFilePath: path.join(overrideSkillRoot, "SKILL.md"),
      },
    ]);
    expect(warnings).toEqual([]);
    expect(infos).toEqual([
      expect.objectContaining({
        message: "Built-in injected skill overridden by user skill",
      }),
    ]);
  });

  it("resolves the bundled built-in skills root with valid built-in skills", async () => {
    const dataDir = await makeTempDir();
    const builtinSkillsRootPath = resolveBuiltinSkillsRootPath();
    const { logger, warnings } = createCapturingLogger();

    const sources = await resolveInjectedSkillSources(logger, {
      builtinSkillsRootPath,
      dataDir,
    });

    const builtinNames = sources.map((source) => source.name);
    expect(builtinNames).toContain("bb-cli");
    for (const source of sources) {
      expect(source.sourceType).toBe("builtin");
      expect(source.description.trim().length).toBeGreaterThan(0);
    }
    expect(warnings).toEqual([]);
  });
});
