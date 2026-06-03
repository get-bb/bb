import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveApplicationPath } from "@bb/config/app-storage-paths";
import { applicationIdSchema, type ApplicationId } from "@bb/domain";
import { resolveInjectedSkillSources } from "../../src/services/skills/injected-skills.js";
import type { ServerLogger } from "../../src/types.js";

interface CapturedWarning {
  context: object;
  message: string;
}

interface CapturingLogger {
  logger: ServerLogger;
  warnings: CapturedWarning[];
}

interface WriteSkillArgs {
  description?: string;
  name: string;
  rootPath: string;
}

interface WriteApplicationArgs {
  applicationId: ApplicationId;
  dataDir: string;
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
  const warnings: CapturedWarning[] = [];
  function captureWarning(...args: Parameters<ServerLogger["warn"]>): void {
    const firstArg = args[0];
    const secondArg = args[1];
    warnings.push({
      context:
        typeof firstArg === "object" && firstArg !== null ? firstArg : {},
      message:
        typeof secondArg === "string"
          ? secondArg
          : typeof firstArg === "string"
            ? firstArg
            : "",
    });
  }
  return {
    warnings,
    logger: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: captureWarning,
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

async function writeApplication(args: WriteApplicationArgs): Promise<string> {
  const appRootPath = resolveApplicationPath(args.dataDir, args.applicationId);
  await mkdir(appRootPath, { recursive: true });
  await writeFile(
    path.join(appRootPath, "manifest.json"),
    `${JSON.stringify(
      {
        manifestVersion: 1,
        id: args.applicationId,
        name: "Skill Test App",
        capabilities: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return appRootPath;
}

describe("injected skill source discovery", () => {
  it("aggregates valid data-dir and global app skills", async () => {
    const dataDir = await makeTempDir();
    const applicationId = applicationIdSchema.parse("skillstest");
    const appRootPath = await writeApplication({ dataDir, applicationId });
    const dataDirSkillRoot = await writeSkill({
      rootPath: path.join(dataDir, "skills"),
      name: "release-notes",
    });
    const appSkillRoot = await writeSkill({
      rootPath: path.join(appRootPath, "skills"),
      name: "summarize-trades",
    });
    const { logger } = createCapturingLogger();

    const sources = await resolveInjectedSkillSources(logger, { dataDir });

    expect(sources).toEqual([
      {
        sourceType: "data-dir",
        applicationId: null,
        name: "release-notes",
        description: "Use release-notes when tests need it.",
        sourceRootPath: dataDirSkillRoot,
        skillFilePath: path.join(dataDirSkillRoot, "SKILL.md"),
      },
      {
        sourceType: "global-app",
        applicationId,
        name: "summarize-trades",
        description: "Use summarize-trades when tests need it.",
        sourceRootPath: appSkillRoot,
        skillFilePath: path.join(appSkillRoot, "SKILL.md"),
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

    expect(resolveInjectedSkillSources(logger, { dataDir })).toEqual([]);
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

    expect(resolveInjectedSkillSources(logger, { dataDir })).toEqual([]);
    expect(warnings[0]?.context).toMatchObject({
      reason: "Skill directory is a symlink",
      sourceType: "data-dir",
    });
  });

  it("excludes all sources with colliding names across both roots", async () => {
    const dataDir = await makeTempDir();
    const applicationId = applicationIdSchema.parse("collision");
    const appRootPath = await writeApplication({ dataDir, applicationId });
    await writeSkill({
      rootPath: path.join(dataDir, "skills"),
      name: "shared-skill",
    });
    await writeSkill({
      rootPath: path.join(appRootPath, "skills"),
      name: "shared-skill",
    });
    const { logger, warnings } = createCapturingLogger();

    expect(resolveInjectedSkillSources(logger, { dataDir })).toEqual([]);
    expect(
      warnings.filter(
        (warning) => warning.message === "Skipping colliding injected skill",
      ),
    ).toHaveLength(2);
  });
});
