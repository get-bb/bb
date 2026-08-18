import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveCodexHome } from "@bb/config/codex-home";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import type { ProviderNativeSkillRoots } from "@bb/domain";
import {
  DefaultPackageManager,
  ProjectTrustStore,
  SettingsManager,
  hasTrustRequiringProjectResources,
} from "@earendil-works/pi-coding-agent";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
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
  /** Claude user-home base (`os.homedir()`). */
  homeDir: string;
  /** Codex user-home base (`$CODEX_HOME` or `~/.codex`). */
  codexHome: string;
  providerId: string;
  nativeSkillRoots?: ProviderNativeSkillRoots;
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
  boundaryPath?: string;
  namePrefix: string;
  origin: ClaudePluginOrigin;
  pluginRootPath: string;
  recursiveSkills?: boolean;
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
const AGENTS_DIR_NAME = ".agents";
const CLAUDE_DIR_NAME = ".claude";
const CURSOR_DIR_NAME = ".cursor";
const GROK_DIR_NAME = ".grok";
const HERMES_DIR_NAME = ".hermes";
const OMP_DIR_NAME = ".omp";
const OPENCODE_DIR_NAME = ".opencode";
const PI_DIR_NAME = ".pi";
const CLAUDE_PLUGIN_DIR_NAME = ".claude-plugin";
const CLAUDE_PLUGIN_MANIFEST_FILE_NAME = "plugin.json";
const CLAUDE_PLUGIN_INSTALLED_FILE_NAME = "installed_plugins.json";
const OMP_PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

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

