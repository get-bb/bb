import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveDataDirSkillsRootPath } from "@bb/config/skill-storage-paths";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import { z } from "zod";
import {
  CommandDispatchError,
  type CommandOf,
} from "../command-dispatch-support.js";
import {
  discoverProviderCommands,
  type CommandScanRoot,
} from "../command-discovery.js";

export interface CommandRootResolution {
  /** Resolved workspace path, or null for an unprovisioned thread. */
  cwd: string | null;
  /** Built-in bb skills bundled with the server. */
  builtinSkillsRootPath: string;
  /** Additional bb skill roots inherited by managed dev app instances. */
  additionalSkillsRootPaths: readonly string[];
  /** bb data directory containing user-installed bb skills. */
  dataDir: string;
  /** Claude user-home base (`os.homedir()`). */
  homeDir: string;
  /** Codex user-home base (`$CODEX_HOME` or `~/.codex`). */
  codexHome: string;
  providerId: string;
}

type ClaudePluginScope = "managed" | "project" | "local" | "user";
type ClaudePluginOrigin = "project" | "user";
type PluginComponentKind = "directory" | "file" | "missing";

interface CodexSettingsPlugins {
  enabledPlugins: ReadonlyMap<string, boolean>;
}

interface CodexPluginRoot {
  manifest: CodexPluginManifest;
  pluginName: string;
  rootPath: string;
}

interface ResolveCodexPluginRootsArgs {
  codexHome: string;
}

interface ClaudeSettingsPlugins {
  enabledPlugins: ReadonlyMap<string, boolean>;
}

interface ClaudeInstalledPluginReference {
  gitCommitSha: string | null;
  id: string;
  installPath: string;
  scope: ClaudePluginScope;
}

interface ClaudePluginIdParts {
  marketplaceName: string;
  pluginName: string;
}

interface ClaudePluginRoot {
  manifest: ClaudePluginManifest;
  origin: ClaudePluginOrigin;
  pluginName: string;
  rootPath: string;
}

interface ResolveClaudePluginRootsArgs {
  cwd: string | null;
  homeDir: string;
}

interface ResolveInstalledClaudePluginRootArgs {
  homeDir: string;
  plugin: ClaudeInstalledPluginReference;
}

interface AddCodexPluginComponentRootsArgs {
  plugin: CodexPluginRoot;
  roots: CommandScanRoot[];
}

interface AddClaudePluginComponentRootsArgs {
  plugin: ClaudePluginRoot;
  roots: CommandScanRoot[];
}

interface AddPluginDirectoryRootsArgs {
  namePrefix: string;
  origin: ClaudePluginOrigin;
  pluginRootPath: string;
  rootSkillFallbackName: string;
  roots: CommandScanRoot[];
  seenRoots: Set<string>;
}

interface AddPluginPathRootsArgs extends AddPluginDirectoryRootsArgs {
  entries: readonly string[];
}

interface PluginCacheCandidate {
  modifiedAtMs: number;
  rootPath: string;
}

interface ResolvePluginComponentKindArgs {
  componentPath: string;
  followUserSymlink: boolean;
}

interface ResolvePluginSkillRootShapeArgs {
  componentPath: string;
  origin: ClaudePluginOrigin;
}

const CODEX_PLUGIN_DIR_NAME = ".codex-plugin";
const CODEX_PLUGIN_MANIFEST_FILE_NAME = "plugin.json";
const CODEX_CONFIG_FILE_NAME = "config.toml";
const CLAUDE_DIR_NAME = ".claude";
const CLAUDE_PLUGIN_DIR_NAME = ".claude-plugin";
const CLAUDE_PLUGIN_MANIFEST_FILE_NAME = "plugin.json";
const CLAUDE_PLUGIN_INSTALLED_FILE_NAME = "installed_plugins.json";

const claudePluginScopeSchema = z.enum(["managed", "project", "local", "user"]);

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

const codexPluginManifestSchema = z
  .object({
    name: z.string().min(1).optional(),
    skills: claudePluginPathListSchema.optional(),
  })
  .passthrough();
type CodexPluginManifest = z.infer<typeof codexPluginManifestSchema>;

