import type { BigIntStats, Dirent } from "node:fs";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { scanSkillFiles, SKILL_FILE_NAME } from "@bb/skill-index";
import { parseSkillMetadata } from "@bb/skill-index/metadata";
import { resolveDataDirSkillsRootPath } from "@bb/config/skill-storage-paths";
import type {
  HostDaemonInjectedSkillSource,
  HostDaemonSkillTreeFile,
} from "@bb/host-daemon-contract";
import { hashSkillTreeFiles } from "@bb/host-daemon-contract/skill-tree";
import { z } from "zod";
import type { ServerLogger } from "../../types.js";
import { joinHostPathSegments } from "../lib/host-path.js";
import { REGISTRY_SKILL_PROVENANCE_FILE_NAME } from "./registry-skill-provenance.js";

const SKILL_NAME_PATTERN = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

const skillFrontmatterSchema = z
  .object({
    name: z
      .string()
      .max(64)
      .regex(
        SKILL_NAME_PATTERN,
        "Skill name must use lowercase letters, numbers, and single hyphens",
      ),
    description: z
      .string()
      .max(1024)
      .refine((value) => value.trim().length > 0, {
        message: "Skill description must be non-empty",
      }),
  })
  .passthrough();

export interface ResolveInjectedSkillSourcesArgs {
  additionalSkillsRootPaths?: readonly string[];
  dataDir: string;
  pluginSkillRoots?: readonly PluginSkillRoot[];
  pluginSkillSelections?: ReadonlyMap<string, ReadonlySet<string>>;
  projectSkillSources?: readonly ProjectInjectedSkillSource[];
  sharedSkillSources?: readonly SharedInjectedSkillSource[];
  skillTreeRegistry: SkillTreeRegistry;
}

interface PluginSkillRoot {
  pluginId: string;
  rootPath: string;
}

export async function discoverPluginSkillIds(
  logger: ServerLogger,
  args: {
    pluginSkillRoots: readonly PluginSkillRoot[];
    skillTreeRegistry: SkillTreeRegistry;
  },
): Promise<ReadonlyMap<string, readonly string[]>> {
  const idsByPlugin = new Map<string, Set<string>>();
  for (const { pluginId, rootPath } of args.pluginSkillRoots) {
    const ids = idsByPlugin.get(pluginId) ?? new Set<string>();
    for (const source of await readSkillsRoot({
      logger,
      skillTreeRegistry: args.skillTreeRegistry,
      skillsRootPath: rootPath,
      sourceType: "data-dir",
    })) {
      ids.add(source.name);
    }
    idsByPlugin.set(pluginId, ids);
  }
  return new Map(
    [...idsByPlugin].map(([pluginId, ids]) => [
      pluginId,
      [...ids].sort(compareStringsByCodePoint),
    ]),
  );
}

type SkillCatalogProvenance =
  | { kind: "builtin" }
  | { kind: "plugin"; pluginId: string }
  | { kind: "project" }
  | { kind: "user" };

export interface ResolvedSkillCatalogEntry {
  provenance: SkillCatalogProvenance;
  runtimeSource: HostDaemonInjectedSkillSource;
}

interface ResolveServerOwnedSkillCatalogEntriesArgs {
  builtinSkillsRootPath: string | null;
  dataDir: string;
  logger: ServerLogger;
  skillTreeRegistry: SkillTreeRegistry;
}

export type ProjectInjectedSkillSource = Extract<
  HostDaemonInjectedSkillSource,
  { kind: "workspace-path" }
>;
export type SharedInjectedSkillSource = Extract<
  HostDaemonInjectedSkillSource,
  { kind: "host-path" }
>;

export interface SkillTreeFile extends HostDaemonSkillTreeFile {
  hashReusable: boolean;
  sourcePath: string;
  statKey: string;
}

export interface SkillTreeManifest {
  files: readonly SkillTreeFile[];
  rootPath: string;
  treeHash: string;
}

interface HashedFile {
  hashReusable: boolean;
  sha256: string;
  statKey: string;
}

const MAX_REGISTERED_SKILL_TREES = 4_096;
const MAX_FILE_HASH_ATTEMPTS = 3;
const HASH_REUSE_SETTLE_NS = 2_000_000_000n;

