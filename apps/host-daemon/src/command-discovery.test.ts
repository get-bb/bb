import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostProviderCommand } from "@bb/host-daemon-contract";
import { discoverProviderCommands } from "./command-discovery.js";
import { resolveCommandScanRoots } from "./command-handlers/list-commands.js";

interface WorkspaceFixture {
  cwd: string;
  homeDir: string;
  codexHome: string;
}

let tempRoot: string;

async function writeFileEnsuringDir(
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function makeWorkspaceFixture(): Promise<WorkspaceFixture> {
  const cwd = path.join(tempRoot, "workspace");
  const homeDir = path.join(tempRoot, "home");
  const codexHome = path.join(homeDir, ".codex");
  await mkdir(cwd, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  return { cwd, homeDir, codexHome };
}

async function discoverClaude(
  fixture: WorkspaceFixture,
  cwd: string | null,
): Promise<HostProviderCommand[]> {
  return discoverProviderCommands({
    roots: resolveCommandScanRoots({
      providerId: "claude-code",
      cwd,
      homeDir: fixture.homeDir,
      codexHome: fixture.codexHome,
    }),
  });
}

async function discoverCodex(
  fixture: WorkspaceFixture,
  cwd: string | null,
): Promise<HostProviderCommand[]> {
  return discoverProviderCommands({
    roots: resolveCommandScanRoots({
      providerId: "codex",
      cwd,
      homeDir: fixture.homeDir,
      codexHome: fixture.codexHome,
    }),
  });
}

function byName(
  commands: HostProviderCommand[],
  name: string,
): HostProviderCommand | undefined {
  return commands.find((command) => command.name === name);
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), "bb-command-discovery-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("discoverProviderCommands (claude-code)", () => {
  it("parses project skills, namespaced commands, and frontmatter", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeFileEnsuringDir(
      path.join(fixture.cwd, ".claude", "skills", "x", "SKILL.md"),
      // Frontmatter `name` deliberately differs from the dir name: the
      // invocation name must come from the directory, not frontmatter.
      "---\nname: frontmatter-name-ignored\ndescription: The x skill\nargument-hint: <target>\n---\nBody",
    );
    await writeFileEnsuringDir(
      path.join(fixture.cwd, ".claude", "commands", "review.md"),
      "---\ndescription: Review the diff\n---\nReview body",
    );
    await writeFileEnsuringDir(
      path.join(fixture.cwd, ".claude", "commands", "frontend", "component.md"),
      "---\ndescription: Scaffold a component\nargument-hint: <name>\n---\nBody",
    );

    const commands = await discoverClaude(fixture, fixture.cwd);

    const skill = byName(commands, "x");
    expect(skill).toEqual({
      name: "x",
      source: "skill",
      origin: "project",
      description: "The x skill",
      argumentHint: "<target>",
    });

    const review = byName(commands, "review");
    expect(review).toEqual({
      name: "review",
      source: "command",
      origin: "project",
      description: "Review the diff",
      argumentHint: null,
    });

    const namespaced = byName(commands, "frontend:component");
    expect(namespaced).toEqual({
      name: "frontend:component",
      source: "command",
      origin: "project",
      description: "Scaffold a component",
      argumentHint: "<name>",
    });
  });

  it("tags user-home roots with origin 'user'", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeFileEnsuringDir(
      path.join(fixture.homeDir, ".claude", "skills", "deploy", "SKILL.md"),
      "---\nname: deploy\ndescription: Deploy it\n---\n",
    );
    await writeFileEnsuringDir(
      path.join(fixture.homeDir, ".claude", "commands", "lint.md"),
      "---\ndescription: Lint everything\n---\n",
    );

    const commands = await discoverClaude(fixture, fixture.cwd);

    expect(byName(commands, "deploy")).toMatchObject({
      origin: "user",
      source: "skill",
    });
    expect(byName(commands, "lint")).toMatchObject({
      origin: "user",
      source: "command",
    });
  });

  it("returns empty for missing dirs without throwing", async () => {
    const fixture = await makeWorkspaceFixture();
    const commands = await discoverClaude(fixture, fixture.cwd);
    expect(commands).toEqual([]);
  });

  it("produces a name-only record for malformed frontmatter", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeFileEnsuringDir(
      path.join(fixture.cwd, ".claude", "commands", "broken.md"),
      "---\ndescription: [unterminated\n---\nBody",
    );
    await writeFileEnsuringDir(
      path.join(fixture.cwd, ".claude", "commands", "no-frontmatter.md"),
      "Just a body, no frontmatter at all.",
    );

    const commands = await discoverClaude(fixture, fixture.cwd);

    expect(byName(commands, "broken")).toEqual({
      name: "broken",
      source: "command",
      origin: "project",
      description: null,
      argumentHint: null,
    });
    expect(byName(commands, "no-frontmatter")).toEqual({
      name: "no-frontmatter",
      source: "command",
      origin: "project",
      description: null,
      argumentHint: null,
    });
  });

  it("derives skill name from the directory (ignoring frontmatter name) and coerces a non-string description to null", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeFileEnsuringDir(
      path.join(fixture.cwd, ".claude", "skills", "real-dir", "SKILL.md"),
      "---\nname: bogus\ndescription:\n  - not\n  - a\n  - string\n---\nBody",
    );
    await writeFileEnsuringDir(
      path.join(fixture.cwd, ".claude", "skills", "bare", "SKILL.md"),
      "No frontmatter at all.",
    );

    const commands = await discoverClaude(fixture, fixture.cwd);

    // Directory name wins; the frontmatter `name: bogus` is never used.
    expect(byName(commands, "bogus")).toBeUndefined();
    expect(byName(commands, "real-dir")).toEqual({
      name: "real-dir",
      source: "skill",
      origin: "project",
      description: null,
      argumentHint: null,
    });
    // Skill with no frontmatter -> name-only record (parity with commands).
    expect(byName(commands, "bare")).toEqual({
      name: "bare",
      source: "skill",
      origin: "project",
      description: null,
      argumentHint: null,
    });
  });

  it("skips project roots and returns only user-origin records when cwd is null", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeFileEnsuringDir(
      path.join(fixture.cwd, ".claude", "commands", "project-only.md"),
      "---\ndescription: project\n---\n",
    );
    await writeFileEnsuringDir(
      path.join(fixture.homeDir, ".claude", "commands", "user-only.md"),
      "---\ndescription: user\n---\n",
    );

    const commands = await discoverClaude(fixture, null);

    expect(commands.map((command) => command.name)).toEqual(["user-only"]);
    expect(commands.every((command) => command.origin === "user")).toBe(true);
  });

  it("enforces the depth cap on deep command trees", async () => {
    const fixture = await makeWorkspaceFixture();
    const commandsRoot = path.join(fixture.cwd, ".claude", "commands");
    // 30 levels deep is past MAX_SCAN_DEPTH (24); the leaf must not be found.
    const deepSegments = Array.from({ length: 30 }, (_, index) => `d${index}`);
    await writeFileEnsuringDir(
      path.join(commandsRoot, ...deepSegments, "deep.md"),
      "---\ndescription: too deep\n---\n",
    );
    await writeFileEnsuringDir(
      path.join(commandsRoot, "shallow.md"),
      "---\ndescription: ok\n---\n",
    );

    const commands = await discoverClaude(fixture, fixture.cwd);

    expect(byName(commands, "shallow")).toBeDefined();
    expect(
      commands.some((command) => command.name.endsWith("deep")),
    ).toBe(false);
  });

  it("enforces the file-count cap", async () => {
    const fixture = await makeWorkspaceFixture();
    const commandsRoot = path.join(fixture.cwd, ".claude", "commands");
    const fileCount = 1_050; // > MAX_SCAN_FILE_COUNT (1000)
    await Promise.all(
      Array.from({ length: fileCount }, (_, index) =>
        writeFileEnsuringDir(
          path.join(commandsRoot, `cmd-${index}.md`),
          "body",
        ),
      ),
    );

    const commands = await discoverClaude(fixture, fixture.cwd);

    expect(commands.length).toBe(1_000);
  });

  it("does not follow symlinked command files or directories", async () => {
    const fixture = await makeWorkspaceFixture();
    const commandsRoot = path.join(fixture.cwd, ".claude", "commands");
    await mkdir(commandsRoot, { recursive: true });

    const outsideDir = path.join(tempRoot, "outside");
    await writeFileEnsuringDir(
      path.join(outsideDir, "secret.md"),
      "---\ndescription: secret\n---\n",
    );
    await writeFileEnsuringDir(
      path.join(commandsRoot, "real.md"),
      "---\ndescription: real\n---\n",
    );
    await symlink(
      path.join(outsideDir, "secret.md"),
      path.join(commandsRoot, "linked.md"),
    );
    await symlink(outsideDir, path.join(commandsRoot, "linked-dir"));

    const commands = await discoverClaude(fixture, fixture.cwd);

    expect(byName(commands, "real")).toBeDefined();
    expect(byName(commands, "linked")).toBeUndefined();
    expect(byName(commands, "linked-dir:secret")).toBeUndefined();
  });

  it("does not follow symlinked skill directories", async () => {
    const fixture = await makeWorkspaceFixture();
    const skillsRoot = path.join(fixture.cwd, ".claude", "skills");
    await mkdir(skillsRoot, { recursive: true });

    const outsideSkill = path.join(tempRoot, "outside-skill");
    await writeFileEnsuringDir(
      path.join(outsideSkill, "SKILL.md"),
      "---\nname: leaked\ndescription: leaked\n---\n",
    );
    await symlink(outsideSkill, path.join(skillsRoot, "leaked"));

    const commands = await discoverClaude(fixture, fixture.cwd);

    expect(byName(commands, "leaked")).toBeUndefined();
  });
  it("degrades to other roots when a root directory is unreadable", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeFileEnsuringDir(
      path.join(fixture.homeDir, ".claude", "skills", "ok", "SKILL.md"),
      "---\ndescription: readable\n---\n",
    );
    const blockedDir = path.join(fixture.cwd, ".claude", "commands");
    await writeFileEnsuringDir(
      path.join(blockedDir, "secret.md"),
      "---\ndescription: secret\n---\n",
    );
    await chmod(blockedDir, 0o000);
    try {
      // If the dir is still readable (e.g. the test runs as root), this case
      // can't exercise EACCES — skip rather than assert a state we can't create.
      let unreadable = false;
      try {
        await readdir(blockedDir);
      } catch {
        unreadable = true;
      }
      if (!unreadable) return;

      const commands = await discoverClaude(fixture, fixture.cwd);
      // The unreadable root degrades to empty (no throw); readable roots return.
      expect(byName(commands, "ok")).toBeDefined();
      expect(byName(commands, "secret")).toBeUndefined();
    } finally {
      await chmod(blockedDir, 0o755);
    }
  });
});

