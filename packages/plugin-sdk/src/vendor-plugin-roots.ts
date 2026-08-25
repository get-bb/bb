/**
 * The roots of the vendor plugins installed on a host, for a provider
 * plugin's `resolveNativeRoots` answer: a reader for Claude Code's plugin
 * registry, and the walk over a plugin directory in the Claude plugin layout
 * (codex plugins and grok plugins share it) that turns one plugin into its
 * skill and command roots. Every provider that lists vendor plugins applies
 * one rule set for scopes, enablement, symlinks and repeated paths.
 *
 * Every path answered is host-absolute and normalized. A root carries the
 * plugin's name as its `namePrefix` (`<plugin>:`), as Claude Code namespaces
 * a plugin's skills and commands. Within an answer a path appears once per
 * side: the first root to claim it, in answer order, is kept and a later one
 * is dropped. The contract accepts a resolved answer that repeats a path and
 * the daemon scans the first root per path, so the rule changes no listing;
 * it makes the answer say what is scanned.
 *
 * Symlinks follow the root's origin. A personal (`user`) plugin commonly
 * links a skill from elsewhere in the home directory, so its skill
 * components are followed; a checked-in (`project`) plugin must not point bb
 * outside the repository, so its links are not. Command components never
 * follow a link, whatever the origin.
 */
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ExperimentalNativeRootsResolveAnswer } from "./native-roots-contract.js";

/** One root of a `resolveNativeRoots` answer, in the form a handler writes. */
type ResolvedRoot = NonNullable<
  ExperimentalNativeRootsResolveAnswer["skills"]
>[number];

type ResolvedRootOrigin = "user" | "project";
type ResolvedRootSide = "skills" | "commands";
type PluginComponentKind = "directory" | "file" | "missing";

/** The two sides of a `resolveNativeRoots` answer, each path once per side. */
export interface ExperimentalVendorPluginRoots {
  skills: ResolvedRoot[];
  commands: ResolvedRoot[];
}

/** One installed vendor plugin in the Claude plugin layout. */
export interface ExperimentalVendorPlugin {
  /** The plugin's root directory (the one holding its manifest), host-absolute. */
  rootPath: string;
  /**
   * The plugin's name: every root is prefixed `<name>:`, and a root
   * `SKILL.md` is named after it when the file's frontmatter names none. A
   * name that cannot be a name prefix costs the plugin its own roots at
   * `experimental_filterResolvedNativeRoots`, not the rest of the answer.
   */
  name: string;
  /** `user` for a personal install, `project` for one the workspace holds. */
  origin: ResolvedRootOrigin;
  /**
   * The manifest's `skills` entries, relative to the root, in the manifest's
   * own form (one path or a list). An absolute or escaping entry is ignored.
   */
  skills?: string | readonly string[];
  /** The manifest's `commands` entries, in the same form. */
  commands?: string | readonly string[];
}

export interface ExperimentalVendorPluginRootsArgs {
  /** The plugins in answer order; the first to claim a path keeps it. */
  plugins: readonly ExperimentalVendorPlugin[];
  /**
   * The plugin layout. `claude` lists the conventional roots — the root
   * `SKILL.md`, `skills/` and `commands/` — and then the manifest's entries,
   * each directory read flat: a manifest directory that holds `SKILL.md`
   * itself is one skill. `grok` lists the manifest's entries only, each
   * directory read recursively.
   */
  layout: "claude" | "grok";
}

export interface ExperimentalClaudePluginRootsArgs {
  /**
   * The workspace, or null when bb lists without one: project- and
   * local-scoped installs and the project skills directory's plugins count
   * only for the workspace that holds them.
   */
  cwd: string | null;
  /** The host user's home directory. */
  homeDir: string;
  /** The host environment; only `CLAUDE_CONFIG_DIR` is read. */
  env: Readonly<Record<string, string | undefined>>;
}

export interface ExperimentalClaudePluginRoots extends ExperimentalVendorPluginRoots {
  /**
   * The Claude config directory the registry was read from:
   * `CLAUDE_CONFIG_DIR` (absolute, `~`-relative, or relative to the home
   * directory), else `~/.claude`. A resolver that also lists the directory's
   * own `skills` and `commands` takes it from here, so both agree.
   */
  claudeDir: string;
}