export class SkillTreeRegistry {
  readonly #manifestsByHash = new Map<string, SkillTreeManifest>();
  readonly #hashByRoot = new Map<string, string>();

  async readTree(rootPath: string): Promise<SkillTreeManifest> {
    const previousHash = this.#hashByRoot.get(rootPath);
    const previousFiles = new Map(
      (previousHash === undefined
        ? []
        : (this.#manifestsByHash.get(previousHash)?.files ?? [])
      ).map((file) => [file.sourcePath, file]),
    );
    const files = await this.#collectFiles(rootPath, rootPath, previousFiles);
    const manifest: SkillTreeManifest = {
      files,
      rootPath,
      treeHash: hashSkillTreeFiles(files),
    };
    this.#register(manifest);
    return manifest;
  }

  manifest(treeHash: string): SkillTreeManifest | undefined {
    return this.#manifestsByHash.get(treeHash);
  }

  resolve(treeHash: string): string | undefined {
    return this.#manifestsByHash.get(treeHash)?.rootPath;
  }

  #register(manifest: SkillTreeManifest): void {
    const previousHash = this.#hashByRoot.get(manifest.rootPath);
    if (
      previousHash !== undefined &&
      previousHash !== manifest.treeHash &&
      this.#manifestsByHash.get(previousHash)?.rootPath === manifest.rootPath
    ) {
      this.#manifestsByHash.delete(previousHash);
    }
    this.#hashByRoot.delete(manifest.rootPath);
    this.#hashByRoot.set(manifest.rootPath, manifest.treeHash);
    this.#manifestsByHash.delete(manifest.treeHash);
    this.#manifestsByHash.set(manifest.treeHash, manifest);
    for (const [oldestRoot, oldestHash] of this.#hashByRoot) {
      if (this.#hashByRoot.size <= MAX_REGISTERED_SKILL_TREES) break;
      this.#hashByRoot.delete(oldestRoot);
      if (this.#manifestsByHash.get(oldestHash)?.rootPath === oldestRoot) {
        this.#manifestsByHash.delete(oldestHash);
      }
    }
  }

  async #collectFiles(
    rootPath: string,
    currentPath: string,
    previousFiles: ReadonlyMap<string, SkillTreeFile>,
  ): Promise<SkillTreeFile[]> {
    const files: SkillTreeFile[] = [];
    for (const entry of (
      await fsPromises.readdir(currentPath, { withFileTypes: true })
    ).sort(sortDirentsByName)) {
      if (
        currentPath === rootPath &&
        entry.name === REGISTRY_SKILL_PROVENANCE_FILE_NAME
      ) {
        continue;
      }
      const entryPath = path.join(currentPath, entry.name);
      const linkStat = await fsPromises.lstat(entryPath);
      if (
        linkStat.isSymbolicLink() &&
        !(currentPath === rootPath && entry.name === SKILL_FILE_NAME)
      ) {
        throw new Error(`Skill tree contains a symlink: ${entryPath}`);
      }
      const stat = linkStat.isSymbolicLink()
        ? await fsPromises.stat(entryPath, { bigint: true })
        : await fsPromises.lstat(entryPath, { bigint: true });
      if (stat.isDirectory()) {
        files.push(
          ...(await this.#collectFiles(rootPath, entryPath, previousFiles)),
        );
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`Skill tree entry is not a regular file: ${entryPath}`);
      }
      const previous = previousFiles.get(entryPath);
      const { hashed, stat: hashedStat } =
        previous?.hashReusable === true &&
        previous.statKey === fileStatKey(stat)
          ? {
              hashed: {
                hashReusable: true,
                sha256: previous.sha256,
                statKey: previous.statKey,
              },
              stat,
            }
          : await this.#hashFile(entryPath, stat);
      files.push({
        ...hashed,
        mode: Number(hashedStat.mode & 0o777n),
        path: normalizeRelativePath(path.relative(rootPath, entryPath)),
        sizeBytes: Number(hashedStat.size),
        sourcePath: entryPath,
      });
    }
    return files;
  }