const ompSkillConfigSchema = z
  .object({
    skills: z
      .object({ customDirectories: z.array(z.string()).optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

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

const hermesSkillConfigSchema = z
  .object({
    skills: z
      .object({
        external_dirs: z.union([z.string(), z.array(z.string())]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

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

function resolveClaudeDir(homeDir: string): string {
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  return configured
    ? resolveStoredPath(homeDir, configured)
    : path.join(homeDir, CLAUDE_DIR_NAME);
}

function resolveOpenCodeConfigDir(homeDir: string): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  return xdgConfigHome
    ? path.join(resolveStoredPath(homeDir, xdgConfigHome), "opencode")
    : path.join(homeDir, ".config", "opencode");
}

function resolveGrokDir(homeDir: string): string {
  const configured = process.env.GROK_HOME?.trim();
  return configured
    ? resolveStoredPath(homeDir, configured)
    : path.join(homeDir, GROK_DIR_NAME);
}

function resolveHermesDir(homeDir: string): string {
  const configured = process.env.HERMES_HOME?.trim();
  return configured
    ? resolveStoredPath(homeDir, configured)
    : path.join(homeDir, HERMES_DIR_NAME);
}

function resolvePiAgentDir(homeDir: string): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  return configured
    ? resolveStoredPath(homeDir, configured)
    : path.join(homeDir, PI_DIR_NAME, "agent");
}

/**
 * Pi settings with the same saved and default project-trust policy the Pi
 * bridge applies. Stated here rather than imported from the bridge: this
 * command scan is daemon-local work, and the daemon must not reach into a
 * provider bridge's sources.
 *
 * Pi has no trust prompt here either, and Pi treats an unresolved `ask`
 * decision as untrusted in every non-interactive mode, so an unsaved project
 * is trusted only when the default is `always`.
 */
function createConfiguredPiSettingsManager(
  rawCwd: string,
  rawAgentDir: string,
): SettingsManager {
  const cwd = path.resolve(rawCwd);
  const agentDir = path.resolve(rawAgentDir);
  const settingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted: false,
  });
  settingsManager.setProjectTrusted(
    !hasTrustRequiringProjectResources(cwd)
      ? true
      : (new ProjectTrustStore(agentDir).get(cwd) ??
          settingsManager.getDefaultProjectTrust() === "always"),
  );
  return settingsManager;
}

function resolveOmpAgentDir(homeDir: string): string {
  const profile =
    process.env.OMP_PROFILE !== undefined
      ? process.env.OMP_PROFILE.trim()
      : process.env.PI_PROFILE?.trim();
  if (
    profile &&
    profile !== "default" &&
    OMP_PROFILE_NAME_PATTERN.test(profile)
  ) {
    return path.join(homeDir, OMP_DIR_NAME, "profiles", profile, "agent");
  }
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  return configured
    ? resolveStoredPath(homeDir, configured)
    : path.join(homeDir, OMP_DIR_NAME, "agent");
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

async function readParsedFile<T>(
  filePath: string,
  parse: (content: string) => unknown,
  schema: z.ZodType<T>,
): Promise<T | null> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }

  let value: unknown;
  try {
    value = parse(content);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(value);
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
      shape: args.recursiveSkills
        ? "skill-recursive"
        : await resolvePluginSkillRootShape({
            componentPath,
            origin: args.origin,
          }),
      namePrefix: args.namePrefix,
      source: "skill",
      origin: args.origin,
      ...(args.boundaryPath === undefined
        ? {}
        : { boundaryPath: args.boundaryPath }),
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

function expandConfiguredPath(homeDir: string, value: string): string {
  const expandedEnvironment = value.replace(
    /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
    (match, bracedName: string | undefined, plainName: string | undefined) =>
      process.env[bracedName ?? plainName ?? ""] ?? match,
  );
  if (expandedEnvironment === "~") {
    return homeDir;
  }
  if (expandedEnvironment.startsWith("~/")) {
    return path.join(homeDir, expandedEnvironment.slice(2));
  }
  return expandedEnvironment;
}

function resolveConfiguredPath(args: {
  basePath: string;
  homeDir: string;
  value: string;
}): string {
  const expanded = expandConfiguredPath(args.homeDir, args.value.trim());
  return path.isAbsolute(expanded)
    ? expanded
    : path.resolve(args.basePath, expanded);
}

function configuredSkillPathRoot(args: {
  boundaryPath?: string;
  identity: string;
  origin: "project" | "user";
  providerId: string;
  skillPath: string;
  recursive: boolean;
}): CommandScanRoot {
  if (path.basename(args.skillPath) === "SKILL.md") {
    return {
      fallbackName: path.basename(path.dirname(args.skillPath)),
      filePath: args.skillPath,
      namePrefix: "",
      origin: args.origin,
      shape: "skill-file",
      skillIdentitySeed: `${args.providerId}:provider-${args.origin}:${args.identity}`,
      source: "skill",
    };
  }
  return skillScanRoot({
    ...(args.boundaryPath === undefined
      ? {}
      : { boundaryPath: args.boundaryPath }),
    identity: args.identity,
    origin: args.origin,
    providerId: args.providerId,
    recursive: args.recursive,
    rootPath: args.skillPath,
  });
}

async function resolvePiConfiguredSkillScanRoots(
  resolution: CommandRootResolution,
): Promise<CommandScanRoot[]> {
  const cwd = resolution.cwd ?? resolution.homeDir;
  try {
    const agentDir = resolvePiAgentDir(resolution.homeDir);
    const settingsManager = createConfiguredPiSettingsManager(cwd, agentDir);
    const packageManager = new DefaultPackageManager({
      agentDir,
      cwd,
      settingsManager,
    });
    const resolved = await packageManager.resolve(async () => "skip");
    return resolved.skills
      .filter((skill) => skill.enabled && skill.metadata.source !== "auto")
      .map((skill) => {
        const origin = skill.metadata.scope === "user" ? "user" : "project";
        return configuredSkillPathRoot({
          identity: `pi-config:${skill.metadata.source}:${skill.path}`,
          origin,
          providerId: resolution.providerId,
          recursive: false,
          skillPath: skill.path,
        });
      });
  } catch {
    return [];
  }
}

async function resolveOmpConfiguredSkillScanRoots(
  resolution: CommandRootResolution,
): Promise<CommandScanRoot[]> {
  const cwd = resolution.cwd ?? resolution.homeDir;
  const agentDir = resolveOmpAgentDir(resolution.homeDir);
  const userConfigPaths = [
    path.join(agentDir, "config.yml"),
    path.join(agentDir, "config.yaml"),
  ];
  const configPaths = [
    ...(resolution.cwd === null
      ? []
      : [path.join(resolution.cwd, OMP_DIR_NAME, "config.yml")]),
    ...(
      process.env.PI_CONFIG_FILES?.split(path.delimiter).filter(Boolean) ?? []
    ).map((filePath) =>
      resolveConfiguredPath({
        basePath: cwd,
        homeDir: resolution.homeDir,
        value: filePath,
      }),
    ),
  ];
  const projectRootPath =
    resolution.cwd === null
      ? null
      : (await resolveProjectAncestorDirectories(resolution.cwd))
          .projectRootPath;
  let customDirectories: string[] = [];
  let customOrigin: "project" | "user" = "user";
  for (const configPath of userConfigPaths) {
    const config = await readParsedFile(
      configPath,
      parseYaml,
      ompSkillConfigSchema,
    );
    if (config !== null) {
      customDirectories = config.skills?.customDirectories ?? [];
      break;
    }
  }
  for (const configPath of configPaths) {
    const config = await readParsedFile(
      configPath,
      parseYaml,
      ompSkillConfigSchema,
    );
    if (config?.skills?.customDirectories !== undefined) {
      customDirectories = config.skills.customDirectories;
      customOrigin =
        projectRootPath !== null &&
        isPathWithinDirectory(projectRootPath, configPath)
          ? "project"
          : "user";
    }
  }
  return customDirectories.map((configuredPath, index) =>
    configuredSkillPathRoot({
      identity: `omp-custom:${index}:${configuredPath}`,
      origin: customOrigin,
      providerId: resolution.providerId,
      recursive: false,
      skillPath: resolveConfiguredPath({
        basePath: cwd,
        homeDir: resolution.homeDir,
        value: configuredPath,
      }),
    }),
  );
}

function grokCompatEnabled(
  configured: boolean | undefined,
  environmentName: "GROK_CLAUDE_SKILLS_ENABLED" | "GROK_CURSOR_SKILLS_ENABLED",
): boolean {
  const environmentValue = process.env[environmentName]?.trim().toLowerCase();
  if (environmentValue === "true" || environmentValue === "1") {
    return true;
  }
  if (environmentValue === "false" || environmentValue === "0") {
    return false;
  }
  return configured ?? true;
}

async function readGrokSkillConfig(
  homeDir: string,
): Promise<z.infer<typeof grokSkillConfigSchema> | null> {
  return readParsedFile(
    path.join(resolveGrokDir(homeDir), "config.toml"),
    parseToml,
    grokSkillConfigSchema,
  );
}

async function resolveGrokConfiguredSkillScanRoots(
  resolution: CommandRootResolution,
  config: z.infer<typeof grokSkillConfigSchema> | null,
): Promise<CommandScanRoot[]> {
  const cwd = resolution.cwd ?? resolution.homeDir;
  const projectRootPath =
    resolution.cwd === null
      ? null
      : (await resolveProjectAncestorDirectories(resolution.cwd))
          .projectRootPath;
  return (config?.skills?.paths ?? []).map((configuredPath, index) => {
    const skillPath = resolveConfiguredPath({
      basePath: cwd,
      homeDir: resolution.homeDir,
      value: configuredPath,
    });
    const projectRelativePath =
      projectRootPath === null
        ? null
        : path.relative(projectRootPath, skillPath);
    const origin =
      projectRootPath !== null &&
      projectRelativePath !== ".." &&
      !projectRelativePath?.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(projectRelativePath ?? "")
        ? "project"
        : "user";
    return configuredSkillPathRoot({
      ...(origin === "project" && projectRootPath !== null
        ? { boundaryPath: projectRootPath }
        : {}),
      identity: `grok-config:${index}:${configuredPath}`,
      origin,
      providerId: resolution.providerId,
      recursive: true,
      skillPath,
    });
  });
}

async function readGrokPluginManifest(
  pluginRootPath: string,
): Promise<ClaudePluginManifest | null> {
  for (const relativePath of [
    "plugin.json",
    path.join(".grok-plugin", "plugin.json"),
    path.join(CLAUDE_PLUGIN_DIR_NAME, CLAUDE_PLUGIN_MANIFEST_FILE_NAME),
  ]) {
    const manifest = await readJsonFile(
      path.join(pluginRootPath, relativePath),
      claudePluginManifestSchema,
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

async function childDirectoryPaths(directoryPath: string): Promise<string[]> {
  try {
    return (await fs.readdir(directoryPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directoryPath, entry.name));
  } catch {
    return [];
  }
}

async function addGrokPluginSkillRoots(args: {
  autoEnabled: boolean;
  boundaryPath?: string;
  config: z.infer<typeof grokSkillConfigSchema> | null;
  origin: "project" | "user";
  pluginRootPath: string;
  roots: CommandScanRoot[];
}): Promise<void> {
  const manifest = await readGrokPluginManifest(args.pluginRootPath);
  const pluginName = manifest?.name ?? path.basename(args.pluginRootPath);
  const enabled = args.config?.plugins?.enabled ?? [];
  const disabled = args.config?.plugins?.disabled ?? [];
  if (
    grokPluginListMatches(disabled, pluginName) ||
    (!args.autoEnabled && !grokPluginListMatches(enabled, pluginName))
  ) {
    return;
  }

  const entries =
    manifest?.skills === undefined
      ? ["skills"]
      : normalizePluginPathList(manifest.skills);
  await addPluginSkillPathRoots({
    ...(args.boundaryPath === undefined
      ? {}
      : { boundaryPath: args.boundaryPath }),
    entries,
    namePrefix: `${pluginName}:`,
    origin: args.origin,
    pluginRootPath: args.pluginRootPath,
    recursiveSkills: true,
    rootSkillFallbackName: pluginName,
    roots: args.roots,
    seenRoots: new Set(),
  });
}

async function resolveGrokPluginSkillScanRoots(
  resolution: CommandRootResolution,
  config: z.infer<typeof grokSkillConfigSchema> | null,
): Promise<CommandScanRoot[]> {
  const roots: CommandScanRoot[] = [];
  const candidates: Array<{
    autoEnabled: boolean;
    boundaryPath?: string;
    origin: "project" | "user";
    pluginRootPath: string;
  }> = [];
  if (resolution.cwd !== null) {
    const { directories, projectRootPath } =
      await resolveProjectAncestorDirectories(resolution.cwd);
    for (const directoryPath of directories) {
      for (const pluginDirectoryName of [GROK_DIR_NAME, CLAUDE_DIR_NAME]) {
        for (const pluginRootPath of await childDirectoryPaths(
          path.join(directoryPath, pluginDirectoryName, "plugins"),
        )) {
          candidates.push({
            autoEnabled: false,
            boundaryPath: projectRootPath,
            origin: "project",
            pluginRootPath,
          });
        }
      }
    }
  }
  for (const pluginsPath of [
    path.join(resolveGrokDir(resolution.homeDir), "plugins"),
    path.join(resolution.homeDir, CLAUDE_DIR_NAME, "plugins"),
  ]) {
    for (const pluginRootPath of await childDirectoryPaths(pluginsPath)) {
      candidates.push({
        autoEnabled: false,
        origin: "user",
        pluginRootPath,
      });
    }
  }

  const cwd = resolution.cwd ?? resolution.homeDir;
  for (const configuredPath of config?.plugins?.paths ?? []) {
    candidates.push({
      autoEnabled: true,
      origin: "user",
      pluginRootPath: resolveConfiguredPath({
        basePath: cwd,
        homeDir: resolution.homeDir,
        value: configuredPath,
      }),
    });
  }

  const configuredInstallDirectory = config?.plugins?.install_dir;
  const installDirectory = configuredInstallDirectory
    ? resolveConfiguredPath({
        basePath: cwd,
        homeDir: resolution.homeDir,
        value: configuredInstallDirectory,
      })
    : path.join(resolveGrokDir(resolution.homeDir), "installed-plugins");
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

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = path.resolve(candidate.pluginRootPath);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    await addGrokPluginSkillRoots({ ...candidate, config, roots });
  }
  return roots;
}

async function resolveHermesConfiguredSkillScanRoots(
  resolution: CommandRootResolution,
): Promise<CommandScanRoot[]> {
  const hermesDir = resolveHermesDir(resolution.homeDir);
  const config = await readParsedFile(
    path.join(hermesDir, "config.yaml"),
    parseYaml,
    hermesSkillConfigSchema,
  );
  const configured = config?.skills?.external_dirs;
  const externalDirectories =
    typeof configured === "string" ? [configured] : (configured ?? []);
  return externalDirectories.map((configuredPath, index) =>
    configuredSkillPathRoot({
      identity: `hermes-external:${index}:${configuredPath}`,
      origin: "user",
      providerId: resolution.providerId,
      recursive: true,
      skillPath: resolveConfiguredPath({
        basePath: hermesDir,
        homeDir: resolution.homeDir,
        value: configuredPath,
      }),
    }),
  );
}

function rootPathForDeduplication(root: CommandScanRoot): string {
  return "rootPath" in root ? root.rootPath : root.filePath;
}

function appendUniqueRoots(
  target: CommandScanRoot[],
  candidates: readonly CommandScanRoot[],
): void {
  const seen = new Set(target.map(rootPathForDeduplication));
  for (const candidate of candidates) {
    const candidatePath = rootPathForDeduplication(candidate);
    if (seen.has(candidatePath)) {
      continue;
    }
    seen.add(candidatePath);
    target.push(candidate);
  }
}

function resolveConfiguredSkillScanRoots(
  resolution: CommandRootResolution,
): CommandScanRoot[] {
  const configured = resolution.nativeSkillRoots;
  if (configured === undefined) {
    return [];
  }
  const project =
    resolution.cwd === null
      ? []
      : configured.project.map((relativePath) =>
          skillScanRoot({
            identity: relativePath,
            origin: "project",
            providerId: resolution.providerId,
            rootPath: path.resolve(resolution.cwd ?? "", relativePath),
          }),
        );
  const user = configured.user.map((relativePath) =>
    skillScanRoot({
      identity: relativePath,
      origin: "user",
      providerId: resolution.providerId,
      rootPath: path.resolve(resolution.homeDir, relativePath),
    }),
  );
  return [...project, ...user];
}

async function hasProjectRootMarker(directoryPath: string): Promise<boolean> {
  try {
    await fs.lstat(path.join(directoryPath, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the repository ancestor chain used by native provider skill discovery.
 * The nearest ancestor with a `.git` entry is the repository root. Without a
 * marker, only the cwd is used. Results run from the repository root to cwd.
 */
async function resolveProjectAncestorDirectories(cwd: string): Promise<{
  directories: string[];
  projectRootPath: string;
}> {
  const directories: string[] = [];
  let directoryPath = cwd;
  while (true) {
    directories.push(directoryPath);
    if (await hasProjectRootMarker(directoryPath)) {
      break;
    }
    const parentPath = path.dirname(directoryPath);
    if (parentPath === directoryPath) {
      directories.splice(1);
      break;
    }
    directoryPath = parentPath;
  }

  const projectRootPath = directories.at(-1) ?? cwd;
  return { directories: directories.reverse(), projectRootPath };
}

function skillScanRoot(args: {
  boundaryPath?: string;
  identity: string | null;
  origin: "project" | "user";
  providerId: string;
  recursive?: boolean;
  rootPath: string;
}): CommandScanRoot {
  return {
    ...(args.boundaryPath === undefined
      ? {}
      : { boundaryPath: args.boundaryPath }),
    rootPath: args.rootPath,
    shape: args.recursive ? "skill-recursive" : "skill",
    namePrefix: "",
    source: "skill",
    origin: args.origin,
    ...(args.identity === null
      ? {}
      : {
          skillIdentitySeed: `${args.providerId}:provider-${args.origin}:${args.identity}`,
        }),
  };
}

type UserSkillLocation = readonly [identity: string | null, rootPath: string];

interface ProviderSkillSpec {
  parentDirectories?: readonly string[];
  projectDirectories?: readonly string[];
  recursive?: boolean;
  unseededProject?: boolean;
  userLocations: (resolution: CommandRootResolution) => UserSkillLocation[];
  walkParents?: boolean;
}

const skillsPath = (directoryName: string): string =>
  path.join(directoryName, "skills");

function homeSkillLocations(
  homeDir: string,
  directoryNames: readonly string[],
): UserSkillLocation[] {
  return directoryNames.map((directoryName) => [
    directoryName,
    path.join(homeDir, skillsPath(directoryName)),
  ]);
}

const CURSOR_SKILL_DIRS = [
  CURSOR_DIR_NAME,
  AGENTS_DIR_NAME,
  CLAUDE_DIR_NAME,
  ".codex",
];
const OPENCODE_SKILL_DIRS = [
  OPENCODE_DIR_NAME,
  CLAUDE_DIR_NAME,
  AGENTS_DIR_NAME,
];
const OMP_SKILL_DIRS = [
  OMP_DIR_NAME,
  PI_DIR_NAME,
  ".agent",
  AGENTS_DIR_NAME,
  CLAUDE_DIR_NAME,
  ".codex",
  OPENCODE_DIR_NAME,
];
const GROK_SKILL_DIRS = [
  GROK_DIR_NAME,
  AGENTS_DIR_NAME,
  CLAUDE_DIR_NAME,
  CURSOR_DIR_NAME,
];

const PROVIDER_SKILL_SPECS: Readonly<Record<string, ProviderSkillSpec>> = {
  "claude-code": {
    projectDirectories: [skillsPath(CLAUDE_DIR_NAME)],
    unseededProject: true,
    walkParents: true,
    userLocations: (resolution) => {
      const claudeDir = resolveClaudeDir(resolution.homeDir);
      const isDefault =
        claudeDir === path.join(resolution.homeDir, CLAUDE_DIR_NAME);
      return [
        [isDefault ? null : "config-dir", path.join(claudeDir, "skills")],
      ];
    },
  },
  codex: {
    parentDirectories: [skillsPath(AGENTS_DIR_NAME)],
    projectDirectories: [skillsPath(".codex")],
    unseededProject: true,
    userLocations: (resolution) => [
      [null, path.join(resolution.codexHome, "skills")],
      [null, path.join(resolution.codexHome, "skills", ".system")],
      ["agents", path.join(resolution.homeDir, AGENTS_DIR_NAME, "skills")],
    ],
  },
  "acp-cursor": {
    projectDirectories: CURSOR_SKILL_DIRS.map(skillsPath),
    recursive: true,
    userLocations: (resolution) =>
      homeSkillLocations(resolution.homeDir, CURSOR_SKILL_DIRS),
  },
  pi: {
    projectDirectories: [PI_DIR_NAME, AGENTS_DIR_NAME].map(skillsPath),
    userLocations: (resolution) => [
      [PI_DIR_NAME, path.join(resolvePiAgentDir(resolution.homeDir), "skills")],
      [
        AGENTS_DIR_NAME,
        path.join(resolution.homeDir, AGENTS_DIR_NAME, "skills"),
      ],
    ],
    walkParents: true,
  },
  "acp-opencode": {
    projectDirectories: OPENCODE_SKILL_DIRS.map(skillsPath),
    userLocations: (resolution) => {
      const customDir = process.env.OPENCODE_CONFIG_DIR?.trim();
      return [
        [
          "opencode",
          path.join(resolveOpenCodeConfigDir(resolution.homeDir), "skills"),
        ],
        [
          CLAUDE_DIR_NAME,
          path.join(resolution.homeDir, CLAUDE_DIR_NAME, "skills"),
        ],
        [
          AGENTS_DIR_NAME,
          path.join(resolution.homeDir, AGENTS_DIR_NAME, "skills"),
        ],
        ...(customDir
          ? [
              [
                "custom-config",
                path.join(
                  resolveStoredPath(resolution.homeDir, customDir),
                  "skills",
                ),
              ] as const,
            ]
          : []),
      ];
    },
    walkParents: true,
  },
  "acp-omp": {
    projectDirectories: OMP_SKILL_DIRS.map(skillsPath),
    userLocations: (resolution) => {
      const agentDir = resolveOmpAgentDir(resolution.homeDir);
      return [
        ["omp", path.join(agentDir, "skills")],
        ["omp-managed", path.join(agentDir, "managed-skills")],
        ["pi", path.join(resolvePiAgentDir(resolution.homeDir), "skills")],
        ...homeSkillLocations(resolution.homeDir, [
          ".agent",
          AGENTS_DIR_NAME,
          CLAUDE_DIR_NAME,
        ]),
        ["codex", path.join(resolution.codexHome, "skills")],
        [
          "opencode",
          path.join(resolveOpenCodeConfigDir(resolution.homeDir), "skills"),
        ],
      ];
    },
    walkParents: true,
  },
  "acp-grok": {
    projectDirectories: GROK_SKILL_DIRS.map(skillsPath),
    recursive: true,
    userLocations: (resolution) => [
      [GROK_DIR_NAME, path.join(resolveGrokDir(resolution.homeDir), "skills")],
      ...homeSkillLocations(resolution.homeDir, [
        AGENTS_DIR_NAME,
        CLAUDE_DIR_NAME,
        CURSOR_DIR_NAME,
      ]),
    ],
    walkParents: true,
  },
  "acp-hermes-agent": {
    recursive: true,
    userLocations: (resolution) => [
      [
        HERMES_DIR_NAME,
        path.join(resolveHermesDir(resolution.homeDir), "skills"),
      ],
    ],
  },
};

function resolveNativeSkillScanRoots(
  resolution: CommandRootResolution,
): CommandScanRoot[] {
  const spec = PROVIDER_SKILL_SPECS[resolution.providerId];
  if (spec === undefined) {
    return [];
  }
  const roots = spec.userLocations(resolution).map(([identity, rootPath]) =>
    skillScanRoot({
      identity,
      origin: "user",
      providerId: resolution.providerId,
      recursive: spec.recursive,
      rootPath,
    }),
  );
  if (resolution.cwd !== null) {
    const cwd = resolution.cwd;
    roots.unshift(
      ...(spec.projectDirectories ?? []).map((relativePath) =>
        skillScanRoot({
          boundaryPath: cwd,
          identity: spec.unseededProject ? null : path.dirname(relativePath),
          origin: "project",
          providerId: resolution.providerId,
          recursive: spec.recursive,
          rootPath: path.join(cwd, relativePath),
        }),
      ),
    );
  }
  const unique: CommandScanRoot[] = [];
  appendUniqueRoots(unique, roots);
  return unique;
}

async function resolveParentSkillScanRoots(
  resolution: CommandRootResolution,
  disabledDirectories: ReadonlySet<string>,
): Promise<CommandScanRoot[]> {
  const spec = PROVIDER_SKILL_SPECS[resolution.providerId];
  const parentDirectories =
    spec?.parentDirectories ??
    (spec?.walkParents ? spec.projectDirectories : undefined);
  if (resolution.cwd === null || parentDirectories === undefined) {
    return [];
  }
  const { directories, projectRootPath } =
    await resolveProjectAncestorDirectories(resolution.cwd);
  return parentDirectories
    .filter(
      (relativePath) => !disabledDirectories.has(path.dirname(relativePath)),
    )
    .flatMap((relativePath) =>
      directories.map((directoryPath) =>
        skillScanRoot({
          boundaryPath: projectRootPath,
          identity: `${path.dirname(relativePath)}:${path.relative(projectRootPath, directoryPath).split(path.sep).join("/")}`,
          origin: "project",
          providerId: resolution.providerId,
          recursive: spec.recursive,
          rootPath: path.join(directoryPath, relativePath),
        }),
      ),
    );
}

async function resolveProviderExtraRoots(
  resolution: CommandRootResolution,
  grokConfig: z.infer<typeof grokSkillConfigSchema> | null,
): Promise<CommandScanRoot[]> {
  switch (resolution.providerId) {
    case "codex":
      return resolveCodexPluginCommandScanRoots({
        codexHome: resolution.codexHome,
      });
    case "claude-code":
      return resolveClaudePluginCommandScanRoots({
        cwd: resolution.cwd,
        homeDir: resolution.homeDir,
      });
    case "pi":
      return resolvePiConfiguredSkillScanRoots(resolution);
    case "acp-omp":
      return [
        ...(await resolveOmpConfiguredSkillScanRoots(resolution)),
        ...(
          await resolveClaudePluginCommandScanRoots({
            cwd: resolution.cwd,
            homeDir: resolution.homeDir,
          })
        ).filter((root) => root.source === "skill"),
      ];
    case "acp-grok": {
      const roots = [
        ...(await resolveGrokConfiguredSkillScanRoots(resolution, grokConfig)),
        ...(await resolveGrokPluginSkillScanRoots(resolution, grokConfig)),
      ];
      if (
        grokCompatEnabled(
          grokConfig?.compat?.claude?.skills,
          "GROK_CLAUDE_SKILLS_ENABLED",
        )
      ) {
        roots.push(
          ...(
            await resolveClaudePluginCommandScanRoots({
              cwd: resolution.cwd,
              homeDir: resolution.homeDir,
            })
          ).filter((root) => root.source === "skill"),
        );
      }
      return roots;
    }
    case "acp-hermes-agent":
      return resolveHermesConfiguredSkillScanRoots(resolution);
    default:
      return [];
  }
}

export async function resolveProviderCommandScanRoots(
  resolution: CommandRootResolution,
): Promise<CommandScanRoot[]> {
  const roots = [
    ...resolveCommandScanRoots(resolution),
    ...resolveConfiguredSkillScanRoots(resolution),
  ];
  const grokConfig =
    resolution.providerId === "acp-grok"
      ? await readGrokSkillConfig(resolution.homeDir)
      : null;
  const disabledDirectories = new Set<string>();
  if (
    !grokCompatEnabled(
      grokConfig?.compat?.claude?.skills,
      "GROK_CLAUDE_SKILLS_ENABLED",
    ) &&
    resolution.providerId === "acp-grok"
  ) {
    disabledDirectories.add(CLAUDE_DIR_NAME);
  }
  if (
    !grokCompatEnabled(
      grokConfig?.compat?.cursor?.skills,
      "GROK_CURSOR_SKILLS_ENABLED",
    ) &&
    resolution.providerId === "acp-grok"
  ) {
    disabledDirectories.add(CURSOR_DIR_NAME);
  }
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const directoryName = path.basename(
      path.dirname(rootPathForDeduplication(roots[index])),
    );
    if (disabledDirectories.has(directoryName)) {
      roots.splice(index, 1);
    }
  }

  const parentRoots = await resolveParentSkillScanRoots(
    resolution,
    disabledDirectories,
  );
  const extraRoots = await resolveProviderExtraRoots(resolution, grokConfig);
  if (
    resolution.providerId === "codex" ||
    resolution.providerId === "claude-code"
  ) {
    appendUniqueRoots(roots, parentRoots);
    appendUniqueRoots(roots, extraRoots);
  } else {
    appendUniqueRoots(roots, extraRoots);
    appendUniqueRoots(roots, parentRoots);
  }
  return roots;
}

/**
 * Build the ordered set of roots to scan for a provider. Project (cwd-dependent)
 * roots are skipped when `cwd` is null; user-home roots are always included.
 * The daemon owns provider-native discovery only. The server adds its canonical
 * bb skill catalog to the final composer response.
 * Unknown provider ids yield an empty root set.
 */
export function resolveCommandScanRoots(
  resolution: CommandRootResolution,
): CommandScanRoot[] {
  const roots = resolveNativeSkillScanRoots(resolution);
  if (resolution.providerId === "claude-code") {
    if (resolution.cwd !== null) {
      roots.push({
        rootPath: path.join(resolution.cwd, CLAUDE_DIR_NAME, "commands"),
        shape: "command",
        namePrefix: "",
        source: "command",
        origin: "project",
      });
    }
    roots.push({
      rootPath: path.join(resolveClaudeDir(resolution.homeDir), "commands"),
      shape: "command",
      namePrefix: "",
      source: "command",
      origin: "user",
    });
  }
  return roots;
}

export async function listHostCommands(
  command: CommandOf<"host.list_commands">,
): Promise<HostDaemonOnlineRpcResult<"host.list_commands">> {
  if (command.cwd !== null && !path.isAbsolute(command.cwd)) {
    throw new CommandDispatchError("invalid_path", "cwd must be absolute");
  }
  const homeDir = os.homedir();
  const roots = await resolveProviderCommandScanRoots({
    cwd: command.cwd,
    homeDir,
    codexHome: resolveCodexHome(homeDir),
    providerId: command.providerId,
    ...(command.nativeSkillRoots !== undefined
      ? { nativeSkillRoots: command.nativeSkillRoots }
      : {}),
  });
  const commands = await discoverProviderCommands({ roots });
  return { commands };
}