// --- the walk: one plugin directory to its roots ----------------------------

/** The roots of an answer; a path appears once per side, first writer wins. */
class RootCollector {
  readonly skills: ResolvedRoot[] = [];
  readonly commands: ResolvedRoot[] = [];
  private readonly seen = {
    skills: new Set<string>(),
    commands: new Set<string>(),
  };

  add(side: ResolvedRootSide, root: ResolvedRoot): void {
    if (this.seen[side].has(root.path)) {
      return;
    }
    this.seen[side].add(root.path);
    this[side].push(root);
  }
}

function normalizePluginPathList(
  value: string | readonly string[] | undefined,
): string[] {
  if (value === undefined) {
    return [];
  }
  return typeof value === "string" ? [value] : [...value];
}

function isPathWithinDirectory(
  directoryPath: string,
  candidatePath: string,
): boolean {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

/** A manifest entry resolves only inside its plugin; absolute and escaping paths are dropped. */
function resolvePluginRelativePath(
  pluginRootPath: string,
  relativePath: string,
): string | null {
  if (path.isAbsolute(relativePath)) {
    return null;
  }
  const resolvedPath = path.resolve(pluginRootPath, relativePath);
  return isPathWithinDirectory(pluginRootPath, resolvedPath)
    ? resolvedPath
    : null;
}

/** What a skill component path is; a symlink is followed for a user-origin plugin only. */
async function resolvePluginComponentKind(
  componentPath: string,
  origin: ResolvedRootOrigin,
): Promise<PluginComponentKind> {
  try {
    const stat = await fs.lstat(componentPath);
    if (stat.isFile()) {
      return "file";
    }
    if (stat.isDirectory()) {
      return "directory";
    }
    if (!stat.isSymbolicLink() || origin !== "user") {
      return "missing";
    }
    const targetStat = await fs.stat(componentPath);
    if (targetStat.isFile()) {
      return "file";
    }
    return targetStat.isDirectory() ? "directory" : "missing";
  } catch {
    return "missing";
  }
}

/** A skill directory is one skill when it holds `SKILL.md` itself. */
async function resolveSkillDirectoryShape(
  componentPath: string,
  origin: ResolvedRootOrigin,
): Promise<"skill" | "skills"> {
  const skillFileKind = await resolvePluginComponentKind(
    path.join(componentPath, "SKILL.md"),
    origin,
  );
  return skillFileKind === "file" ? "skill" : "skills";
}

/** The conventional roots of the Claude layout: a root `SKILL.md`, `skills/`, and `commands/`. */
async function addConventionalRoots(
  collector: RootCollector,
  plugin: ExperimentalVendorPlugin,
  namePrefix: string,
): Promise<void> {
  const rootSkillFilePath = path.join(plugin.rootPath, "SKILL.md");
  const rootSkillFileKind = await resolvePluginComponentKind(
    rootSkillFilePath,
    plugin.origin,
  );
  if (rootSkillFileKind === "file") {
    collector.add("skills", {
      path: rootSkillFilePath,
      origin: plugin.origin,
      namePrefix,
      shape: "skill-file",
      fallbackName: plugin.name,
    });
  }

  const skillsRootPath = path.join(plugin.rootPath, "skills");
  const skillsRootKind = await resolvePluginComponentKind(
    skillsRootPath,
    plugin.origin,
  );
  if (skillsRootKind === "directory") {
    collector.add("skills", {
      path: skillsRootPath,
      origin: plugin.origin,
      namePrefix,
      shape: "skills",
    });
  }

  const commandsRootPath = path.join(plugin.rootPath, "commands");
  const commandsRootStat = await fs.lstat(commandsRootPath).catch(() => null);
  if (commandsRootStat?.isDirectory()) {
    collector.add("commands", {
      path: commandsRootPath,
      origin: plugin.origin,
      namePrefix,
      shape: "commands",
    });
  }
}

/**
 * The manifest's `skills` entries: a `SKILL.md` file is one skill, a
 * directory holding `SKILL.md` is one skill (read flat) or a recursive
 * directory of skills (read recursively), any other directory holds skills.
 */
async function addManifestSkillRoots(
  collector: RootCollector,
  plugin: ExperimentalVendorPlugin,
  namePrefix: string,
  recursive: boolean,
): Promise<void> {
  for (const entry of normalizePluginPathList(plugin.skills)) {
    const componentPath = resolvePluginRelativePath(plugin.rootPath, entry);
    if (componentPath === null) {
      continue;
    }
    const componentKind = await resolvePluginComponentKind(
      componentPath,
      plugin.origin,
    );
    if (
      componentKind === "file" &&
      path.basename(componentPath) === "SKILL.md"
    ) {
      collector.add("skills", {
        path: componentPath,
        origin: plugin.origin,
        namePrefix,
        shape: "skill-file",
      });
      continue;
    }
    if (componentKind !== "directory") {
      continue;
    }
    if (recursive) {
      collector.add("skills", {
        path: componentPath,
        origin: plugin.origin,
        recursive: true,
        namePrefix,
        shape: "skills",
      });
      continue;
    }
    collector.add("skills", {
      path: componentPath,
      origin: plugin.origin,
      namePrefix,
      shape: await resolveSkillDirectoryShape(componentPath, plugin.origin),
    });
  }
}

/** The manifest's `commands` entries: a `.md` file is one command, a directory holds commands. */
async function addManifestCommandRoots(
  collector: RootCollector,
  plugin: ExperimentalVendorPlugin,
  namePrefix: string,
): Promise<void> {
  for (const entry of normalizePluginPathList(plugin.commands)) {
    const componentPath = resolvePluginRelativePath(plugin.rootPath, entry);
    if (componentPath === null) {
      continue;
    }
    const stat = await fs.lstat(componentPath).catch(() => null);
    if (stat === null) {
      continue;
    }
    if (stat.isFile() && componentPath.endsWith(".md")) {
      collector.add("commands", {
        path: componentPath,
        origin: plugin.origin,
        namePrefix,
        shape: "command-file",
      });
      continue;
    }
    if (stat.isDirectory()) {
      collector.add("commands", {
        path: componentPath,
        origin: plugin.origin,
        namePrefix,
        shape: "commands",
      });
    }
  }
}

/**
 * The skill and command roots of the given plugins, in the given order, each
 * prefixed with its plugin's name. In the `claude` layout a plugin
 * contributes its root `SKILL.md` (named after the plugin when the file's
 * frontmatter has no name), `skills/`, `commands/`, then the manifest's
 * `skills` and `commands` entries; in the `grok` layout the manifest's
 * entries only, each directory recursive. A missing component is skipped; a
 * path answered twice is kept for the first plugin that named it.
 */
export async function experimental_resolveVendorPluginRoots(
  args: ExperimentalVendorPluginRootsArgs,
): Promise<ExperimentalVendorPluginRoots> {
  const collector = new RootCollector();
  for (const plugin of args.plugins) {
    const namePrefix = `${plugin.name}:`;
    if (args.layout === "claude") {
      await addConventionalRoots(collector, plugin, namePrefix);
    }
    await addManifestSkillRoots(
      collector,
      plugin,
      namePrefix,
      args.layout === "grok",
    );
    await addManifestCommandRoots(collector, plugin, namePrefix);
  }
  return { skills: collector.skills, commands: collector.commands };
}

// --- Claude Code's plugin registry -----------------------------------------

const CLAUDE_DIR_NAME = ".claude";
const CLAUDE_PLUGIN_MANIFEST_PATH = path.join(".claude-plugin", "plugin.json");
const CLAUDE_PLUGIN_INSTALLED_FILE_NAME = "installed_plugins.json";

const claudePluginScopeSchema = z.enum(["managed", "project", "local", "user"]);
type ClaudePluginScope = z.infer<typeof claudePluginScopeSchema>;

const claudeSettingsSchema = z
  .object({
    enabledPlugins: z.record(z.string(), z.boolean()).optional(),
  })
  .passthrough();

const claudeInstalledPluginEntrySchema = z
  .object({
    gitCommitSha: z.string().nullable().optional(),
    installPath: z.string().min(1),
    scope: claudePluginScopeSchema,
  })
  .passthrough();

const claudeInstalledPluginsFileSchema = z
  .object({
    plugins: z.record(z.string(), z.array(claudeInstalledPluginEntrySchema)),
  })
  .passthrough();

const claudePluginPathListSchema = z.union([z.string(), z.array(z.string())]);

const claudePluginManifestSchema = z
  .object({
    name: z.string().min(1).optional(),
    defaultEnabled: z.boolean().optional(),
    skills: claudePluginPathListSchema.optional(),
    commands: claudePluginPathListSchema.optional(),
  })
  .passthrough();
type ClaudePluginManifest = z.infer<typeof claudePluginManifestSchema>;

type EnabledPlugins = ReadonlyMap<string, boolean>;

interface ClaudeInstalledPluginReference {
  gitCommitSha: string | null;
  id: string;
  installPath: string;
  scope: ClaudePluginScope;
}

interface PluginCacheCandidate {
  modifiedAtMs: number;
  rootPath: string;
}

interface ResolvedClaudeDirs {
  claudeDir: string;
  cwd: string | null;
  homeDir: string;
}

/** A path Claude stores: `~`, `~/...`, absolute, or relative to the home directory. */
function resolveStoredPath(homeDir: string, storedPath: string): string {
  if (storedPath === "~") {
    return homeDir;
  }
  if (storedPath.startsWith("~/")) {
    return path.join(homeDir, storedPath.slice(2));
  }
  return path.resolve(homeDir, storedPath);
}

function resolveClaudeConfigDir(
  homeDir: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  return configured
    ? resolveStoredPath(homeDir, configured)
    : path.join(homeDir, CLAUDE_DIR_NAME);
}

/** A vendor file that is missing, unparseable, or not the expected shape reads as absent. */
async function readJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    return null;
  }

  const parsed = schema.safeParse(parsedJson);
  return parsed.success ? parsed.data : null;
}

