import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import {
  experimental_filterResolvedNativeRoots,
  type ExperimentalNativeRootsResolveAnswer,
} from "@get-bb/plugin-sdk/host";
import ignore from "ignore";
import { minimatch } from "minimatch";
import { z } from "zod";

export const PI_NATIVE_ROOTS_DECLARATION: Pick<
  PluginProviderDeclaration,
  "experimental_nativeSkillRoots" | "experimental_resolvesNativeRoots"
> = {
  experimental_nativeSkillRoots: {
    user: [".pi/agent/skills", ".agents/skills"],
    project: [".pi/skills", ".agents/skills"],
  },
  experimental_resolvesNativeRoots: true,
};

const piSettingsSchema = z
  .object({
    skills: z.array(z.string()).optional(),
    prompts: z.array(z.string()).optional(),
    defaultProjectTrust: z.enum(["ask", "always", "never"]).optional(),
  })
  .passthrough();

const DEFAULT_AGENT_DIR_SEGMENTS = [".pi", "agent"] as const;

export interface ResolvePiNativeRootsArgs {
  homeDir: string;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string | null;
}

function resolvePiAgentDir(args: ResolvePiNativeRootsArgs): string {
  const configured = args.env.PI_CODING_AGENT_DIR?.trim();
  return configured
    ? resolveStoredPath(args.homeDir, configured, args.homeDir)
    : path.join(args.homeDir, ...DEFAULT_AGENT_DIR_SEGMENTS);
}