const claudePluginManifestSchema = z
  .object({
    name: z.string().min(1).optional(),
    defaultEnabled: z.boolean().optional(),
    skills: claudePluginPathListSchema.optional(),
    commands: claudePluginPathListSchema.optional(),
  })
  .passthrough();
type ClaudePluginManifest = z.infer<typeof claudePluginManifestSchema>;

function resolveCodexHome(homeDir: string): string {
  return process.env.CODEX_HOME?.trim() || path.join(homeDir, ".codex");
}

function resolveClaudeDir(homeDir: string): string {
  return path.join(homeDir, CLAUDE_DIR_NAME);
}

function resolveStoredPath(homeDir: string, storedPath: string): string {
  if (storedPath === "~") {
    return homeDir;
  }
  if (storedPath.startsWith("~/")) {
    return path.join(homeDir, storedPath.slice(2));
  }
  return path.isAbsolute(storedPath)
    ? storedPath
    : path.resolve(homeDir, storedPath);
}

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

async function directoryHasClaudePluginManifest(
  directoryPath: string,
): Promise<boolean> {
  try {
    const stat = await fs.lstat(
      path.join(
        directoryPath,
        CLAUDE_PLUGIN_DIR_NAME,
        CLAUDE_PLUGIN_MANIFEST_FILE_NAME,
      ),
    );
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readClaudePluginManifest(
  pluginRootPath: string,
): Promise<ClaudePluginManifest | null> {
  return readJsonFile(
    path.join(
      pluginRootPath,
      CLAUDE_PLUGIN_DIR_NAME,
      CLAUDE_PLUGIN_MANIFEST_FILE_NAME,
    ),
    claudePluginManifestSchema,
  );
}

function normalizePluginPathList(
  value: string | readonly string[] | undefined,
): string[] {
  if (value === undefined) {
    return [];
  }
  return typeof value === "string" ? [value] : [...value];
}

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
  return readJsonFile(
    path.join(
      pluginRootPath,
      CODEX_PLUGIN_DIR_NAME,
      CODEX_PLUGIN_MANIFEST_FILE_NAME,
    ),
    codexPluginManifestSchema,
  );
}

function resolvePluginRelativePath(
  pluginRootPath: string,
  relativePath: string,
): string | null {
  if (path.isAbsolute(relativePath)) {
    return null;
  }
  const resolvedPath = path.resolve(pluginRootPath, relativePath);
  const relativeToPlugin = path.relative(pluginRootPath, resolvedPath);
  if (
    relativeToPlugin === "" ||
    (!relativeToPlugin.startsWith("..") && !path.isAbsolute(relativeToPlugin))
  ) {
    return resolvedPath;
  }
  return null;
}

function parseMarketplacePluginId(
  pluginId: string,
): ClaudePluginIdParts | null {
  const separatorIndex = pluginId.lastIndexOf("@");
  if (separatorIndex <= 0 || separatorIndex === pluginId.length - 1) {
    return null;
  }
  return {
    pluginName: pluginId.slice(0, separatorIndex),
    marketplaceName: pluginId.slice(separatorIndex + 1),
  };
}

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

function readCodexEnabledPluginSettingsFromToml(
  content: string,
): CodexSettingsPlugins {
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

  return { enabledPlugins };
}

async function readCodexEnabledPluginSettings(
  codexHome: string,
): Promise<CodexSettingsPlugins> {
  try {
    return readCodexEnabledPluginSettingsFromToml(
      await fs.readFile(path.join(codexHome, CODEX_CONFIG_FILE_NAME), "utf8"),
    );
  } catch {
    return { enabledPlugins: new Map<string, boolean>() };
  }
}

function originForClaudePluginScope(
  scope: ClaudePluginScope,
): ClaudePluginOrigin {
  return scope === "project" || scope === "local" ? "project" : "user";
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

function shouldIncludeInstalledClaudePlugin(
  args: ResolveClaudePluginRootsArgs,
  plugin: ClaudeInstalledPluginReference,
): boolean {
  if (plugin.scope === "managed" || plugin.scope === "user") {
    return true;
  }
  return (
    args.cwd !== null && isPathWithinDirectory(args.cwd, plugin.installPath)
  );
}

function readClaudeEnabledPluginSettings(
  settingsFiles: readonly string[],
): Promise<ClaudeSettingsPlugins> {
  return settingsFiles.reduce<Promise<ClaudeSettingsPlugins>>(
    async (previousPromise, settingsFile) => {
      const previous = await previousPromise;
      const settings = await readJsonFile(settingsFile, claudeSettingsSchema);
      if (!settings?.enabledPlugins) {
        return previous;
      }
      const enabledPlugins = new Map(previous.enabledPlugins);
      for (const [pluginId, enabled] of Object.entries(
        settings.enabledPlugins,
      )) {
        enabledPlugins.set(pluginId, enabled);
      }
      return { enabledPlugins };
    },
    Promise.resolve({ enabledPlugins: new Map<string, boolean>() }),
  );
}

function resolveClaudeSettingsFiles(
  args: ResolveClaudePluginRootsArgs,
): string[] {
  const files = [path.join(resolveClaudeDir(args.homeDir), "settings.json")];
  if (args.cwd !== null) {
    files.push(
      path.join(args.cwd, CLAUDE_DIR_NAME, "settings.json"),
      path.join(args.cwd, CLAUDE_DIR_NAME, "settings.local.json"),
    );
  }
  return files;
}

async function readClaudeInstalledPluginReferences(
  homeDir: string,
): Promise<ClaudeInstalledPluginReference[]> {
  const installedPlugins = await readJsonFile(
    path.join(
      resolveClaudeDir(homeDir),
      "plugins",
      CLAUDE_PLUGIN_INSTALLED_FILE_NAME,
    ),
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
        installPath: resolveStoredPath(homeDir, entry.installPath),
        scope: entry.scope,
        gitCommitSha: entry.gitCommitSha ?? null,
      });
    }
  }
  return references;
}