async function readDirectoryEntries(directoryPath: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function directoryHasClaudePluginManifest(
  directoryPath: string,
): Promise<boolean> {
  try {
    const stat = await fs.lstat(
      path.join(directoryPath, CLAUDE_PLUGIN_MANIFEST_PATH),
    );
    return stat.isFile();
  } catch {
    return false;
  }
}

function readClaudePluginManifest(
  pluginRootPath: string,
): Promise<ClaudePluginManifest | null> {
  return readJsonFile(
    path.join(pluginRootPath, CLAUDE_PLUGIN_MANIFEST_PATH),
    claudePluginManifestSchema,
  );
}

function parseMarketplacePluginId(
  pluginId: string,
): { marketplaceName: string; pluginName: string } | null {
  const separatorIndex = pluginId.lastIndexOf("@");
  if (separatorIndex <= 0 || separatorIndex === pluginId.length - 1) {
    return null;
  }
  return {
    pluginName: pluginId.slice(0, separatorIndex),
    marketplaceName: pluginId.slice(separatorIndex + 1),
  };
}

function originForClaudePluginScope(
  scope: ClaudePluginScope,
): ResolvedRootOrigin {
  return scope === "project" || scope === "local" ? "project" : "user";
}

/** Project- and local-scoped installs count only for the workspace that holds them. */
function shouldIncludeInstalledClaudePlugin(
  cwd: string | null,
  plugin: ClaudeInstalledPluginReference,
): boolean {
  if (plugin.scope === "managed" || plugin.scope === "user") {
    return true;
  }
  return cwd !== null && isPathWithinDirectory(cwd, plugin.installPath);
}

/** Later settings files override earlier ones per plugin id. */
async function readClaudeEnabledPluginSettings(
  settingsFiles: readonly string[],
): Promise<EnabledPlugins> {
  const enabledPlugins = new Map<string, boolean>();
  for (const settingsFile of settingsFiles) {
    const settings = await readJsonFile(settingsFile, claudeSettingsSchema);
    for (const [pluginId, enabled] of Object.entries(
      settings?.enabledPlugins ?? {},
    )) {
      enabledPlugins.set(pluginId, enabled);
    }
  }
  return enabledPlugins;
}

/** User settings, then the workspace's `settings.json` and `settings.local.json`. */
function resolveClaudeSettingsFiles(dirs: ResolvedClaudeDirs): string[] {
  const files = [path.join(dirs.claudeDir, "settings.json")];
  if (dirs.cwd !== null) {
    files.push(
      path.join(dirs.cwd, CLAUDE_DIR_NAME, "settings.json"),
      path.join(dirs.cwd, CLAUDE_DIR_NAME, "settings.local.json"),
    );
  }
  return files;
}

async function readClaudeInstalledPluginReferences(
  dirs: ResolvedClaudeDirs,
): Promise<ClaudeInstalledPluginReference[]> {
  const installedPlugins = await readJsonFile(
    path.join(dirs.claudeDir, "plugins", CLAUDE_PLUGIN_INSTALLED_FILE_NAME),
    claudeInstalledPluginsFileSchema,
  );
  if (!installedPlugins) {
    return [];
  }

  const references: ClaudeInstalledPluginReference[] = [];
  for (const [id, entries] of Object.entries(installedPlugins.plugins)) {
    for (const entry of entries) {
      references.push({
        id,
        installPath: resolveStoredPath(dirs.homeDir, entry.installPath),
        scope: entry.scope,
        gitCommitSha: entry.gitCommitSha ?? null,
      });
    }
  }
  return references;
}

/**
 * An install path whose directory is gone (the cache was re-keyed by commit,
 * say) falls back to the plugin's cache directory: the entry whose name starts
 * with the recorded commit, else the most recently modified one.
 */
async function findFallbackClaudePluginRoot(
  dirs: ResolvedClaudeDirs,
  plugin: ClaudeInstalledPluginReference,
): Promise<string | null> {
  const pluginId = parseMarketplacePluginId(plugin.id);
  if (!pluginId) {
    return null;
  }

  const pluginCacheRootPath = path.join(
    dirs.claudeDir,
    "plugins",
    "cache",
    pluginId.marketplaceName,
    pluginId.pluginName,
  );
  const candidates: PluginCacheCandidate[] = [];
  for (const entry of await readDirectoryEntries(pluginCacheRootPath)) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidatePath = path.join(pluginCacheRootPath, entry.name);
    if (!(await directoryHasClaudePluginManifest(candidatePath))) {
      continue;
    }
    try {
      const stat = await fs.stat(candidatePath);
      candidates.push({ rootPath: candidatePath, modifiedAtMs: stat.mtimeMs });
    } catch {
      continue;
    }
  }

  const commitPrefix = plugin.gitCommitSha?.slice(0, 12);
  if (commitPrefix) {
    const commitMatch = candidates.find((candidate) =>
      path.basename(candidate.rootPath).startsWith(commitPrefix),
    );
    if (commitMatch) {
      return commitMatch.rootPath;
    }
  }

  return (
    candidates.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)[0]
      ?.rootPath ?? null
  );
}

