import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveKimiNativeRoots } from "./kimi.js";
import type { AcpNativeRootsEnvironment } from "./resolver.js";

let tempRoot: string;
let homeDir: string;
let cwd: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), "bb-kimi-native-roots-"));
  homeDir = path.join(tempRoot, "home");
  cwd = path.join(tempRoot, "workspace");
  await mkdir(homeDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

async function writeConfig(kimiHome: string, content: string): Promise<void> {
  await mkdir(kimiHome, { recursive: true });
  await writeFile(path.join(kimiHome, "config.toml"), content, "utf8");
}

async function rootsFor(
  workspace: string | null = cwd,
  env: AcpNativeRootsEnvironment = {},
) {
  const answer = await resolveKimiNativeRoots({
    cwd: workspace,
    homeDir,
    env,
  });
  return answer.skills ?? [];
}

describe("Kimi native skill roots", () => {
  it("uses the nearest Git root when launched in a nested worktree directory", async () => {
    await writeFile(path.join(cwd, ".git"), "gitdir: /unused/worktree\n");
    const nested = path.join(cwd, "packages", "app");
    await mkdir(nested, { recursive: true });

    const roots = await rootsFor(nested);

    expect(roots.map((root) => root.path)).toEqual([
      path.join(homeDir, ".kimi-code", "skills"),
      path.join(homeDir, ".agents", "skills"),
      path.join(cwd, ".kimi-code", "skills"),
      path.join(cwd, ".agents", "skills"),
    ]);
    expect(roots.every((root) => root.recursive === true)).toBe(true);
    expect(roots.filter((root) => root.origin === "project")).toHaveLength(2);
  });

  it("stops at a nested repository instead of collecting ancestor skills", async () => {
    await mkdir(path.join(cwd, ".git"));
    const nestedRepo = path.join(cwd, "vendor", "repo");
    await mkdir(path.join(nestedRepo, ".git"), { recursive: true });
    const nested = path.join(nestedRepo, "src");
    await mkdir(nested);

    const roots = await rootsFor(nested);

    expect(
      roots
        .filter((root) => root.origin === "project")
        .map((root) => root.path),
    ).toEqual([
      path.join(nestedRepo, ".kimi-code", "skills"),
      path.join(nestedRepo, ".agents", "skills"),
    ]);
  });

  it("uses cwd as the project root when there is no Git marker", async () => {
    const nested = path.join(cwd, "nested");
    await mkdir(nested);

    const roots = await rootsFor(nested);

    expect(
      roots
        .filter((root) => root.origin === "project")
        .map((root) => root.path),
    ).toEqual([
      path.join(nested, ".kimi-code", "skills"),
      path.join(nested, ".agents", "skills"),
    ]);
  });

  it("reads the configured home and resolves extra directories from the project root", async () => {
    const kimiHome = path.join(tempRoot, "custom-kimi");
    const absoluteSkills = path.join(tempRoot, "shared-skills");
    await mkdir(path.join(cwd, ".git"));
    const nested = path.join(cwd, "src");
    await mkdir(nested);
    await writeConfig(
      kimiHome,
      `extra_skill_dirs = ["team/skills", "~/personal/skills", ${JSON.stringify(absoluteSkills)}, "$TEAM/skills"]\n`,
    );

    const roots = await rootsFor(nested, {
      KIMI_CODE_HOME: kimiHome,
      TEAM: path.join(tempRoot, "must-not-expand"),
    });

    expect(roots.map((root) => root.path)).toEqual([
      path.join(kimiHome, "skills"),
      path.join(homeDir, ".agents", "skills"),
      path.join(cwd, "team", "skills"),
      path.join(homeDir, "personal", "skills"),
      absoluteSkills,
      path.join(cwd, "$TEAM", "skills"),
      path.join(cwd, ".kimi-code", "skills"),
      path.join(cwd, ".agents", "skills"),
    ]);
  });

  it("resolves relative KIMI_CODE_HOME from cwd and accepts the current config spelling", async () => {
    const relativeHome = ".local-kimi";
    await writeConfig(
      path.join(cwd, relativeHome),
      'extraSkillDirs = ["~/shared/skills"]\n',
    );

    const roots = await rootsFor(cwd, { KIMI_CODE_HOME: relativeHome });

    expect(roots.slice(0, 3).map((root) => root.path)).toEqual([
      path.join(cwd, relativeHome, "skills"),
      path.join(homeDir, ".agents", "skills"),
      path.join(homeDir, "shared", "skills"),
    ]);
  });

  it("resolves user roots without a workspace and omits project roots", async () => {
    const kimiHome = path.join(tempRoot, "custom-kimi");
    await writeConfig(kimiHome, 'extra_skill_dirs = ["~/shared/skills"]\n');

    const roots = await rootsFor(null, { KIMI_CODE_HOME: kimiHome });

    expect(roots.map((root) => root.path)).toEqual([
      path.join(kimiHome, "skills"),
      path.join(homeDir, ".agents", "skills"),
      path.join(homeDir, "shared", "skills"),
    ]);
    expect(roots.every((root) => root.origin === "user")).toBe(true);
  });

  it.each([
    "extra_skill_dirs = [",
    'extra_skill_dirs = "not-an-array"',
    "extra_skill_dirs = [42]",
  ])("keeps default roots when the config is invalid: %s", async (content) => {
    await writeConfig(path.join(homeDir, ".kimi-code"), content);

    expect((await rootsFor(null)).map((root) => root.path)).toEqual([
      path.join(homeDir, ".kimi-code", "skills"),
      path.join(homeDir, ".agents", "skills"),
    ]);
  });
});
