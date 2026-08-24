import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Claude loads injected skills as local plugins, and a local plugin is a
 * directory with `.claude-plugin/plugin.json` whose `skills` entries are
 * plugin-relative (the manifest schema rejects absolute paths and `..`). The
 * generic `skills/configure` root is an absolute skills directory, so the
 * bridge assembles one plugin per root here: a manifest pointing at
 * `./skills`, and `skills` as a symlink to the root. Claude follows the
 * symlink when a session loads the plugin (its validator says so while
 * refusing to read through it), so the staged files are never copied.
 */

export interface ClaudeSkillPluginRoot {
  id: string;
  /** Absolute directory holding one subdirectory per skill. */
  path: string;
}

interface ClaudePluginManifest {
  $schema: string;
  name: string;
  version: string;
  description: string;
  author: { name: string };
  skills: string;
}

const MANIFEST_SCHEMA = "https://anthropic.com/claude-code/plugin.schema.json";

/** A plugin directory name that is stable for a root and safe on disk. */
function pluginDirectoryName(root: ClaudeSkillPluginRoot): string {
  return createHash("sha256")
    .update(`${root.id}\0${root.path}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * The plugin name Claude namespaces every injected skill under
 * (`<plugin>:<skill>`): it shows as the Skill tool's title and the model must
 * type it on every invocation, so it is the stable `bb-global-skills` — never
 * the catalog hash, which changes whenever any skill in the catalog does and
 * would leave a resumed transcript naming a plugin that no longer exists. A
 * second root in the same process (two catalogs side by side) gets a short
 * suffix so the two plugins do not collide.
 */
export const CLAUDE_SKILL_PLUGIN_NAME = "bb-global-skills";

function pluginNameFor(
  root: ClaudeSkillPluginRoot,
  takenBy: ReadonlyMap<string, string>,
): string {
  const directory = pluginDirectoryName(root);
  const owner = takenBy.get(CLAUDE_SKILL_PLUGIN_NAME);
  if (owner === undefined || owner === directory) {
    return CLAUDE_SKILL_PLUGIN_NAME;
  }
  return `${CLAUDE_SKILL_PLUGIN_NAME}-${directory.slice(0, 8)}`;
}

/**
 * Assemble (or refresh) the local plugin for one root under `pluginsRoot`
 * and return its path. Idempotent: a second call for the same root rewrites
 * the manifest and re-points the symlink.
 */
export function ensureClaudeSkillPlugin(args: {
  pluginsRoot: string;
  root: ClaudeSkillPluginRoot;
  /** Plugin names already assembled under `pluginsRoot` → their directory. */
  takenNames?: Map<string, string>;
}): string {
  const directory = pluginDirectoryName(args.root);
  const pluginPath = join(args.pluginsRoot, directory);
  const takenNames = args.takenNames ?? new Map<string, string>();
  const name = pluginNameFor(args.root, takenNames);
  takenNames.set(name, directory);
  mkdirSync(join(pluginPath, ".claude-plugin"), { recursive: true });
  const manifest: ClaudePluginManifest = {
    $schema: MANIFEST_SCHEMA,
    name,
    version: "0.1.0",
    description: `Skills injected by bb (${args.root.id}).`,
    author: { name: "bb" },
    skills: "./skills",
  };
  writeFileSync(
    join(pluginPath, ".claude-plugin", "plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  const skillsLink = join(pluginPath, "skills");
  let current: string | null = null;
  try {
    current = lstatSync(skillsLink).isSymbolicLink()
      ? readlinkSync(skillsLink)
      : "";
  } catch {
    current = null;
  }
  if (current !== args.root.path) {
    rmSync(skillsLink, { recursive: true, force: true });
    symlinkSync(args.root.path, skillsLink, "dir");
  }
  return pluginPath;
}

/** A fresh, process-private directory for the assembled plugins. */
export function createClaudeSkillPluginsRoot(baseDir = tmpdir()): string {
  mkdirSync(baseDir, { recursive: true });
  return mkdtempSync(join(baseDir, "bb-claude-skill-plugins-"));
}
