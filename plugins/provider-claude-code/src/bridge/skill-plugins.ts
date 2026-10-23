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
import { experimental_scanSkillFiles as scanSkillFiles } from "@get-bb/plugin-sdk/provider-bridge";
import { access } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, dirname, resolve } from "node:path";

export interface ClaudeSkillPluginRoot {
  id: string;
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

function pluginDirectoryName(root: ClaudeSkillPluginRoot): string {
  return createHash("sha256")
    .update(`${root.id}\0${root.path}`)
    .digest("hex")
    .slice(0, 16);
}

export const CLAUDE_SKILL_PLUGIN_NAME = "bb-global-skills";

const SUFFIXED_SKILL_PLUGIN_NAME = new RegExp(
  `^${CLAUDE_SKILL_PLUGIN_NAME}-[0-9a-f]{8}$`,
);

export function isClaudeSkillPluginName(name: string): boolean {
  return (
    name === CLAUDE_SKILL_PLUGIN_NAME || SUFFIXED_SKILL_PLUGIN_NAME.test(name)
  );
}

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

export function ensureClaudeSkillPlugin(args: {
  pluginsRoot: string;
  root: ClaudeSkillPluginRoot;
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

export function createClaudeSkillPluginsRoot(baseDir = tmpdir()): string {
  mkdirSync(baseDir, { recursive: true });
  return mkdtempSync(join(baseDir, "bb-claude-skill-plugins-"));
}

export async function filterClaudeSkillRoots(args: {
  roots: readonly ClaudeSkillPluginRoot[];
  cwd: string;
  pluginsRoot: string;
  claudeDir: string;
}): Promise<ClaudeSkillPluginRoot[]> {
  const nativeRoots = [join(args.claudeDir, "skills")];
  let directory = args.cwd;
  while (true) {
    nativeRoots.push(join(directory, ".claude", "skills"));
    if (
      await access(join(directory, ".git")).then(
        () => true,
        () => false,
      )
    )
      break;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const native = (
    await Promise.all(
      nativeRoots.map((root) =>
        scanSkillFiles({
          path: root,
          shape: "skill",
          boundaryPath: null,
          skipIfManifest: ".claude-plugin/plugin.json",
        }),
      ),
    )
  ).flat();
  const identity = (file: { name: string; contentSha256: string }) =>
    `${file.name}\0${file.contentSha256}`;
  const seen = new Set(native.map(identity));
  const filtered: ClaudeSkillPluginRoot[] = [];
  for (const root of args.roots) {
    const files = await scanSkillFiles({
      path: root.path,
      shape: "skill",
      boundaryPath: null,
    });
    const retained = files.filter((file) => {
      if (seen.has(identity(file))) return false;
      seen.add(identity(file));
      return true;
    });
    if (retained.length === 0) continue;
    if (retained.length === files.length) {
      filtered.push(root);
      continue;
    }
    const hash = createHash("sha256")
      .update(
        JSON.stringify(
          retained.map((file) => [
            file.name,
            file.realPath,
            file.contentSha256,
          ]),
        ),
      )
      .digest("hex");
    const filteredPath = join(args.pluginsRoot, "filtered", hash);
    mkdirSync(filteredPath, { recursive: true });
    for (const file of retained) {
      const linkPath = join(filteredPath, file.name);
      try {
        symlinkSync(dirname(file.realPath), linkPath, "dir");
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          )
        )
          throw error;
      }
    }
    filtered.push({ id: root.id, path: filteredPath });
  }
  return filtered;
}

export function claudeSkillsConfigDirectory(): string {
  return process.env.CLAUDE_CONFIG_DIR
    ? resolve(process.env.CLAUDE_CONFIG_DIR)
    : join(homedir(), ".claude");
}
