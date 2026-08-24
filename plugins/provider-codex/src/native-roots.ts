/**
 * The codex plugin's answer to `resolveNativeRoots`: the skill roots that
 * only this host knows. The declaration in `server.ts` names the static
 * ones (`.codex/skills` and `.agents/skills` in the workspace, `~/.agents/skills`
 * at home); this module adds the roots that depend on the host's own state:
 *
 * - `$CODEX_HOME/skills` and `$CODEX_HOME/skills/.system` — `CODEX_HOME`
 *   moves the codex home, so a declaration relative to `~` cannot name them.
 * - every enabled codex plugin's skills — read from `$CODEX_HOME/config.toml`
 *   (`[plugins."<name>@<marketplace>"] enabled = ...`), the plugin cache under
 *   `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/`, and each
 *   plugin's `.codex-plugin/plugin.json` manifest. The plugin directory is in
 *   the Claude plugin layout, so the SDK's `experimental_resolveVendorPluginRoots`
 *   turns it into roots: a root `SKILL.md`, `skills/`, the manifest's
 *   `skills` entries. A plugin's names carry the `<plugin-name>:` prefix.
 *
 * Every root is `user` origin: codex has no project-scoped plugin install, so
 * the workspace does not change the answer and `cwd` is not needed here.
 */
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import {
  experimental_filterResolvedNativeRoots,
  experimental_resolveVendorPluginRoots,
  type ExperimentalNativeRootsResolveAnswer,
  type ExperimentalVendorPlugin,
} from "@get-bb/plugin-sdk/host";
import { z } from "zod";
import { resolveCodexHome } from "./codex-home.js";

/**
 * The static side of codex's native skill roots, spread into the provider
 * declaration in `server.ts` and imported by the golden proof to run the
 * declaration and the resolver together: the workspace's `.codex/skills`,
 * the shared `.agents/skills` convention in the workspace and every
 * ancestor up to the repository root, and `~/.agents/skills`. Codex has no
 * native slash commands. The host-only roots come from
 * {@link resolveCodexNativeRoots}, which the `experimental_resolvesNativeRoots`
 * flag tells bb to call.
 */
export const CODEX_NATIVE_ROOTS_DECLARATION: Pick<
  PluginProviderDeclaration,
  "experimental_nativeSkillRoots" | "experimental_resolvesNativeRoots"
> = {
  experimental_nativeSkillRoots: {
    // The default home directory is declared; a CODEX_HOME that moved it
    // arrives from the resolver beside it, as the daemon scanned both.
    user: [".codex/skills", ".agents/skills"],
    project: [".codex/skills", { path: ".agents/skills", ancestors: true }],
  },
  experimental_resolvesNativeRoots: true,
};

export type CodexResolvedSkillRoot = NonNullable<
  ExperimentalNativeRootsResolveAnswer["skills"]
>[number];

export interface ResolveCodexNativeRootsArgs {
  /** The host user's home directory (`os.homedir()`). */
  homeDir: string;
  /** The host daemon's environment; `CODEX_HOME` moves the codex home. */
  env: Readonly<Record<string, string | undefined>>;
}

const CODEX_PLUGIN_DIR_NAME = ".codex-plugin";
const CODEX_PLUGIN_MANIFEST_FILE_NAME = "plugin.json";
const CODEX_CONFIG_FILE_NAME = "config.toml";

const pluginPathListSchema = z.union([z.string(), z.array(z.string())]);

const codexPluginManifestSchema = z
  .object({
    name: z.string().min(1).optional(),
    skills: pluginPathListSchema.optional(),
  })
  .passthrough();
type CodexPluginManifest = z.infer<typeof codexPluginManifestSchema>;

interface PluginCacheCandidate {
  modifiedAtMs: number;
  rootPath: string;
}

export async function resolveCodexNativeRoots(
  args: ResolveCodexNativeRootsArgs,
): Promise<ExperimentalNativeRootsResolveAnswer> {
  const codexHome = resolveCodexHome(args.homeDir, args.env);
  const skillsRootPath = path.join(codexHome, "skills");
  const skills: CodexResolvedSkillRoot[] = [
    { path: skillsRootPath, origin: "user", shape: "skills" },
    {
      path: path.join(skillsRootPath, ".system"),
      origin: "user",
      shape: "skills",
    },
    // Never a repeat of the two above: a plugin lives under
    // `$CODEX_HOME/plugins/cache`, and a manifest entry cannot leave it.
    ...(await resolveCodexPluginSkillRoots(codexHome)),
  ];
  // A plugin whose name cannot be a name prefix (a space, `@scope/x`, a
  // leading dot, over 63 characters) loses its own roots, not the codex home
  // roots or the other plugins'; past the cap the side is cut. The host
  // worker has no bb logger: the warning goes to its stderr, which the
  // daemon logs.
  return {
    skills: experimental_filterResolvedNativeRoots(
      { skills },
      { warn: console.warn },
    ).answer.skills,
  };
}

// --- config.toml: which plugins are enabled ---------------------------------

/**
 * Decode the escapes a TOML basic string may carry inside a quoted plugin
 * key. `\n`, `\r`, `\t` become the control character; any other escaped
 * character (`\"`, `\\`) becomes itself.
 */
function decodeTomlBasicString(value: string): string {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\" || index === value.length - 1) {
      decoded += character;
      continue;
    }
    index += 1;
    const escaped = value[index];
    if (escaped === "n") {
      decoded += "\n";
      continue;
    }
    if (escaped === "r") {
      decoded += "\r";
      continue;
    }
    if (escaped === "t") {
      decoded += "\t";
      continue;
    }
    decoded += escaped;
  }
  return decoded;
}

