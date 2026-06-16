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
import {
  resolveCommandScanRoots,
  resolveProviderCommandScanRoots,
} from "./command-handlers/list-commands.js";

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
    roots: await resolveProviderCommandScanRoots({
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
    roots: await resolveProviderCommandScanRoots({
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
    expect(commands.some((command) => command.name.endsWith("deep"))).toBe(
      false,
    );
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

  it("does not follow project-origin symlinked skill directories or skill files", async () => {
    const fixture = await makeWorkspaceFixture();
    const skillsRoot = path.join(fixture.cwd, ".claude", "skills");
    await mkdir(skillsRoot, { recursive: true });

    const outsideSkillDirectory = path.join(
      tempRoot,
      "outside-skill-directory",
    );
    await writeFileEnsuringDir(
      path.join(outsideSkillDirectory, "SKILL.md"),
      "---\nname: leaked\ndescription: leaked\n---\n",
    );
    await symlink(outsideSkillDirectory, path.join(skillsRoot, "leaked"));

    const outsideSkillFile = path.join(tempRoot, "outside-skill-file.md");
    await writeFileEnsuringDir(
      outsideSkillFile,
      "---\nname: linked-file\ndescription: linked file\n---\n",
    );
    const linkedFileSkillRoot = path.join(skillsRoot, "linked-file");
    await mkdir(linkedFileSkillRoot, { recursive: true });
    await symlink(outsideSkillFile, path.join(linkedFileSkillRoot, "SKILL.md"));

    const commands = await discoverClaude(fixture, fixture.cwd);

    expect(byName(commands, "leaked")).toBeUndefined();
    expect(byName(commands, "linked-file")).toBeUndefined();
  });

  it("follows user-origin symlinked skill directories and skill files", async () => {
    const fixture = await makeWorkspaceFixture();
    const skillsRoot = path.join(fixture.homeDir, ".claude", "skills");
    await mkdir(skillsRoot, { recursive: true });

    const linkedDirectoryTarget = path.join(
      tempRoot,
      "claude-linked-directory-target",
    );
    await writeFileEnsuringDir(
      path.join(linkedDirectoryTarget, "SKILL.md"),
      "---\nname: symlinked-directory\ndescription: linked directory\n---\n",
    );
    await symlink(
      linkedDirectoryTarget,
      path.join(skillsRoot, "symlinked-directory"),
    );

    const symlinkedFileTarget = path.join(
      tempRoot,
      "claude-linked-file-target.md",
    );
    await writeFileEnsuringDir(
      symlinkedFileTarget,
      "---\nname: symlinked-file\ndescription: linked file\n---\n",
    );
    const symlinkedFileSkillRoot = path.join(skillsRoot, "symlinked-file");
    await mkdir(symlinkedFileSkillRoot, { recursive: true });
    await symlink(
      symlinkedFileTarget,
      path.join(symlinkedFileSkillRoot, "SKILL.md"),
    );

    const commands = await discoverClaude(fixture, fixture.cwd);

    expect(byName(commands, "symlinked-directory")).toEqual({
      name: "symlinked-directory",
      source: "skill",
      origin: "user",
      description: "linked directory",
      argumentHint: null,
    });
    expect(byName(commands, "symlinked-file")).toEqual({
      name: "symlinked-file",
      source: "skill",
      origin: "user",
      description: "linked file",
      argumentHint: null,
    });
  });

  it("discovers enabled installed plugin skills and commands with cache fallback", async () => {
    const fixture = await makeWorkspaceFixture();
    const claudeRoot = path.join(fixture.homeDir, ".claude");
    await writeFileEnsuringDir(
      path.join(claudeRoot, "settings.json"),
      JSON.stringify(
        {
          enabledPlugins: {
            "fallback-plugin@test-market": true,
            "disabled-plugin@test-market": false,
            "tilde-plugin@test-market": true,
          },
        },
        null,
        2,
      ),
    );
    await writeFileEnsuringDir(
      path.join(claudeRoot, "plugins", "installed_plugins.json"),
      JSON.stringify(
        {
          version: 2,
          plugins: {
            "fallback-plugin@test-market": [
              {
                scope: "user",
                installPath: path.join(
                  claudeRoot,
                  "plugins",
                  "cache",
                  "test-market",
                  "fallback-plugin",
                  "unknown",
                ),
                gitCommitSha: "abcdef1234567890abcdef1234567890abcdef12",
              },
            ],
            "disabled-plugin@test-market": [
              {
                scope: "user",
                installPath: path.join(
                  claudeRoot,
                  "plugins",
                  "cache",
                  "test-market",
                  "disabled-plugin",
                  "1.0.0",
                ),
              },
            ],
            "tilde-plugin@test-market": [
              {
                scope: "user",
                installPath:
                  "~/.claude/plugins/cache/test-market/tilde-plugin/1.0.0",
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    const fallbackPluginRoot = path.join(
      claudeRoot,
      "plugins",
      "cache",
      "test-market",
      "fallback-plugin",
      "abcdef123456",
    );
    await writeFileEnsuringDir(
      path.join(fallbackPluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify(
        {
          name: "fallback-plugin",
          description: "Uses a commit cache directory",
          skills: ["skills", "linked-skill/SKILL.md", "linked-skills"],
          commands: "commands",
        },
        null,
        2,
      ),
    );
    await writeFileEnsuringDir(
      path.join(fallbackPluginRoot, "SKILL.md"),
      "---\ndescription: Root plugin skill\n---\n",
    );
    await writeFileEnsuringDir(
      path.join(fallbackPluginRoot, "skills", "child-skill", "SKILL.md"),
      "---\ndescription: Child plugin skill\n---\n",
    );
    await writeFileEnsuringDir(
      path.join(fallbackPluginRoot, "commands", "create-widget.md"),
      "---\ndescription: Create a widget\n---\n",
    );

    const linkedSkillTarget = path.join(tempRoot, "linked-plugin-skill.md");
    await writeFileEnsuringDir(
      linkedSkillTarget,
      "---\nname: linked-file-skill\ndescription: Linked file skill\n---\n",
    );
    await mkdir(path.join(fallbackPluginRoot, "linked-skill"), {
      recursive: true,
    });
    await symlink(
      linkedSkillTarget,
      path.join(fallbackPluginRoot, "linked-skill", "SKILL.md"),
    );

    const linkedSkillsTarget = path.join(tempRoot, "linked-plugin-skills");
    await writeFileEnsuringDir(
      path.join(linkedSkillsTarget, "nested-skill", "SKILL.md"),
      "---\ndescription: Linked directory skill\n---\n",
    );
    await symlink(
      linkedSkillsTarget,
      path.join(fallbackPluginRoot, "linked-skills"),
    );

    const disabledPluginRoot = path.join(
      claudeRoot,
      "plugins",
      "cache",
      "test-market",
      "disabled-plugin",
      "1.0.0",
    );
    await writeFileEnsuringDir(
      path.join(disabledPluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "disabled-plugin" }, null, 2),
    );
    await writeFileEnsuringDir(
      path.join(disabledPluginRoot, "skills", "hidden", "SKILL.md"),
      "---\ndescription: Hidden\n---\n",
    );

    const tildePluginRoot = path.join(
      claudeRoot,
      "plugins",
      "cache",
      "test-market",
      "tilde-plugin",
      "1.0.0",
    );
    await writeFileEnsuringDir(
      path.join(tildePluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "tilde-plugin" }, null, 2),
    );
    await writeFileEnsuringDir(
      path.join(tildePluginRoot, "skills", "tilde-skill", "SKILL.md"),
      "---\ndescription: Tilde path skill\n---\n",
    );

    const commands = await discoverClaude(fixture, fixture.cwd);

    expect(byName(commands, "fallback-plugin:fallback-plugin")).toEqual({
      name: "fallback-plugin:fallback-plugin",
      source: "skill",
      origin: "user",
      description: "Root plugin skill",
      argumentHint: null,
    });
    expect(byName(commands, "fallback-plugin:child-skill")).toEqual({
      name: "fallback-plugin:child-skill",
      source: "skill",
      origin: "user",
      description: "Child plugin skill",
      argumentHint: null,
    });
    expect(byName(commands, "fallback-plugin:linked-file-skill")).toEqual({
      name: "fallback-plugin:linked-file-skill",
      source: "skill",
      origin: "user",
      description: "Linked file skill",
      argumentHint: null,
    });
    expect(byName(commands, "fallback-plugin:nested-skill")).toEqual({
      name: "fallback-plugin:nested-skill",
      source: "skill",
      origin: "user",
      description: "Linked directory skill",
      argumentHint: null,
    });
    expect(byName(commands, "fallback-plugin:create-widget")).toEqual({
      name: "fallback-plugin:create-widget",
      source: "command",
      origin: "user",
      description: "Create a widget",
      argumentHint: null,
    });
    expect(
      commands.filter(
        (command) => command.name === "fallback-plugin:child-skill",
      ),
    ).toHaveLength(1);
    expect(
      commands.filter(
        (command) => command.name === "fallback-plugin:create-widget",
      ),
    ).toHaveLength(1);
    expect(byName(commands, "disabled-plugin:hidden")).toBeUndefined();
    expect(byName(commands, "tilde-plugin:tilde-skill")).toEqual({
      name: "tilde-plugin:tilde-skill",
      source: "skill",
      origin: "user",
      description: "Tilde path skill",
      argumentHint: null,
    });
  });

  it("keeps project-scoped installed plugin skills out of user-only discovery", async () => {
    const fixture = await makeWorkspaceFixture();
    const claudeRoot = path.join(fixture.homeDir, ".claude");
    const projectPluginRoot = path.join(
      fixture.cwd,
      ".claude",
      "plugins",
      "cache",
      "test-market",
      "project-plugin",
      "1.0.0",
    );
    const localPluginRoot = path.join(
      fixture.cwd,
      ".claude",
      "plugins",
      "cache",
      "test-market",
      "local-plugin",
      "1.0.0",
    );
    const unrelatedWorkspace = path.join(tempRoot, "unrelated-workspace");
    await writeFileEnsuringDir(
      path.join(claudeRoot, "plugins", "installed_plugins.json"),
      JSON.stringify(
        {
          version: 2,
          plugins: {
            "project-plugin@test-market": [
              {
                scope: "project",
                installPath: projectPluginRoot,
              },
            ],
            "local-plugin@test-market": [
              {
                scope: "local",
                installPath: localPluginRoot,
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    await writeFileEnsuringDir(
      path.join(projectPluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "project-plugin" }, null, 2),
    );
    await writeFileEnsuringDir(
      path.join(projectPluginRoot, "skills", "project-only", "SKILL.md"),
      "---\ndescription: Project scoped plugin skill\n---\n",
    );
    await writeFileEnsuringDir(
      path.join(localPluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "local-plugin" }, null, 2),
    );
    await writeFileEnsuringDir(
      path.join(localPluginRoot, "skills", "local-only", "SKILL.md"),
      "---\ndescription: Local scoped plugin skill\n---\n",
    );

    const userOnlyCommands = await discoverClaude(fixture, null);
    const unrelatedWorkspaceCommands = await discoverClaude(
      fixture,
      unrelatedWorkspace,
    );
    const workspaceCommands = await discoverClaude(fixture, fixture.cwd);

    expect(
      byName(userOnlyCommands, "project-plugin:project-only"),
    ).toBeUndefined();
    expect(byName(userOnlyCommands, "local-plugin:local-only")).toBeUndefined();
    expect(
      byName(unrelatedWorkspaceCommands, "project-plugin:project-only"),
    ).toBeUndefined();
    expect(
      byName(unrelatedWorkspaceCommands, "local-plugin:local-only"),
    ).toBeUndefined();
    expect(byName(workspaceCommands, "project-plugin:project-only")).toEqual({
      name: "project-plugin:project-only",
      source: "skill",
      origin: "project",
      description: "Project scoped plugin skill",
      argumentHint: null,
    });
    expect(byName(workspaceCommands, "local-plugin:local-only")).toEqual({
      name: "local-plugin:local-only",
      source: "skill",
      origin: "project",
      description: "Local scoped plugin skill",
      argumentHint: null,
    });
  });

  it("discovers skills-directory plugins without listing the plugin root as a standalone skill", async () => {
    const fixture = await makeWorkspaceFixture();
    const pluginRoot = path.join(
      fixture.homeDir,
      ".claude",
      "skills",
      "local-tool",
    );
    await writeFileEnsuringDir(
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "local-tool" }, null, 2),
    );
    await writeFileEnsuringDir(
      path.join(pluginRoot, "SKILL.md"),
      "---\nname: root-action\ndescription: Root action\n---\n",
    );
    await writeFileEnsuringDir(
      path.join(pluginRoot, "skills", "child-action", "SKILL.md"),
      "---\ndescription: Child action\n---\n",
    );

    const commands = await discoverClaude(fixture, fixture.cwd);

    expect(byName(commands, "local-tool")).toBeUndefined();
    expect(byName(commands, "local-tool:root-action")).toEqual({
      name: "local-tool:root-action",
      source: "skill",
      origin: "user",
      description: "Root action",
      argumentHint: null,
    });
    expect(byName(commands, "local-tool:child-action")).toEqual({
      name: "local-tool:child-action",
      source: "skill",
      origin: "user",
      description: "Child action",
      argumentHint: null,
    });
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

  it("follows user-origin symlinked skill directories and skill files", async () => {
    const fixture = await makeWorkspaceFixture();
    const skillsRoot = path.join(fixture.codexHome, "skills");
    await mkdir(skillsRoot, { recursive: true });

    const linkedDirectoryTarget = path.join(
      tempRoot,
      "linked-directory-target",
    );
    await writeFileEnsuringDir(
      path.join(linkedDirectoryTarget, "SKILL.md"),
      "---\nname: symlinked-directory\ndescription: linked directory\n---\n",
    );
    await symlink(
      linkedDirectoryTarget,
      path.join(skillsRoot, "symlinked-directory"),
    );

    const symlinkedFileTarget = path.join(tempRoot, "linked-file-target.md");
    await writeFileEnsuringDir(
      symlinkedFileTarget,
      "---\nname: symlinked-file\ndescription: linked file\n---\n",
    );
    const symlinkedFileSkillRoot = path.join(skillsRoot, "symlinked-file");
    await mkdir(symlinkedFileSkillRoot, { recursive: true });
    await symlink(
      symlinkedFileTarget,
      path.join(symlinkedFileSkillRoot, "SKILL.md"),
    );

    const commands = await discoverCodex(fixture, fixture.cwd);

    expect(byName(commands, "symlinked-directory")).toEqual({
      name: "symlinked-directory",
      source: "skill",
      origin: "user",
      description: "linked directory",
      argumentHint: null,
    });
    expect(byName(commands, "symlinked-file")).toEqual({
      name: "symlinked-file",
      source: "skill",
      origin: "user",
      description: "linked file",
      argumentHint: null,
    });
  });

  it("discovers system and enabled plugin skills from Codex storage", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeFileEnsuringDir(
      path.join(
        fixture.codexHome,
        "skills",
        ".system",
        "openai-docs",
        "SKILL.md",
      ),
      "---\nname: openai-docs\ndescription: OpenAI docs\n---\n",
    );
    await writeFileEnsuringDir(
      path.join(fixture.codexHome, "config.toml"),
      ['[plugins."disabled-plugin@test-market"]', "enabled = false", ""].join(
        "\n",
      ),
    );

    const pluginRoot = path.join(
      fixture.codexHome,
      "plugins",
      "cache",
      "test-market",
      "local-plugin",
      "1.0.0",
    );
    await writeFileEnsuringDir(
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify(
        {
          name: "local-plugin",
          skills: ["skills", "linked-skill/SKILL.md", "linked-skills"],
        },
        null,
        2,
      ),
    );
    await writeFileEnsuringDir(
      path.join(pluginRoot, "SKILL.md"),
      "---\ndescription: Root Codex plugin skill\n---\n",
    );
    await writeFileEnsuringDir(
      path.join(pluginRoot, "skills", "child-skill", "SKILL.md"),
      "---\ndescription: Child Codex plugin skill\n---\n",
    );

    const linkedSkillTarget = path.join(
      tempRoot,
      "codex-linked-plugin-skill.md",
    );
    await writeFileEnsuringDir(
      linkedSkillTarget,
      "---\nname: linked-file-skill\ndescription: Linked Codex file skill\n---\n",
    );
    await mkdir(path.join(pluginRoot, "linked-skill"), { recursive: true });
    await symlink(
      linkedSkillTarget,
      path.join(pluginRoot, "linked-skill", "SKILL.md"),
    );

    const linkedSkillsTarget = path.join(
      tempRoot,
      "codex-linked-plugin-skills",
    );
    await writeFileEnsuringDir(
      path.join(linkedSkillsTarget, "nested-skill", "SKILL.md"),
      "---\ndescription: Linked Codex directory skill\n---\n",
    );
    await symlink(linkedSkillsTarget, path.join(pluginRoot, "linked-skills"));

    const disabledPluginRoot = path.join(
      fixture.codexHome,
      "plugins",
      "cache",
      "test-market",
      "disabled-plugin",
      "1.0.0",
    );
    await writeFileEnsuringDir(
      path.join(disabledPluginRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "disabled-plugin" }, null, 2),
    );
    await writeFileEnsuringDir(
      path.join(disabledPluginRoot, "skills", "hidden", "SKILL.md"),
      "---\ndescription: Hidden\n---\n",
    );

    const commands = await discoverCodex(fixture, fixture.cwd);

    expect(byName(commands, "openai-docs")).toEqual({
      name: "openai-docs",
      source: "skill",
      origin: "user",
      description: "OpenAI docs",
      argumentHint: null,
    });
    expect(byName(commands, "local-plugin:local-plugin")).toEqual({
      name: "local-plugin:local-plugin",
      source: "skill",
      origin: "user",
      description: "Root Codex plugin skill",
      argumentHint: null,
    });
    expect(byName(commands, "local-plugin:child-skill")).toEqual({
      name: "local-plugin:child-skill",
      source: "skill",
      origin: "user",
      description: "Child Codex plugin skill",
      argumentHint: null,
    });
    expect(byName(commands, "local-plugin:linked-file-skill")).toEqual({
      name: "local-plugin:linked-file-skill",
      source: "skill",
      origin: "user",
      description: "Linked Codex file skill",
      argumentHint: null,
    });
    expect(byName(commands, "local-plugin:nested-skill")).toEqual({
      name: "local-plugin:nested-skill",
      source: "skill",
      origin: "user",
      description: "Linked Codex directory skill",
      argumentHint: null,
    });
    expect(
      commands.filter((command) => command.name === "local-plugin:child-skill"),
    ).toHaveLength(1);
    expect(byName(commands, "disabled-plugin:hidden")).toBeUndefined();
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