async function statPluginCacheCandidate(
  rootPath: string,
): Promise<PluginCacheCandidate | null> {
  if (!(await directoryHasClaudePluginManifest(rootPath))) {
    return null;
  }
  try {
    const stat = await fs.stat(rootPath);
    return {
      rootPath,
      modifiedAtMs: stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

async function statCodexPluginCacheCandidate(
  rootPath: string,
): Promise<PluginCacheCandidate | null> {
  if (!(await directoryHasCodexPluginManifest(rootPath))) {
    return null;
  }
  try {
    const stat = await fs.stat(rootPath);
    return {
      rootPath,
      modifiedAtMs: stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

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
    const candidatePath = path.join(pluginCacheRootPath, entry.name);
    const candidate = await statCodexPluginCacheCandidate(candidatePath);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return (
    candidates.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)[0]
      ?.rootPath ?? null
  );
}

async function findFallbackClaudePluginRoot(
  args: ResolveInstalledClaudePluginRootArgs,
): Promise<string | null> {
  const pluginId = parseMarketplacePluginId(args.plugin.id);
  if (!pluginId) {
    return null;
  }

  const pluginCacheRootPath = path.join(
    resolveClaudeDir(args.homeDir),
    "plugins",
    "cache",
    pluginId.marketplaceName,
    pluginId.pluginName,
  );

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
    const candidatePath = path.join(pluginCacheRootPath, entry.name);
    const candidate = await statPluginCacheCandidate(candidatePath);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  const commitPrefix = args.plugin.gitCommitSha?.slice(0, 12);
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

async function resolveInstalledClaudePluginRoot(
  args: ResolveInstalledClaudePluginRootArgs,
): Promise<string | null> {
  if (await directoryHasClaudePluginManifest(args.plugin.installPath)) {
    return args.plugin.installPath;
  }
  return findFallbackClaudePluginRoot(args);
}

function addRootOnce(
  roots: CommandScanRoot[],
  seenRoots: Set<string>,
  root: CommandScanRoot,
): void {
  const rootPath = "rootPath" in root ? root.rootPath : root.filePath;
  const key = [
    root.shape,
    root.origin,
    root.source,
    root.namePrefix,
    rootPath,
  ].join("\0");
  if (seenRoots.has(key)) {
    return;
  }
  seenRoots.add(key);
  roots.push(root);
}

async function resolvePluginComponentKind(
  args: ResolvePluginComponentKindArgs,
): Promise<PluginComponentKind> {
  try {
    const stat = await fs.lstat(args.componentPath);
    if (stat.isFile()) {
      return "file";
    }
    if (stat.isDirectory()) {
      return "directory";
    }
    if (!stat.isSymbolicLink() || !args.followUserSymlink) {
      return "missing";
    }
    const targetStat = await fs.stat(args.componentPath);
    if (targetStat.isFile()) {
      return "file";
    }
    return targetStat.isDirectory() ? "directory" : "missing";
  } catch {
    return "missing";
  }
}

async function resolvePluginSkillRootShape(
  args: ResolvePluginSkillRootShapeArgs,
): Promise<"skill" | "skill-directory"> {
  const skillFilePath = path.join(args.componentPath, "SKILL.md");
  const skillFileKind = await resolvePluginComponentKind({
    componentPath: skillFilePath,
    followUserSymlink: args.origin === "user",
  });
  return skillFileKind === "file" ? "skill-directory" : "skill";
}

async function addPluginSkillPathRoots(
  args: AddPluginPathRootsArgs,
): Promise<void> {
  for (const entry of args.entries) {
    const componentPath = resolvePluginRelativePath(args.pluginRootPath, entry);
    if (componentPath === null) {
      continue;
    }
    const componentKind = await resolvePluginComponentKind({
      componentPath,
      followUserSymlink: args.origin === "user",
    });
    if (
      componentKind === "file" &&
      path.basename(componentPath) === "SKILL.md"
    ) {
      addRootOnce(args.roots, args.seenRoots, {
        filePath: componentPath,
        fallbackName: path.basename(path.dirname(componentPath)),
        shape: "skill-file",
        namePrefix: args.namePrefix,
        source: "skill",
        origin: args.origin,
      });
      continue;
    }
    if (componentKind !== "directory") {
      continue;
    }
    addRootOnce(args.roots, args.seenRoots, {
      rootPath: componentPath,
      shape: await resolvePluginSkillRootShape({
        componentPath,
        origin: args.origin,
      }),
      namePrefix: args.namePrefix,
      source: "skill",
      origin: args.origin,
    });
  }
}

async function addPluginCommandPathRoots(
  args: AddPluginPathRootsArgs,
): Promise<void> {
  for (const entry of args.entries) {
    const componentPath = resolvePluginRelativePath(args.pluginRootPath, entry);
    if (componentPath === null) {
      continue;
    }
    try {
      const stat = await fs.lstat(componentPath);
      if (stat.isFile() && componentPath.endsWith(".md")) {
        addRootOnce(args.roots, args.seenRoots, {
          filePath: componentPath,
          shape: "command-file",
          namePrefix: args.namePrefix,
          source: "command",
          origin: args.origin,
        });
        continue;
      }
      if (stat.isDirectory()) {
        addRootOnce(args.roots, args.seenRoots, {
          rootPath: componentPath,
          shape: "command",
          namePrefix: args.namePrefix,
          source: "command",
          origin: args.origin,
        });
      }
    } catch {
      continue;
    }
  }
}

async function addDefaultPluginSkillRoots(
  args: AddPluginDirectoryRootsArgs,
): Promise<void> {
  const rootSkillFilePath = path.join(args.pluginRootPath, "SKILL.md");
  const rootSkillFileKind = await resolvePluginComponentKind({
    componentPath: rootSkillFilePath,
    followUserSymlink: args.origin === "user",
  });
  if (rootSkillFileKind === "file") {
    addRootOnce(args.roots, args.seenRoots, {
      filePath: rootSkillFilePath,
      fallbackName: args.rootSkillFallbackName,
      shape: "skill-file",
      namePrefix: args.namePrefix,
      source: "skill",
      origin: args.origin,
    });
  }

  const skillsRootPath = path.join(args.pluginRootPath, "skills");
  const skillsRootKind = await resolvePluginComponentKind({
    componentPath: skillsRootPath,
    followUserSymlink: args.origin === "user",
  });
  if (skillsRootKind === "directory") {
    addRootOnce(args.roots, args.seenRoots, {
      rootPath: skillsRootPath,
      shape: "skill",
      namePrefix: args.namePrefix,
      source: "skill",
      origin: args.origin,
    });
  }
}

async function addDefaultPluginDirectoryRoots(
  args: AddPluginDirectoryRootsArgs,
): Promise<void> {
  await addDefaultPluginSkillRoots(args);

  const commandsRootPath = path.join(args.pluginRootPath, "commands");
  const commandsRootStat = await fs.lstat(commandsRootPath).catch(() => null);
  if (commandsRootStat?.isDirectory()) {
    addRootOnce(args.roots, args.seenRoots, {
      rootPath: commandsRootPath,
      shape: "command",
      namePrefix: args.namePrefix,
      source: "command",
      origin: args.origin,
    });
  }
}

async function addCodexPluginComponentRoots(
  args: AddCodexPluginComponentRootsArgs,
): Promise<void> {
  const namePrefix = `${args.plugin.pluginName}:`;
  const baseArgs = {
    namePrefix,
    origin: "user" as const,
    pluginRootPath: args.plugin.rootPath,
    rootSkillFallbackName: args.plugin.pluginName,
    roots: args.roots,
    seenRoots: new Set<string>(),
  };

  await addDefaultPluginSkillRoots(baseArgs);
  await addPluginSkillPathRoots({
    ...baseArgs,
    entries: normalizePluginPathList(args.plugin.manifest.skills),
  });
}

async function addClaudePluginComponentRoots(
  args: AddClaudePluginComponentRootsArgs,
): Promise<void> {
  const namePrefix = `${args.plugin.pluginName}:`;
  const seenRoots = new Set<string>();
  const baseArgs = {
    namePrefix,
    origin: args.plugin.origin,
    pluginRootPath: args.plugin.rootPath,
    rootSkillFallbackName: args.plugin.pluginName,
    roots: args.roots,
    seenRoots,
  };

  await addDefaultPluginDirectoryRoots(baseArgs);
  await addPluginSkillPathRoots({
    ...baseArgs,
    entries: normalizePluginPathList(args.plugin.manifest.skills),
  });
  await addPluginCommandPathRoots({
    ...baseArgs,
    entries: normalizePluginPathList(args.plugin.manifest.commands),
  });
}

async function resolveCodexPluginCommandScanRoots(
  args: ResolveCodexPluginRootsArgs,
): Promise<CommandScanRoot[]> {
  const settings = await readCodexEnabledPluginSettings(args.codexHome);
  const pluginRoots: CodexPluginRoot[] = [];
  const cacheRootPath = path.join(args.codexHome, "plugins", "cache");

  let marketplaceEntries: Dirent[];
  try {
    marketplaceEntries = await fs.readdir(cacheRootPath, {
      withFileTypes: true,
    });
  } catch {
    marketplaceEntries = [];
  }

  for (const marketplaceEntry of marketplaceEntries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!marketplaceEntry.isDirectory()) {
      continue;
    }
    const marketplacePath = path.join(cacheRootPath, marketplaceEntry.name);
    let pluginEntries: Dirent[];
    try {
      pluginEntries = await fs.readdir(marketplacePath, {
        withFileTypes: true,
      });
    } catch {
      continue;
    }

    for (const pluginEntry of pluginEntries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (!pluginEntry.isDirectory()) {
        continue;
      }
      const pluginId = `${pluginEntry.name}@${marketplaceEntry.name}`;
      if (settings.enabledPlugins.get(pluginId) === false) {
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
      pluginRoots.push({
        manifest,
        pluginName: manifest.name ?? pluginEntry.name,
        rootPath,
      });
    }
  }

  const roots: CommandScanRoot[] = [];
  for (const plugin of pluginRoots) {
    await addCodexPluginComponentRoots({ plugin, roots });
  }
  return roots;
}

function isPluginEnabled(
  settings: ClaudeSettingsPlugins,
  pluginId: string,
  manifest: ClaudePluginManifest,
): boolean {
  return (
    settings.enabledPlugins.get(pluginId) ?? manifest.defaultEnabled ?? true
  );
}

async function resolveInstalledClaudePluginRoots(
  args: ResolveClaudePluginRootsArgs,
  settings: ClaudeSettingsPlugins,
): Promise<ClaudePluginRoot[]> {
  const installedPlugins = await readClaudeInstalledPluginReferences(
    args.homeDir,
  );
  const pluginRoots: ClaudePluginRoot[] = [];
  for (const plugin of installedPlugins) {
    if (!shouldIncludeInstalledClaudePlugin(args, plugin)) {
      continue;
    }
    const rootPath = await resolveInstalledClaudePluginRoot({
      homeDir: args.homeDir,
      plugin,
    });
    if (rootPath === null) {
      continue;
    }
    const manifest = await readClaudePluginManifest(rootPath);
    if (!manifest || !isPluginEnabled(settings, plugin.id, manifest)) {
      continue;
    }
    const pluginId = parseMarketplacePluginId(plugin.id);
    pluginRoots.push({
      manifest,
      origin: originForClaudePluginScope(plugin.scope),
      pluginName:
        manifest.name ?? pluginId?.pluginName ?? path.basename(rootPath),
      rootPath,
    });
  }
  return pluginRoots;
}

async function isSkillDirectoryPluginEntry(
  entry: Dirent,
  entryPath: string,
  origin: "project" | "user",
): Promise<boolean> {
  if (entry.isDirectory()) {
    return directoryHasClaudePluginManifest(entryPath);
  }
  if (!entry.isSymbolicLink() || origin !== "user") {
    return false;
  }
  try {
    const stat = await fs.stat(entryPath);
    return stat.isDirectory() && directoryHasClaudePluginManifest(entryPath);
  } catch {
    return false;
  }
}

async function resolveSkillsDirectoryClaudePluginRoots(
  skillsRootPath: string,
  origin: "project" | "user",
  settings: ClaudeSettingsPlugins,
): Promise<ClaudePluginRoot[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(skillsRootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const pluginRoots: ClaudePluginRoot[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const pluginRootPath = path.join(skillsRootPath, entry.name);
    if (!(await isSkillDirectoryPluginEntry(entry, pluginRootPath, origin))) {
      continue;
    }
    const manifest = await readClaudePluginManifest(pluginRootPath);
    if (!manifest) {
      continue;
    }
    const pluginName = manifest.name ?? entry.name;
    const pluginId = `${pluginName}@skills-dir`;
    if (!isPluginEnabled(settings, pluginId, manifest)) {
      continue;
    }
    pluginRoots.push({
      manifest,
      origin,
      pluginName,
      rootPath: pluginRootPath,
    });
  }
  return pluginRoots;
}

async function resolveClaudePluginCommandScanRoots(
  args: ResolveClaudePluginRootsArgs,
): Promise<CommandScanRoot[]> {
  const settings = await readClaudeEnabledPluginSettings(
    resolveClaudeSettingsFiles(args),
  );
  const pluginRoots = await resolveInstalledClaudePluginRoots(args, settings);

  if (args.cwd !== null) {
    pluginRoots.push(
      ...(await resolveSkillsDirectoryClaudePluginRoots(
        path.join(args.cwd, CLAUDE_DIR_NAME, "skills"),
        "project",
        settings,
      )),
    );
  }
  pluginRoots.push(
    ...(await resolveSkillsDirectoryClaudePluginRoots(
      path.join(resolveClaudeDir(args.homeDir), "skills"),
      "user",
      settings,
    )),
  );

  const roots: CommandScanRoot[] = [];
  for (const plugin of pluginRoots) {
    await addClaudePluginComponentRoots({ plugin, roots });
  }
  return roots;
}

export async function resolveProviderCommandScanRoots(
  resolution: CommandRootResolution,
): Promise<CommandScanRoot[]> {
  const roots = resolveCommandScanRoots(resolution);
  if (resolution.providerId === "codex") {
    roots.push(
      ...(await resolveCodexPluginCommandScanRoots({
        codexHome: resolution.codexHome,
      })),
    );
    return roots;
  }
  if (resolution.providerId !== "claude-code") {
    return roots;
  }
  roots.push(
    ...(await resolveClaudePluginCommandScanRoots({
      cwd: resolution.cwd,
      homeDir: resolution.homeDir,
    })),
  );
  return roots;
}

/**
 * Build the ordered set of roots to scan for a provider. Project (cwd-dependent)
 * roots are skipped when `cwd` is null; user-home roots are always included.
 * Providers without a command surface (e.g. `pi`) yield an empty root set.
 */
export function resolveCommandScanRoots(
  resolution: CommandRootResolution,
): CommandScanRoot[] {
  const roots: CommandScanRoot[] = [];

  if (resolution.providerId === "claude-code") {
    if (resolution.cwd !== null) {
      roots.push({
        rootPath: path.join(resolution.cwd, ".bb", "skills"),
        shape: "skill",
        namePrefix: "",
        source: "skill",
        origin: "project",
      });
      roots.push({
        rootPath: path.join(resolution.cwd, ".claude", "skills"),
        shape: "skill",
        namePrefix: "",
        source: "skill",
        origin: "project",
      });
    }
    roots.push({
      rootPath: path.join(resolution.homeDir, ".claude", "skills"),
      shape: "skill",
      namePrefix: "",
      source: "skill",
      origin: "user",
    });
    roots.push({
      rootPath: resolveDataDirSkillsRootPath(resolution.dataDir),
      shape: "skill",
      namePrefix: "",
      source: "skill",
      origin: "user",
    });
    for (const rootPath of resolution.additionalSkillsRootPaths) {
      roots.push({
        rootPath,
        shape: "skill",
        namePrefix: "",
        source: "skill",
        origin: "user",
      });
    }
    roots.push({
      rootPath: resolution.builtinSkillsRootPath,
      shape: "skill",
      namePrefix: "",
      source: "skill",
      origin: "user",
    });
    if (resolution.cwd !== null) {
      roots.push({
        rootPath: path.join(resolution.cwd, ".claude", "commands"),
        shape: "command",
        namePrefix: "",
        source: "command",
        origin: "project",
      });
    }
    roots.push({
      rootPath: path.join(resolution.homeDir, ".claude", "commands"),
      shape: "command",
      namePrefix: "",
      source: "command",
      origin: "user",
    });
    return roots;
  }

  if (resolution.providerId === "codex") {
    if (resolution.cwd !== null) {
      roots.push({
        rootPath: path.join(resolution.cwd, ".bb", "skills"),
        shape: "skill",
        namePrefix: "",
        source: "skill",
        origin: "project",
      });
      roots.push({
        rootPath: path.join(resolution.cwd, ".codex", "skills"),
        shape: "skill",
        namePrefix: "",
        source: "skill",
        origin: "project",
      });
    }
    roots.push({
      rootPath: path.join(resolution.codexHome, "skills"),
      shape: "skill",
      namePrefix: "",
      source: "skill",
      origin: "user",
    });
    roots.push({
      rootPath: resolveDataDirSkillsRootPath(resolution.dataDir),
      shape: "skill",
      namePrefix: "",
      source: "skill",
      origin: "user",
    });
    for (const rootPath of resolution.additionalSkillsRootPaths) {
      roots.push({
        rootPath,
        shape: "skill",
        namePrefix: "",
        source: "skill",
        origin: "user",
      });
    }
    roots.push({
      rootPath: resolution.builtinSkillsRootPath,
      shape: "skill",
      namePrefix: "",
      source: "skill",
      origin: "user",
    });
    roots.push({
      rootPath: path.join(resolution.codexHome, "skills", ".system"),
      shape: "skill",
      namePrefix: "",
      source: "skill",
      origin: "user",
    });
    return roots;
  }

  return roots;
}

export async function listHostCommands(
  command: CommandOf<"host.list_commands">,
  options: { dataDir: string },
): Promise<HostDaemonOnlineRpcResult<"host.list_commands">> {
  if (command.cwd !== null && !path.isAbsolute(command.cwd)) {
    throw new CommandDispatchError("invalid_path", "cwd must be absolute");
  }
  if (!path.isAbsolute(command.builtinSkillsRootPath)) {
    throw new CommandDispatchError(
      "invalid_path",
      "builtinSkillsRootPath must be absolute",
    );
  }
  const homeDir = os.homedir();
  const roots = await resolveProviderCommandScanRoots({
    cwd: command.cwd,
    builtinSkillsRootPath: command.builtinSkillsRootPath,
    additionalSkillsRootPaths: command.additionalSkillsRootPaths ?? [],
    dataDir: options.dataDir,
    homeDir,
    codexHome: resolveCodexHome(homeDir),
    providerId: command.providerId,
  });
  const commands = await discoverProviderCommands({ roots });
  return { commands };
}