/**
 * Read `[plugins."<id>"] enabled = true|false` tables from codex's
 * `config.toml` without a TOML parser: only the plugin tables and their
 * `enabled` key matter, and a malformed line elsewhere must not hide them.
 * The plugin id may be a bare key (`[plugins.name@market]`) or a quoted
 * basic string; a trailing `# comment` is allowed on both lines. Any other
 * table header ends the current plugin table.
 */
export function readCodexEnabledPluginSettingsFromToml(
  content: string,
): ReadonlyMap<string, boolean> {
  const enabledPlugins = new Map<string, boolean>();
  let currentPluginId: string | null = null;

  for (const line of content.split(/\r?\n/u)) {
    const sectionMatch = line.match(
      /^\s*\[plugins\.(?:"((?:\\.|[^"\\])*)"|([^\]\s]+))\]\s*(?:#.*)?$/u,
    );
    if (sectionMatch) {
      currentPluginId =
        sectionMatch[1] !== undefined
          ? decodeTomlBasicString(sectionMatch[1])
          : (sectionMatch[2] ?? null);
      continue;
    }

    if (/^\s*\[/u.test(line)) {
      currentPluginId = null;
      continue;
    }

    if (currentPluginId === null) {
      continue;
    }
    const enabledMatch = line.match(
      /^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/u,
    );
    if (enabledMatch) {
      enabledPlugins.set(currentPluginId, enabledMatch[1] === "true");
    }
  }

  return enabledPlugins;
}

async function readCodexEnabledPluginSettings(
  codexHome: string,
): Promise<ReadonlyMap<string, boolean>> {
  try {
    return readCodexEnabledPluginSettingsFromToml(
      await fs.readFile(path.join(codexHome, CODEX_CONFIG_FILE_NAME), "utf8"),
    );
  } catch {
    return new Map<string, boolean>();
  }
}

// --- plugin cache: which install of each plugin to read --------------------

async function directoryHasCodexPluginManifest(
  directoryPath: string,
): Promise<boolean> {
  try {
    const stat = await fs.lstat(
      path.join(
        directoryPath,
        CODEX_PLUGIN_DIR_NAME,
        CODEX_PLUGIN_MANIFEST_FILE_NAME,
      ),
    );
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readCodexPluginManifest(
  pluginRootPath: string,
): Promise<CodexPluginManifest | null> {
  let content: string;
  try {
    content = await fs.readFile(
      path.join(
        pluginRootPath,
        CODEX_PLUGIN_DIR_NAME,
        CODEX_PLUGIN_MANIFEST_FILE_NAME,
      ),
      "utf8",
    );
  } catch {
    return null;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    return null;
  }
  const parsed = codexPluginManifestSchema.safeParse(parsedJson);
  return parsed.success ? parsed.data : null;
}

async function statCodexPluginCacheCandidate(
  rootPath: string,
): Promise<PluginCacheCandidate | null> {
  if (!(await directoryHasCodexPluginManifest(rootPath))) {
    return null;
  }
  try {
    const stat = await fs.stat(rootPath);
    return { rootPath, modifiedAtMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * One plugin may have several cached installs (`<plugin>/<version>/`); the
 * most recently modified directory that holds a manifest is the live one.
 */
async function resolveLatestPluginCacheRoot(
  pluginCacheRootPath: string,
): Promise<string | null> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(pluginCacheRootPath, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates: PluginCacheCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = await statCodexPluginCacheCandidate(
      path.join(pluginCacheRootPath, entry.name),
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return (
    candidates.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)[0]
      ?.rootPath ?? null
  );
}

async function readDirectoryEntries(directoryPath: string): Promise<Dirent[]> {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

/** Every enabled plugin in the cache, named from its manifest, else its cache directory. */
async function resolveEnabledCodexPlugins(
  codexHome: string,
): Promise<ExperimentalVendorPlugin[]> {
  const enabledPlugins = await readCodexEnabledPluginSettings(codexHome);
  const cacheRootPath = path.join(codexHome, "plugins", "cache");
  const plugins: ExperimentalVendorPlugin[] = [];

  for (const marketplaceEntry of await readDirectoryEntries(cacheRootPath)) {
    const marketplacePath = path.join(cacheRootPath, marketplaceEntry.name);
    for (const pluginEntry of await readDirectoryEntries(marketplacePath)) {
      const pluginId = `${pluginEntry.name}@${marketplaceEntry.name}`;
      if (enabledPlugins.get(pluginId) === false) {
        continue;
      }
      const rootPath = await resolveLatestPluginCacheRoot(
        path.join(marketplacePath, pluginEntry.name),
      );
      if (rootPath === null) {
        continue;
      }
      const manifest = await readCodexPluginManifest(rootPath);
      if (!manifest) {
        continue;
      }
      plugins.push({
        rootPath,
        name: manifest.name ?? pluginEntry.name,
        // Codex has no project-scoped install: a plugin is the user's own,
        // so a symlinked skill directory or `SKILL.md` in it is followed.
        origin: "user",
        skills: manifest.skills,
      });
    }
  }
  return plugins;
}

// --- plugin components: the roots one plugin contributes --------------------

async function resolveCodexPluginSkillRoots(
  codexHome: string,
): Promise<CodexResolvedSkillRoot[]> {
  const roots = await experimental_resolveVendorPluginRoots({
    plugins: await resolveEnabledCodexPlugins(codexHome),
    layout: "claude",
  });
  return roots.skills;
}
