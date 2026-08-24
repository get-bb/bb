/**
 * Grok Build's host-local skill roots.
 *
 * `<grokDir>/skills` follows `$GROK_HOME`. Grok also reads Claude's and
 * Cursor's skill directories, but each can be turned off per host
 * (`compat.claude.skills` / `compat.cursor.skills` in `config.toml`, or
 * `GROK_CLAUDE_SKILLS_ENABLED` / `GROK_CURSOR_SKILLS_ENABLED`), so those
 * roots are resolved here rather than declared. Then `skills.paths`, the
 * grok plugins (repository `.grok/plugins` and `.claude/plugins`
 * directories, the home ones, `plugins.paths`, and the install registry),
 * and — with Claude compatibility on — the installed Claude plugins' skills.
 */

import path from "node:path";
import {
  experimental_resolveClaudePluginRoots,
  experimental_resolveVendorPluginRoots,
  type ExperimentalVendorPlugin,
} from "@get-bb/plugin-sdk/host";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import type {
  AcpNativeRootsEnvironment,
  AcpNativeRootsResolver,
  AcpNativeRootsResolverArgs,
  AcpResolvedSkillRoot,
} from "./resolver.js";
import {
  childDirectoryPaths,
  configuredSkillRoot,
  isPathWithinDirectory,
  readJsonFile,
  readParsedFile,
  resolveConfiguredPath,
  resolveProjectAncestorDirectories,
  resolveStoredPath,
  skillsRoot,
  type ResolvedRootOrigin,
} from "./shared.js";

const GROK_DIR_NAME = ".grok";
const CLAUDE_DIR_NAME = ".claude";
/** A directory holding this file inside a skills tree is a Claude plugin, not a skill. */
const CLAUDE_PLUGIN_MANIFEST_MARKER = ".claude-plugin/plugin.json";
const CURSOR_DIR_NAME = ".cursor";