function isPluginEnabled(
  enabledPlugins: EnabledPlugins,
  pluginId: string,
  manifest: ClaudePluginManifest,
): boolean {
  return enabledPlugins.get(pluginId) ?? manifest.defaultEnabled ?? true;
}

function vendorPlugin(
  rootPath: string,
  name: string,
  origin: ResolvedRootOrigin,
  manifest: ClaudePluginManifest,
): ExperimentalVendorPlugin {
  return {
    rootPath,
    name,
    origin,
    skills: manifest.skills,
    commands: manifest.commands,
  };
}

/** The registry's installs, named from the manifest, then the marketplace id, then the directory. */
async function resolveInstalledClaudePlugins(
  dirs: ResolvedClaudeDirs,
  enabledPlugins: EnabledPlugins,
): Promise<ExperimentalVendorPlugin[]> {
  const plugins: ExperimentalVendorPlugin[] = [];
  for (const plugin of await readClaudeInstalledPluginReferences(dirs)) {
    if (!shouldIncludeInstalledClaudePlugin(dirs.cwd, plugin)) {
      continue;
    }
    const rootPath = (await directoryHasClaudePluginManifest(
      plugin.installPath,
    ))
      ? plugin.installPath
      : await findFallbackClaudePluginRoot(dirs, plugin);
    if (rootPath === null) {
      continue;
    }
    const manifest = await readClaudePluginManifest(rootPath);
    if (!manifest || !isPluginEnabled(enabledPlugins, plugin.id, manifest)) {
      continue;
    }
    const pluginId = parseMarketplacePluginId(plugin.id);
    plugins.push(
      vendorPlugin(
        rootPath,
        manifest.name ?? pluginId?.pluginName ?? path.basename(rootPath),
        originForClaudePluginScope(plugin.scope),
        manifest,
      ),
    );
  }
  return plugins;
}