function resolveStoredPath(
  homeDir: string,
  value: string,
  baseDir: string,
): string {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return path.join(homeDir, value.slice(2));
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function isPlainLocalSource(value: string): boolean {
  return !/^(?:npm:|git:|https?:\/\/|git@)/u.test(value);
}

function addConfiguredRoots(
  roots: Set<string>,
  sources: string[] | undefined,
  homeDir: string,
  agentDir: string,
): void {
  for (const raw of sources ?? []) {
    const value = raw.trim();
    if (
      value.length === 0 ||
      value.startsWith("!") ||
      !isPlainLocalSource(value) ||
      path.extname(value).toLowerCase() === ".md"
    ) {
      continue;
    }
    roots.add(path.resolve(resolveStoredPath(homeDir, value, agentDir)));
  }
}

type PromptOrigin = "user" | "project";
interface PromptSource {
  path: string;
  origin: PromptOrigin;
  baseDir: string;
  patterns: string[];
  auto: boolean;
}

async function readPiSettings(settingsPath: string) {
  try {
    return piSettingsSchema.parse(
      JSON.parse(await readFile(settingsPath, "utf8")),
    );
  } catch {
    return null;
  }
}

async function projectPromptsTrusted(
  agentDir: string,
  cwd: string,
  defaultTrust: "ask" | "always" | "never" | undefined,
): Promise<boolean> {
  try {
    const decisions = z
      .record(z.string(), z.boolean())
      .parse(
        JSON.parse(await readFile(path.join(agentDir, "trust.json"), "utf8")),
      );
    let current = await realpath(cwd).catch(() => path.resolve(cwd));
    while (true) {
      if (Object.hasOwn(decisions, current)) return decisions[current] ?? false;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {}
  return defaultTrust === "always";
}

async function promptIgnoreRules(directory: string) {
  const matcher = ignore();
  for (const name of [".gitignore", ".ignore", ".fdignore"]) {
    try {
      const lines = (await readFile(path.join(directory, name), "utf8"))
        .split(/\r?\n/u)
        .map((line) => {
          if (!line.trim() || line.trimStart().startsWith("#")) return "";
          const negated = line.startsWith("!");
          const pattern = line.startsWith("\\!")
            ? line.slice(1)
            : negated
              ? line.slice(1)
              : line;
          return `${negated ? "!" : ""}${pattern.replace(/^\//u, "")}`;
        })
        .filter(Boolean);
      if (lines.length > 0) matcher.add(lines);
    } catch {}
  }
  return matcher;
}

async function promptFiles(source: string): Promise<string[]> {
  try {
    const sourceStat = await stat(source);
    if (sourceStat.isFile()) return source.endsWith(".md") ? [source] : [];
    if (!sourceStat.isDirectory()) return [];
    const entries = await readdir(source, { withFileTypes: true });
    const ignored = await promptIgnoreRules(source);
    const files = await Promise.all(
      entries.map(async (entry) => {
        if (
          entry.name.startsWith(".") ||
          !entry.name.endsWith(".md") ||
          ignored.ignores(entry.name)
        )
          return null;
        const filePath = path.join(source, entry.name);
        if (entry.isFile()) return filePath;
        if (!entry.isSymbolicLink()) return null;
        return (await stat(filePath).catch(() => null))?.isFile()
          ? filePath
          : null;
      }),
    );
    return files.filter((filePath): filePath is string => filePath !== null);
  } catch {
    return [];
  }
}

function matchesPromptPattern(
  filePath: string,
  pattern: string,
  baseDir: string,
): boolean {
  const normalized = pattern.split(path.sep).join("/");
  return [path.relative(baseDir, filePath), path.basename(filePath), filePath]
    .map((candidate) => candidate.split(path.sep).join("/"))
    .some((candidate) => minimatch(candidate, normalized));
}

function matchesExactPromptPath(
  filePath: string,
  pattern: string,
  baseDir: string,
): boolean {
  const normalized = pattern
    .replace(/^(?:\.\/|\.\\)/u, "")
    .split(path.sep)
    .join("/");
  return [path.relative(baseDir, filePath), filePath].some(
    (candidate) => candidate.split(path.sep).join("/") === normalized,
  );
}

function enabledPrompt(filePath: string, source: PromptSource): boolean {
  const entries = source.patterns;
  const excludes = entries
    .filter((entry) => entry.startsWith("!"))
    .map((entry) => entry.slice(1));
  const includes = source.auto
    ? []
    : entries.filter((entry) => !/^[!+-]/u.test(entry) && /[*?]/u.test(entry));
  const forceIncludes = entries
    .filter((entry) => entry.startsWith("+"))
    .map((entry) => entry.slice(1));
  const forceExcludes = entries
    .filter((entry) => entry.startsWith("-"))
    .map((entry) => entry.slice(1));
  const matches = (patterns: string[]) =>
    patterns.some((pattern) =>
      matchesPromptPattern(filePath, pattern, source.baseDir),
    );
  const exact = (patterns: string[]) =>
    patterns.some((pattern) =>
      matchesExactPromptPath(filePath, pattern, source.baseDir),
    );
  let enabled =
    (includes.length === 0 || matches(includes)) && !matches(excludes);
  if (exact(forceIncludes)) enabled = true;
  if (exact(forceExcludes)) enabled = false;
  return enabled;
}

export async function resolvePiNativeRoots(
  args: ResolvePiNativeRootsArgs,
): Promise<ExperimentalNativeRootsResolveAnswer> {
  const agentDir = resolvePiAgentDir(args);
  const skillRoots = new Set<string>();
  if (agentDir !== path.join(args.homeDir, ...DEFAULT_AGENT_DIR_SEGMENTS)) {
    skillRoots.add(path.resolve(agentDir, "skills"));
  }
  const userSettings = await readPiSettings(
    path.join(agentDir, "settings.json"),
  );
  addConfiguredRoots(skillRoots, userSettings?.skills, args.homeDir, agentDir);
  const sources: PromptSource[] = [];
  const addSources = (
    origin: PromptOrigin,
    baseDir: string,
    entries: string[],
  ) => {
    sources.push({
      path: path.join(baseDir, "prompts"),
      origin,
      baseDir,
      patterns: entries,
      auto: true,
    });
    for (const raw of entries) {
      const value = raw.trim();
      if (
        !value ||
        /^[!+-]/u.test(value) ||
        /[*?]/u.test(value) ||
        !isPlainLocalSource(value)
      )
        continue;
      sources.push({
        path: path.resolve(resolveStoredPath(args.homeDir, value, baseDir)),
        origin,
        baseDir,
        patterns: entries,
        auto: false,
      });
    }
  };
  addSources("user", agentDir, userSettings?.prompts ?? []);
  if (
    args.cwd !== null &&
    (await projectPromptsTrusted(
      agentDir,
      args.cwd,
      userSettings?.defaultProjectTrust,
    ))
  ) {
    const projectDir = path.join(args.cwd, ".pi");
    const projectSettings = await readPiSettings(
      path.join(projectDir, "settings.json"),
    );
    addSources("project", projectDir, projectSettings?.prompts ?? []);
  }
  const commandFiles = new Map<string, PromptOrigin>();
  for (const source of sources) {
    for (const filePath of await promptFiles(source.path)) {
      if (enabledPrompt(filePath, source))
        commandFiles.set(filePath, source.origin);
    }
  }
  return experimental_filterResolvedNativeRoots(
    {
      skills: [...skillRoots].sort().map((rootPath) => ({
        path: rootPath,
        origin: "user" as const,
        shape: "skills" as const,
      })),
      commands: [...commandFiles]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([filePath, origin]) => ({
          path: filePath,
          origin,
          shape: "command-file" as const,
        })),
    },
    { warn: console.warn },
  ).answer;
}
