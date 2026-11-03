import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLAUDE_SKILL_PLUGIN_NAME,
  createClaudeSkillPluginsRoot,
  ensureClaudeSkillPlugin,
  filterClaudeSkillRoots,
} from "../skill-plugins.js";

describe("claude skill plugins", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "bb-claude-skill-plugins-test-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  function stageSkills(name: string): string {
    const root = join(baseDir, `stage-${name}`, "skills");
    mkdirSync(join(root, "demo"), { recursive: true });
    writeFileSync(
      join(root, "demo", "SKILL.md"),
      "---\nname: demo\ndescription: demo\n---\n",
    );
    return root;
  }

  it("omits identical native skills per workspace without hiding different content with the same name", async () => {
    const cwd = join(baseDir, "workspace");
    const claudeDir = join(baseDir, "home", ".claude");
    const native = join(cwd, ".claude", "skills", "demo");
    mkdirSync(native, { recursive: true });
    mkdirSync(join(cwd, ".git"));
    const staged = stageSkills("native-overlap");
    writeFileSync(
      join(native, "SKILL.md"),
      readFileSync(join(staged, "demo", "SKILL.md")),
    );
    const args = {
      roots: [{ id: "r", path: staged }],
      cwd,
      claudeDir,
      pluginsRoot: createClaudeSkillPluginsRoot(baseDir),
    };
    expect(await filterClaudeSkillRoots(args)).toEqual([]);
    writeFileSync(
      join(native, "SKILL.md"),
      "---\nname: demo\ndescription: Different instructions\n---\n",
    );
    expect(await filterClaudeSkillRoots(args)).toEqual(args.roots);
  });

  it("is idempotent for a root and re-points the link when the root moves", () => {
    const pluginsRoot = createClaudeSkillPluginsRoot(baseDir);
    const first = stageSkills("a");
    const second = stageSkills("b");
    const pluginPath = ensureClaudeSkillPlugin({
      pluginsRoot,
      root: { id: "r", path: first },
    });
    expect(pluginPath.startsWith(pluginsRoot)).toBe(true);
    expect(
      ensureClaudeSkillPlugin({ pluginsRoot, root: { id: "r", path: first } }),
    ).toBe(pluginPath);
    expect(readlinkSync(join(pluginPath, "skills"))).toBe(first);

    const movedPluginPath = ensureClaudeSkillPlugin({
      pluginsRoot,
      root: { id: "r", path: second },
    });
    expect(movedPluginPath).not.toBe(pluginPath);
    expect(readlinkSync(join(movedPluginPath, "skills"))).toBe(second);
  });

  it("keeps the stable name across catalog changes and suffixes only a colliding second root", () => {
    const pluginsRoot = createClaudeSkillPluginsRoot(baseDir);
    const first = stageSkills("a");
    const second = stageSkills("b");
    const nameOf = (pluginPath: string): string =>
      (
        JSON.parse(
          readFileSync(
            join(pluginPath, ".claude-plugin", "plugin.json"),
            "utf8",
          ),
        ) as { name: string }
      ).name;

    expect(
      nameOf(
        ensureClaudeSkillPlugin({
          pluginsRoot,
          root: { id: "global-skills:aaaa", path: first },
        }),
      ),
    ).toBe(CLAUDE_SKILL_PLUGIN_NAME);
    expect(
      nameOf(
        ensureClaudeSkillPlugin({
          pluginsRoot,
          root: { id: "global-skills:bbbb", path: second },
        }),
      ),
    ).toBe(CLAUDE_SKILL_PLUGIN_NAME);

    const takenNames = new Map<string, string>();
    const a = ensureClaudeSkillPlugin({
      pluginsRoot,
      root: { id: "global-skills:aaaa", path: first },
      takenNames,
    });
    const b = ensureClaudeSkillPlugin({
      pluginsRoot,
      root: { id: "global-skills:bbbb", path: second },
      takenNames,
    });
    expect(nameOf(a)).toBe(CLAUDE_SKILL_PLUGIN_NAME);
    expect(nameOf(b)).toMatch(/^bb-global-skills-[0-9a-f]{8}$/u);
  });
});