/** A directory entry holding a manifest; a symlinked one counts for the user skills directory only. */
async function isSkillsDirectoryPluginEntry(
  entry: Dirent,
  entryPath: string,
  origin: ResolvedRootOrigin,
): Promise<boolean> {
  if (entry.isDirectory()) {
    return directoryHasClaudePluginManifest(entryPath);
  }
  if (!entry.isSymbolicLink() || origin !== "user") {
    return false;
  }
  try {
    const stat = await fs.stat(entryPath);
    return (
      stat.isDirectory() && (await directoryHasClaudePluginManifest(entryPath))
    );
  } catch {
    return false;
  }
}

/**
 * A plugin dropped straight into a `skills` directory (it carries
 * `.claude-plugin/plugin.json`) is a plugin, not a skill; its id for the
 * settings switch is `<name>@skills-dir`. Directory-name order.
 */
async function resolveSkillsDirectoryClaudePlugins(
  skillsRootPath: string,
  origin: ResolvedRootOrigin,
  enabledPlugins: EnabledPlugins,
): Promise<ExperimentalVendorPlugin[]> {
  const plugins: ExperimentalVendorPlugin[] = [];
  const entries = (await readDirectoryEntries(skillsRootPath)).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const pluginRootPath = path.join(skillsRootPath, entry.name);
    if (!(await isSkillsDirectoryPluginEntry(entry, pluginRootPath, origin))) {
      continue;
    }
    const manifest = await readClaudePluginManifest(pluginRootPath);
    if (!manifest) {
      continue;
    }
    const pluginName = manifest.name ?? entry.name;
    if (
      !isPluginEnabled(enabledPlugins, `${pluginName}@skills-dir`, manifest)
    ) {
      continue;
    }
    plugins.push(vendorPlugin(pluginRootPath, pluginName, origin, manifest));
  }
  return plugins;
}

