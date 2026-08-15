import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBuiltinSkillsRootPath } from "../../src/services/skills/builtin-skills-copy.js";
import {
  hashSkillTreeEntries,
  readSkillTreeManifest,
  resolveInjectedSkillSources as resolveInjectedSkillSourcesWithRegistry,
  resolveServerOwnedSkillCatalogEntries,
  SkillTreeRegistry,
  type ResolveInjectedSkillSourcesArgs,
} from "../../src/services/skills/injected-skills.js";
import type { ServerLogger } from "../../src/types.js";

interface CapturedLog {
  context: object;
  message: string;
}

interface CapturingLogger {
  debugs: CapturedLog[];
  infos: CapturedLog[];
  logger: ServerLogger;
  warnings: CapturedLog[];
}

interface WriteSkillArgs {
  description?: string;
  name: string;
  rootPath: string;
}

function resolveInjectedSkillSources(
  logger: ServerLogger,
  args: Omit<ResolveInjectedSkillSourcesArgs, "skillTreeRegistry">,
) {
  return resolveInjectedSkillSourcesWithRegistry(logger, {
    ...args,
    skillTreeRegistry: new SkillTreeRegistry(),
  });
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
  const debugs: CapturedLog[] = [];
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
    debugs,
    infos,
    warnings,
    logger: {
      debug: captureTo(debugs),
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

function expectedTreeSource(args: {
  description: string;
  name: string;
  rootPath: string;
  sourceType: "builtin" | "data-dir";
}) {
  return {
    kind: "tree" as const,
    sourceType: args.sourceType,
    name: args.name,
    description: args.description,
    treeHash: readSkillTreeManifest(args.rootPath).treeHash,
    entryPath: "SKILL.md",
  };
}

describe("injected skill source discovery", () => {
  it("hashes trees deterministically and includes content, paths, and modes", async () => {
    const temp = await makeTempDir();
    const firstRoot = await writeSkill({
      rootPath: path.join(temp, "first"),
      name: "hash-test",
    });
    const secondRoot = await writeSkill({
      rootPath: path.join(temp, "second"),
      name: "hash-test",
    });
    await mkdir(path.join(firstRoot, "references"));
    await mkdir(path.join(secondRoot, "references"));
    const firstReference = path.join(firstRoot, "references", "notes.md");
    const secondReference = path.join(secondRoot, "references", "notes.md");
    await writeFile(firstReference, "same bytes\n");
    await writeFile(secondReference, "same bytes\n");

    const baseline = readSkillTreeManifest(firstRoot).treeHash;
    expect(readSkillTreeManifest(secondRoot).treeHash).toBe(baseline);

    await writeFile(secondReference, "changed bytes\n");
    expect(readSkillTreeManifest(secondRoot).treeHash).not.toBe(baseline);
    await writeFile(secondReference, "same bytes\n");

    const renamedReference = path.join(secondRoot, "references", "renamed.md");
    await rename(secondReference, renamedReference);
    expect(readSkillTreeManifest(secondRoot).treeHash).not.toBe(baseline);
    await rename(renamedReference, secondReference);

    await chmod(secondReference, 0o755);
    expect(readSkillTreeManifest(secondRoot).treeHash).not.toBe(baseline);
  });

  it("hashes Unicode paths in locale-independent code-point order", () => {
    const entries = ["ä", "z", "A", "a"].map((entryPath) => ({
      path: entryPath,
      mode: 0o644,
      bytes: Buffer.from(entryPath),
    }));

    const expected = createHash("sha256");
    expected.update("bb-skill-tree-v1");
    for (const entry of [...entries].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    )) {
      expected.update("\0file\0");
      expected.update(entry.path);
      expected.update("\0");
      expected.update(entry.mode.toString(8));
      expected.update("\0");
      expected.update(String(entry.bytes.length));
      expected.update("\0");
      expected.update(entry.bytes);
    }

    expect(hashSkillTreeEntries(entries)).toBe(expected.digest("hex"));
  });

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
      expectedTreeSource({
        sourceType: "data-dir",
        name: "release-notes",
        description: "Use release-notes when tests need it.",
        rootPath: dataDirSkillRoot,
      }),
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
      expectedTreeSource({
        sourceType: "builtin",
        name: "bb-cli",
        description: "Use bb-cli when tests need it.",
        rootPath: builtinSkillRoot,
      }),
      expectedTreeSource({
        sourceType: "data-dir",
        name: "release-notes",
        description: "Use release-notes when tests need it.",
        rootPath: dataDirSkillRoot,
      }),
    ]);
    expect(warnings).toEqual([]);
  });

  it("adds inherited skills as lower-priority user skills", async () => {
    const dataDir = await makeTempDir();
    const inheritedSkillsRootPath = path.join(dataDir, "inherited-skills");
    const builtinSkillsRootPath = path.join(dataDir, "builtin-skills");
    const inheritedSkillRoot = await writeSkill({
      rootPath: inheritedSkillsRootPath,
      name: "stories",
      description: "Inherited stories skill.",
    });
    const dataDirSkillRoot = await writeSkill({
      rootPath: path.join(dataDir, "skills"),
      name: "review-loop",
      description: "Data-dir review skill.",
    });
    const { logger, warnings } = createCapturingLogger();

    const sources = await resolveInjectedSkillSources(logger, {
      additionalSkillsRootPaths: [inheritedSkillsRootPath],
      builtinSkillsRootPath,
      dataDir,
    });

    expect(sources).toEqual([
      expectedTreeSource({
        sourceType: "data-dir",
        name: "review-loop",
        description: "Data-dir review skill.",
        rootPath: dataDirSkillRoot,
      }),
      expectedTreeSource({
        sourceType: "data-dir",
        name: "stories",
        description: "Inherited stories skill.",
        rootPath: inheritedSkillRoot,
      }),
    ]);
    expect(warnings).toEqual([]);
  });

  it("applies bb precedence around shared user and project roots", async () => {
    const dataDir = await makeTempDir();
    const builtinSkillsRootPath = path.join(dataDir, "builtin-skills");
    const userSkillRoot = await writeSkill({
      rootPath: path.join(dataDir, "skills"),
      name: "review",
      description: "bb user review skill.",
    });
    await writeSkill({
      rootPath: path.join(dataDir, "skills"),
      name: "deploy",
      description: "bb user deploy skill.",
    });
    const sharedUserRoot = path.join(dataDir, "external", "review");
    const sharedProjectRoot = path.join(dataDir, "workspace", "deploy");
    const { logger } = createCapturingLogger();

    const sources = resolveInjectedSkillSources(logger, {
      builtinSkillsRootPath,
      dataDir,
      sharedSkillSources: [
        {
          kind: "host-path",
          sourceType: "shared-user",
          name: "review",
          description: "Shared user review skill.",
          sourceRootPath: sharedUserRoot,
          skillFilePath: path.join(sharedUserRoot, "SKILL.md"),
        },
        {
          kind: "host-path",
          sourceType: "shared-project",
          name: "deploy",
          description: "Shared project deploy skill.",
          sourceRootPath: sharedProjectRoot,
          skillFilePath: path.join(sharedProjectRoot, "SKILL.md"),
        },
      ],
    });

    expect(sources).toEqual([
      {
        kind: "host-path",
        sourceType: "shared-project",
        name: "deploy",
        description: "Shared project deploy skill.",
        sourceRootPath: sharedProjectRoot,
        skillFilePath: path.join(sharedProjectRoot, "SKILL.md"),
      },
      expectedTreeSource({
        sourceType: "data-dir",
        name: "review",
        description: "bb user review skill.",
        rootPath: userSkillRoot,
      }),
    ]);
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
    const { logger, debugs, warnings } = createCapturingLogger();

    const sources = await resolveInjectedSkillSources(logger, {
      builtinSkillsRootPath,
      dataDir,
    });

    expect(sources).toEqual([
      expectedTreeSource({
        sourceType: "data-dir",
        name: "bb-cli",
        description: "User override copy.",
        rootPath: overrideSkillRoot,
      }),
    ]);
    expect(warnings).toEqual([]);
    expect(debugs).toEqual([
      expect.objectContaining({
        message: "Built-in injected skill overridden by user skill",
      }),
    ]);
  });

  it("lets a data-dir skill override an inherited skill with the same name", async () => {
    const dataDir = await makeTempDir();
    const inheritedSkillsRootPath = path.join(dataDir, "inherited-skills");
    const builtinSkillsRootPath = path.join(dataDir, "builtin-skills");
    await writeSkill({
      rootPath: inheritedSkillsRootPath,
      name: "stories",
      description: "Inherited stories skill.",
    });
    const overrideSkillRoot = await writeSkill({
      rootPath: path.join(dataDir, "skills"),
      name: "stories",
      description: "Local stories skill.",
    });
    const { logger, debugs, warnings } = createCapturingLogger();

    const sources = await resolveInjectedSkillSources(logger, {
      additionalSkillsRootPaths: [inheritedSkillsRootPath],
      builtinSkillsRootPath,
      dataDir,
    });

    expect(sources).toEqual([
      expectedTreeSource({
        sourceType: "data-dir",
        name: "stories",
        description: "Local stories skill.",
        rootPath: overrideSkillRoot,
      }),
    ]);
    expect(warnings).toEqual([]);
    expect(debugs).toEqual([
      expect.objectContaining({
        message:
          "Lower-priority injected skill overridden by higher-priority skill",
      }),
    ]);
  });

  it("lets earlier inherited skill roots override later inherited roots", async () => {
    const dataDir = await makeTempDir();
    const parentSkillsRootPath = path.join(dataDir, "parent-skills");
    const prodSkillsRootPath = path.join(dataDir, "prod-skills");
    const builtinSkillsRootPath = path.join(dataDir, "builtin-skills");
    const parentSkillRoot = await writeSkill({
      rootPath: parentSkillsRootPath,
      name: "stories",
      description: "Parent stories skill.",
    });
    await writeSkill({
      rootPath: prodSkillsRootPath,
      name: "stories",
      description: "Prod stories skill.",
    });
    const { logger, debugs, warnings } = createCapturingLogger();

    const sources = await resolveInjectedSkillSources(logger, {
      additionalSkillsRootPaths: [parentSkillsRootPath, prodSkillsRootPath],
      builtinSkillsRootPath,
      dataDir,
    });

    expect(sources).toEqual([
      expectedTreeSource({
        sourceType: "data-dir",
        name: "stories",
        description: "Parent stories skill.",
        rootPath: parentSkillRoot,
      }),
    ]);
    expect(warnings).toEqual([]);
    expect(debugs).toEqual([
      expect.objectContaining({
        message:
          "Lower-priority injected skill overridden by higher-priority skill",
      }),
    ]);
  });

  it("lets a project skill override global skills with the same name", async () => {
    const dataDir = await makeTempDir();
    const workspacePath = await makeTempDir();
    const builtinSkillsRootPath = path.join(dataDir, "builtin-skills");
    await writeSkill({
      rootPath: builtinSkillsRootPath,
      name: "bb-cli",
      description: "Built-in copy.",
    });
    await writeSkill({
      rootPath: path.join(dataDir, "skills"),
      name: "bb-cli",
      description: "User copy.",
    });
    const projectSkillRoot = await writeSkill({
      rootPath: path.join(workspacePath, ".bb", "skills"),
      name: "bb-cli",
      description: "Project copy.",
    });
    const { logger, warnings } = createCapturingLogger();

    const sources = await resolveInjectedSkillSources(logger, {
      builtinSkillsRootPath,
      dataDir,
      projectSkillsRootPath: path.join(workspacePath, ".bb", "skills"),
    });

    expect(sources).toEqual([
      {
        kind: "workspace-path",
        sourceType: "project",
        name: "bb-cli",
        description: "Project copy.",
        sourceRootPath: projectSkillRoot,
        skillFilePath: path.join(projectSkillRoot, "SKILL.md"),
      },
    ]);
    expect(warnings).toEqual([]);
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
    expect(builtinNames).toContain("submit-a-plugin");
    for (const source of sources) {
      expect(source.sourceType).toBe("builtin");
      expect(source.description.trim().length).toBeGreaterThan(0);
    }
    expect(warnings).toEqual([]);
  });

  it("lists server-owned user and built-in copies independently", async () => {
    const root = await makeTempDir();
    const dataDir = path.join(root, "data");
    const builtinSkillsRootPath = path.join(root, "builtins");
    await writeSkill({
      rootPath: builtinSkillsRootPath,
      name: "review",
      description: "Built-in review.",
    });
    await writeSkill({
      rootPath: path.join(dataDir, "skills"),
      name: "review",
      description: "User review.",
    });
    const { logger } = createCapturingLogger();
    const entries = resolveServerOwnedSkillCatalogEntries({
      builtinSkillsRootPath,
      dataDir,
      logger,
      skillTreeRegistry: new SkillTreeRegistry(),
    });

    expect(entries.map((entry) => entry.provenance.kind)).toEqual([
      "builtin",
      "user",
    ]);
    expect(entries.map((entry) => entry.runtimeSource.description)).toEqual([
      "Built-in review.",
      "User review.",
    ]);
  });
});