const grokSkillConfigSchema = z
  .object({
    compat: z
      .object({
        claude: z.object({ skills: z.boolean().optional() }).optional(),
        cursor: z.object({ skills: z.boolean().optional() }).optional(),
      })
      .passthrough()
      .optional(),
    plugins: z
      .object({
        disabled: z.array(z.string()).optional(),
        enabled: z.array(z.string()).optional(),
        install_dir: z.string().optional(),
        paths: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    skills: z
      .object({ paths: z.array(z.string()).optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
type GrokSkillConfig = z.infer<typeof grokSkillConfigSchema>;

/**
 * A grok plugin manifest (`plugin.json`, `.grok-plugin/plugin.json`, or a
 * Claude plugin's `.claude-plugin/plugin.json`): the Claude plugin manifest's
 * shape. Grok reads `name` and `skills`; `defaultEnabled` and `commands`
 * still take part in the parse, so a manifest that mistypes either reads as
 * absent (the plugin named after its directory, its `skills/` listed), as
 * the Claude manifest reader answers it.
 */
const grokPluginManifestSchema = z
  .object({
    name: z.string().min(1).optional(),
    defaultEnabled: z.boolean().optional(),
    skills: z.union([z.string(), z.array(z.string())]).optional(),
    commands: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .passthrough();
type GrokPluginManifest = z.infer<typeof grokPluginManifestSchema>;

const grokInstalledPluginRegistrySchema = z
  .object({
    repos: z.record(
      z.string(),
      z
        .object({
          path: z.string(),
          plugins: z.record(
            z.string(),
            z.object({ subdir: z.string().optional() }).passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** `$GROK_HOME`, else `~/.grok`. */
export function resolveGrokDir(
  homeDir: string,
  env: AcpNativeRootsEnvironment,
): string {
  const configured = env.GROK_HOME?.trim();
  return configured
    ? resolveStoredPath(homeDir, configured)
    : path.join(homeDir, GROK_DIR_NAME);
}

/** The environment overrides the config; both default to on. */
function grokCompatEnabled(
  configured: boolean | undefined,
  environmentValue: string | undefined,
): boolean {
  const normalized = environmentValue?.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return configured ?? true;
}

/** The workspace and home `<dir>/skills` roots grok reads when a compat switch is on. */
function compatSkillRoots(
  args: AcpNativeRootsResolverArgs,
  directoryName: string,
  skipIfManifest?: string,
): AcpResolvedSkillRoot[] {
  return [
    ...(args.cwd === null
      ? []
      : [
          skillsRoot({
            ancestors: true,
            origin: "project",
            path: path.join(args.cwd, directoryName, "skills"),
            recursive: true,
            skipIfManifest,
          }),
        ]),
    skillsRoot({
      origin: "user",
      path: path.join(args.homeDir, directoryName, "skills"),
      recursive: true,
      skipIfManifest,
    }),
  ];
}

/** `skills.paths`: a path inside the repository is a project root. */
async function resolveGrokConfiguredSkillRoots(
  args: AcpNativeRootsResolverArgs,
  config: GrokSkillConfig | null,
): Promise<AcpResolvedSkillRoot[]> {
  const cwd = args.cwd ?? args.homeDir;
  const projectRootPath =
    args.cwd === null
      ? null
      : (await resolveProjectAncestorDirectories(args.cwd)).projectRootPath;
  return (config?.skills?.paths ?? []).map((configuredPath) => {
    const skillPath = resolveConfiguredPath({
      basePath: cwd,
      env: args.env,
      homeDir: args.homeDir,
      value: configuredPath,
    });
    const origin: ResolvedRootOrigin =
      projectRootPath !== null &&
      isPathWithinDirectory(projectRootPath, skillPath)
        ? "project"
        : "user";
    return configuredSkillRoot({ origin, recursive: true, skillPath });
  });
}

async function readGrokPluginManifest(
  pluginRootPath: string,
): Promise<GrokPluginManifest | null> {
  for (const relativePath of [
    "plugin.json",
    path.join(".grok-plugin", "plugin.json"),
    path.join(".claude-plugin", "plugin.json"),
  ]) {
    const manifest = await readJsonFile(
      path.join(pluginRootPath, relativePath),
      grokPluginManifestSchema,
    );
    if (manifest !== null) {
      return manifest;
    }
  }
  return null;
}

function grokPluginListMatches(
  entries: readonly string[],
  name: string,
): boolean {
  return entries.some((entry) => entry === name || entry.endsWith(`/${name}`));
}

interface GrokPluginCandidate {
  /** A `plugins.paths` entry is on unless disabled; every other plugin must be enabled. */
  autoEnabled: boolean;
  origin: ResolvedRootOrigin;
  pluginRootPath: string;
}

/** The plugin as the SDK walk reads it, or null when grok's lists switch it off. */
async function resolveGrokPlugin(
  candidate: GrokPluginCandidate,
  config: GrokSkillConfig | null,
): Promise<ExperimentalVendorPlugin | null> {
  const manifest = await readGrokPluginManifest(candidate.pluginRootPath);
  const pluginName = manifest?.name ?? path.basename(candidate.pluginRootPath);
  const enabled = config?.plugins?.enabled ?? [];
  const disabled = config?.plugins?.disabled ?? [];
  if (
    grokPluginListMatches(disabled, pluginName) ||
    (!candidate.autoEnabled && !grokPluginListMatches(enabled, pluginName))
  ) {
    return null;
  }
  return {
    rootPath: candidate.pluginRootPath,
    name: pluginName,
    origin: candidate.origin,
    // A manifest that names no `skills` means the plugin's `skills` directory.
    skills: manifest?.skills ?? ["skills"],
  };
}

async function resolveGrokPluginSkillRoots(
  args: AcpNativeRootsResolverArgs,
  config: GrokSkillConfig | null,
): Promise<AcpResolvedSkillRoot[]> {
  const candidates: GrokPluginCandidate[] = [];
  if (args.cwd !== null) {
    const { directories } = await resolveProjectAncestorDirectories(args.cwd);
    for (const directoryPath of directories) {
      for (const pluginDirectoryName of [GROK_DIR_NAME, CLAUDE_DIR_NAME]) {
        for (const pluginRootPath of await childDirectoryPaths(
          path.join(directoryPath, pluginDirectoryName, "plugins"),
        )) {
          candidates.push({
            autoEnabled: false,
            origin: "project",
            pluginRootPath,
          });
        }
      }
    }
  }
  for (const pluginsPath of [
    path.join(resolveGrokDir(args.homeDir, args.env), "plugins"),
    path.join(args.homeDir, CLAUDE_DIR_NAME, "plugins"),
  ]) {
    for (const pluginRootPath of await childDirectoryPaths(pluginsPath)) {
      candidates.push({ autoEnabled: false, origin: "user", pluginRootPath });
    }
  }

  const cwd = args.cwd ?? args.homeDir;
  for (const configuredPath of config?.plugins?.paths ?? []) {
    candidates.push({
      autoEnabled: true,
      origin: "user",
      pluginRootPath: resolveConfiguredPath({
        basePath: cwd,
        env: args.env,
        homeDir: args.homeDir,
        value: configuredPath,
      }),
    });
  }

  const configuredInstallDirectory = config?.plugins?.install_dir;
  const installDirectory = configuredInstallDirectory
    ? resolveConfiguredPath({
        basePath: cwd,
        env: args.env,
        homeDir: args.homeDir,
        value: configuredInstallDirectory,
      })
    : path.join(resolveGrokDir(args.homeDir, args.env), "installed-plugins");
  const registry = await readJsonFile(
    path.join(installDirectory, "registry.json"),
    grokInstalledPluginRegistrySchema,
  );
  for (const repo of Object.values(registry?.repos ?? {})) {
    for (const plugin of Object.values(repo.plugins)) {
      candidates.push({
        autoEnabled: false,
        origin: "user",
        pluginRootPath: plugin.subdir
          ? path.join(repo.path, plugin.subdir)
          : repo.path,
      });
    }
  }

  const plugins: ExperimentalVendorPlugin[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = path.resolve(candidate.pluginRootPath);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const plugin = await resolveGrokPlugin(candidate, config);
    if (plugin !== null) {
      plugins.push(plugin);
    }
  }
  // The grok layout: the manifest's entries only, each directory recursive.
  const roots = await experimental_resolveVendorPluginRoots({
    plugins,
    layout: "grok",
  });
  return roots.skills;
}

export const resolveGrokNativeRoots: AcpNativeRootsResolver = async (args) => {
  const config = await readParsedFile(
    path.join(resolveGrokDir(args.homeDir, args.env), "config.toml"),
    parseToml,
    grokSkillConfigSchema,
  );
  const claudeCompat = grokCompatEnabled(
    config?.compat?.claude?.skills,
    args.env.GROK_CLAUDE_SKILLS_ENABLED,
  );
  const cursorCompat = grokCompatEnabled(
    config?.compat?.cursor?.skills,
    args.env.GROK_CURSOR_SKILLS_ENABLED,
  );
  return {
    skills: [
      skillsRoot({
        origin: "user",
        path: path.join(resolveGrokDir(args.homeDir, args.env), "skills"),
        recursive: true,
      }),
      ...(claudeCompat
        ? compatSkillRoots(args, CLAUDE_DIR_NAME, CLAUDE_PLUGIN_MANIFEST_MARKER)
        : []),
      ...(cursorCompat ? compatSkillRoots(args, CURSOR_DIR_NAME) : []),
      ...(await resolveGrokConfiguredSkillRoots(args, config)),
      ...(await resolveGrokPluginSkillRoots(args, config)),
      ...(claudeCompat
        ? (await experimental_resolveClaudePluginRoots(args)).skills
        : []),
    ],
  };
};