/**
 * The roots of every enabled Claude plugin on this host, for one workspace.
 * Claude Code records installs in `<claudeDir>/plugins/installed_plugins.json`
 * and switches them in its settings (`enabledPlugins`: user, then the
 * workspace's `settings.json`, then `settings.local.json`; a manifest's
 * `defaultEnabled` decides an unlisted plugin). A `managed` or `user` install
 * is a user root; a `project` or `local` install counts only when the
 * workspace contains it, and is then a project root. An install whose
 * directory is gone is read from the plugin's cache directory. Plugins
 * dropped into the project and user `skills` directories follow. Each
 * plugin's roots come from `experimental_resolveVendorPluginRoots`
 * (`claude` layout), prefixed `<plugin>:`.
 */
export async function experimental_resolveClaudePluginRoots(
  args: ExperimentalClaudePluginRootsArgs,
): Promise<ExperimentalClaudePluginRoots> {
  const dirs: ResolvedClaudeDirs = {
    claudeDir: resolveClaudeConfigDir(args.homeDir, args.env),
    cwd: args.cwd === null ? null : path.resolve(args.cwd),
    homeDir: args.homeDir,
  };
  const enabledPlugins = await readClaudeEnabledPluginSettings(
    resolveClaudeSettingsFiles(dirs),
  );
  const plugins = await resolveInstalledClaudePlugins(dirs, enabledPlugins);
  if (dirs.cwd !== null) {
    plugins.push(
      ...(await resolveSkillsDirectoryClaudePlugins(
        path.join(dirs.cwd, CLAUDE_DIR_NAME, "skills"),
        "project",
        enabledPlugins,
      )),
    );
  }
  plugins.push(
    ...(await resolveSkillsDirectoryClaudePlugins(
      path.join(dirs.claudeDir, "skills"),
      "user",
      enabledPlugins,
    )),
  );
  const roots = await experimental_resolveVendorPluginRoots({
    plugins,
    layout: "claude",
  });
  return { claudeDir: dirs.claudeDir, ...roots };
}