  async #hashFile(
    filePath: string,
    initialStat: BigIntStats,
  ): Promise<{ hashed: HashedFile; stat: BigIntStats }> {
    let stat = initialStat;
    for (let attempt = 1; ; attempt += 1) {
      const statKey = fileStatKey(stat);
      const hashStartedNs = BigInt(Date.now()) * 1_000_000n;
      const sha256 = await sha256File(filePath);
      const after = await fsPromises.stat(filePath, { bigint: true });
      if (fileStatKey(after) === statKey) {
        return {
          hashed: {
            hashReusable: after.ctimeNs + HASH_REUSE_SETTLE_NS < hashStartedNs,
            sha256,
            statKey,
          },
          stat: after,
        };
      }
      if (attempt >= MAX_FILE_HASH_ATTEMPTS) {
        throw new Error(
          `Skill tree file kept changing while hashed: ${filePath}`,
        );
      }
      stat = after;
    }
  }
}

export function fileStatKey(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

interface SkillCandidateSource {
  sourceType: Extract<
    HostDaemonInjectedSkillSource["sourceType"],
    "builtin" | "data-dir" | "project"
  >;
}

interface SkillTreeCandidateSource {
  sourceType: Extract<
    HostDaemonInjectedSkillSource["sourceType"],
    "builtin" | "data-dir"
  >;
}

interface SkillRootScanArgs extends SkillTreeCandidateSource {
  logger: ServerLogger;
  skillTreeRegistry: SkillTreeRegistry;
  skillsRootPath: string;
}

interface InvalidSkillLogArgs extends SkillCandidateSource {
  candidatePath: string;
  logger: ServerLogger;
  reason: string;
}

interface SkillCollisionLogArgs {
  colliding: readonly HostDaemonInjectedSkillSource[];
  logger: ServerLogger;
  name: string;
}

function compactZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

function logInvalidSkill(args: InvalidSkillLogArgs): void {
  args.logger.warn(
    {
      candidatePath: args.candidatePath,
      reason: args.reason,
      sourceType: args.sourceType,
    },
    "Skipping invalid injected skill",
  );
}

function logSkillCollision(args: SkillCollisionLogArgs): void {
  for (const source of args.colliding) {
    args.logger.warn(
      {
        name: args.name,
        sourceRootPath: sourceRootPath(source),
        sourceType: source.sourceType,
      },
      "Skipping colliding injected skill",
    );
  }
}

function sortDirentsByName(left: Dirent, right: Dirent): number {
  return compareStringsByCodePoint(left.name, right.name);
}

function compareStringsByCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function sourceRootPath(source: HostDaemonInjectedSkillSource): string {
  return source.kind === "tree"
    ? `skill-tree:${source.treeHash}`
    : source.sourceRootPath;
}

function validateSkillContent(
  logger: ServerLogger,
  args: {
    candidatePath: string;
    content: string;
    directoryName: string;
    sourceType: SkillCandidateSource["sourceType"];
  },
): z.infer<typeof skillFrontmatterSchema> | null {
  const metadata = parseSkillMetadata(args.content);
  if (metadata.error !== null) {
    logInvalidSkill({
      candidatePath: args.candidatePath,
      logger,
      reason: metadata.error,
      sourceType: args.sourceType,
    });
    return null;
  }
  const frontmatter = skillFrontmatterSchema.safeParse(metadata);
  if (!frontmatter.success) {
    logInvalidSkill({
      candidatePath: args.candidatePath,
      logger,
      reason: compactZodIssues(frontmatter.error.issues),
      sourceType: args.sourceType,
    });
    return null;
  }
  if (frontmatter.data.name !== args.directoryName) {
    logInvalidSkill({
      candidatePath: args.candidatePath,
      logger,
      reason: "Frontmatter name must match the skill directory name",
      sourceType: args.sourceType,
    });
    return null;
  }

  return frontmatter.data;
}

export function resolveProjectSkillSourceFromContent(
  logger: ServerLogger,
  args: { candidatePath: string; content: string; directoryName: string },
): ProjectInjectedSkillSource | null {
  const metadata = validateSkillContent(logger, {
    ...args,
    sourceType: "project",
  });
  if (metadata === null) return null;
  return {
    kind: "workspace-path",
    sourceType: "project",
    name: metadata.name,
    description: metadata.description,
    sourceRootPath: args.candidatePath,
    skillFilePath: joinHostPathSegments(args.candidatePath, SKILL_FILE_NAME),
  };
}

async function readSkillsRoot(
  args: SkillRootScanArgs,
): Promise<HostDaemonInjectedSkillSource[]> {
  const sources: HostDaemonInjectedSkillSource[] = [];
  const files = await scanSkillFiles({
    path: args.skillsRootPath,
    shape: "skill",
    boundaryPath: null,
  });
  for (const file of files) {
    const candidatePath = path.dirname(file.filePath);
    const validated = validateSkillContent(args.logger, {
      candidatePath,
      content: file.content,
      directoryName: file.name,
      sourceType: args.sourceType,
    });
    if (validated === null) continue;
    try {
      const manifest = await args.skillTreeRegistry.readTree(candidatePath);
      sources.push({
        kind: "tree",
        sourceType: args.sourceType,
        name: validated.name,
        description: validated.description,
        treeHash: manifest.treeHash,
        entryPath: SKILL_FILE_NAME,
      });
    } catch (error) {
      logInvalidSkill({
        ...args,
        candidatePath,
        reason:
          error instanceof Error ? error.message : "Unable to read skill tree",
      });
    }
  }
  return sources;
}

export async function resolveServerOwnedSkillCatalogEntries(
  args: ResolveServerOwnedSkillCatalogEntriesArgs,
): Promise<ResolvedSkillCatalogEntry[]> {
  const builtin = (
    args.builtinSkillsRootPath === null
      ? []
      : await readSkillsRoot({
          logger: args.logger,
          skillTreeRegistry: args.skillTreeRegistry,
          skillsRootPath: args.builtinSkillsRootPath,
          sourceType: "builtin",
        })
  ).map((runtimeSource) => ({
    provenance: { kind: "builtin" } as const,
    runtimeSource,
  }));
  const user = (
    await readSkillsRoot({
      logger: args.logger,
      skillTreeRegistry: args.skillTreeRegistry,
      skillsRootPath: resolveDataDirSkillsRootPath(args.dataDir),
      sourceType: "data-dir",
    })
  ).map((runtimeSource) => ({
    provenance: { kind: "user" } as const,
    runtimeSource,
  }));
  return [...builtin, ...user];
}

interface ExcludeOverriddenLowerPriorityUserSourcesArgs {
  higherPrioritySources: readonly HostDaemonInjectedSkillSource[];
  lowerPrioritySources: readonly HostDaemonInjectedSkillSource[];
}

function excludeOverriddenLowerPriorityUserSources(
  logger: ServerLogger,
  args: ExcludeOverriddenLowerPriorityUserSourcesArgs,
): HostDaemonInjectedSkillSource[] {
  const higherPriorityNames = new Set(
    args.higherPrioritySources.map((source) => source.name),
  );
  return args.lowerPrioritySources.filter((source) => {
    if (!higherPriorityNames.has(source.name)) {
      return true;
    }
    logger.debug(
      {
        name: source.name,
        sourceRootPath: sourceRootPath(source),
      },
      "Lower-priority injected skill overridden by higher-priority skill",
    );
    return false;
  });
}

function excludeCollisions(
  logger: ServerLogger,
  sources: readonly HostDaemonInjectedSkillSource[],
): HostDaemonInjectedSkillSource[] {
  const byName = new Map<string, HostDaemonInjectedSkillSource[]>();
  for (const source of sources) {
    const existing = byName.get(source.name) ?? [];
    existing.push(source);
    byName.set(source.name, existing);
  }

  const resolved: HostDaemonInjectedSkillSource[] = [];
  for (const [name, entries] of byName) {
    if (entries.length === 1) {
      const source = entries[0];
      if (source) {
        resolved.push(source);
      }
      continue;
    }
    logSkillCollision({
      colliding: entries,
      logger,
      name,
    });
  }

  return resolved.sort((left, right) =>
    compareStringsByCodePoint(left.name, right.name),
  );
}

export async function resolveSkillCatalogEntries(
  logger: ServerLogger,
  args: ResolveInjectedSkillSourcesArgs,
): Promise<ResolvedSkillCatalogEntry[]> {
  const { skillTreeRegistry } = args;
  const projectSources = [...(args.projectSkillSources ?? [])];
  const sharedProjectSources = (args.sharedSkillSources ?? []).filter(
    (source) => source.sourceType === "shared-project",
  );
  const sharedUserSources = (args.sharedSkillSources ?? []).filter(
    (source) => source.sourceType === "shared-user",
  );

  const dataDirSources = await readSkillsRoot({
    logger,
    skillTreeRegistry,
    skillsRootPath: resolveDataDirSkillsRootPath(args.dataDir),
    sourceType: "data-dir",
  });
  const inheritedSourceGroups = await Promise.all(
    (args.additionalSkillsRootPaths ?? []).map((skillsRootPath) =>
      readSkillsRoot({
        logger,
        skillTreeRegistry,
        skillsRootPath,
        sourceType: "data-dir",
      }),
    ),
  );

  const configuredUserSources = [
    ...dataDirSources,
    ...excludeOverriddenLowerPriorityUserSources(logger, {
      higherPrioritySources: dataDirSources,
      lowerPrioritySources: sharedUserSources,
    }),
  ];
  const userSources = inheritedSourceGroups.reduce<
    HostDaemonInjectedSkillSource[]
  >(
    (higherPrioritySources, lowerPrioritySources) => [
      ...higherPrioritySources,
      ...excludeOverriddenLowerPriorityUserSources(logger, {
        higherPrioritySources,
        lowerPrioritySources,
      }),
    ],
    configuredUserSources,
  );
  const pluginSourceGroups = await Promise.all(
    (args.pluginSkillRoots ?? []).map(async ({ pluginId, rootPath }) => ({
      pluginId,
      sources: (
        await readSkillsRoot({
          logger,
          skillTreeRegistry,
          skillsRootPath: rootPath,
          sourceType: "data-dir",
        })
      ).filter(
        (source) =>
          !args.pluginSkillSelections?.has(pluginId) ||
          args.pluginSkillSelections.get(pluginId)?.has(source.name) === true,
      ),
    })),
  );
  const pluginSources = pluginSourceGroups.reduce<
    HostDaemonInjectedSkillSource[]
  >(
    (higherPrioritySources, { sources: lowerPrioritySources }) => [
      ...higherPrioritySources,
      ...excludeOverriddenLowerPriorityUserSources(logger, {
        higherPrioritySources,
        lowerPrioritySources,
      }),
    ],
    [],
  );
  const activePluginSources = excludeOverriddenLowerPriorityUserSources(
    logger,
    {
      higherPrioritySources: userSources,
      lowerPrioritySources: pluginSources,
    },
  );
  const globalSources = excludeCollisions(logger, [
    ...userSources,
    ...activePluginSources,
  ]);
  const activeProjectSources = excludeCollisions(logger, projectSources);
  const activeSharedProjectSources = excludeOverriddenLowerPriorityUserSources(
    logger,
    {
      higherPrioritySources: activeProjectSources,
      lowerPrioritySources: excludeCollisions(logger, sharedProjectSources),
    },
  );
  const projectTierSources = [
    ...activeProjectSources,
    ...activeSharedProjectSources,
  ];
  const projectNames = new Set(projectTierSources.map((source) => source.name));

  const provenanceBySource = new Map<
    HostDaemonInjectedSkillSource,
    SkillCatalogProvenance
  >();
  for (const source of projectSources) {
    provenanceBySource.set(source, { kind: "project" });
  }
  for (const source of sharedProjectSources) {
    provenanceBySource.set(source, { kind: "project" });
  }
  for (const source of sharedUserSources) {
    provenanceBySource.set(source, { kind: "user" });
  }
  for (const source of [...dataDirSources, ...inheritedSourceGroups.flat()]) {
    provenanceBySource.set(source, { kind: "user" });
  }
  for (const group of pluginSourceGroups) {
    for (const source of group.sources) {
      provenanceBySource.set(source, {
        kind: "plugin",
        pluginId: group.pluginId,
      });
    }
  }

  return [...projectTierSources, ...globalSources]
    .filter(
      (source) =>
        source.sourceType === "project" ||
        source.sourceType === "shared-project" ||
        !projectNames.has(source.name),
    )
    .sort((left, right) => compareStringsByCodePoint(left.name, right.name))
    .map((runtimeSource) => {
      const provenance = provenanceBySource.get(runtimeSource);
      if (provenance === undefined) {
        throw new Error(`Missing skill provenance for ${runtimeSource.name}`);
      }
      return { provenance, runtimeSource };
    });
}