describe("discoverProviderCommands (codex)", () => {
  it("parses project and user codex skills with correct origins", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeFileEnsuringDir(
      path.join(fixture.cwd, ".codex", "skills", "y", "SKILL.md"),
      "---\nname: y\ndescription: The y codex skill\nargument-hint: <arg>\n---\n",
    );
    await writeFileEnsuringDir(
      path.join(fixture.codexHome, "skills", "prd", "SKILL.md"),
      "---\nname: prd\ndescription: Draft a PRD\n---\n",
    );

    const commands = await discoverCodex(fixture, fixture.cwd);

    expect(byName(commands, "y")).toEqual({
      name: "y",
      source: "skill",
      origin: "project",
      description: "The y codex skill",
      argumentHint: "<arg>",
    });
    expect(byName(commands, "prd")).toEqual({
      name: "prd",
      source: "skill",
      origin: "user",
      description: "Draft a PRD",
      argumentHint: null,
    });
  });

  it("returns only user-origin codex skills when cwd is null", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeFileEnsuringDir(
      path.join(fixture.cwd, ".codex", "skills", "proj", "SKILL.md"),
      "---\nname: proj\ndescription: project\n---\n",
    );
    await writeFileEnsuringDir(
      path.join(fixture.codexHome, "skills", "home", "SKILL.md"),
      "---\nname: home\ndescription: home\n---\n",
    );

    const commands = await discoverCodex(fixture, null);

    expect(commands.map((command) => command.name)).toEqual(["home"]);
  });
});

describe("resolveCommandScanRoots", () => {
  it("returns no roots for a provider without a command surface", async () => {
    const fixture = await makeWorkspaceFixture();
    const roots = resolveCommandScanRoots({
      providerId: "pi",
      cwd: fixture.cwd,
      homeDir: fixture.homeDir,
      codexHome: fixture.codexHome,
    });
    expect(roots).toEqual([]);
  });
});
