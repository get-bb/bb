import type { Dirent } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  resolveApplicationManifestPath,
  resolveApplicationPath,
  resolveAppsRootPath,
  resolveDataDirSkillsRootPath,
} from "@bb/config/app-storage-paths";
import { applicationIdSchema, type ApplicationId } from "@bb/domain";
import type { HostDaemonInjectedSkillSource } from "@bb/host-daemon-contract";
import { appManifestSchema } from "@bb/server-contract";
import { z } from "zod";
import type { ServerLogger } from "../../types.js";

const SKILL_FILE_NAME = "SKILL.md";
const SKILL_NAME_PATTERN =
  /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const SKILL_FRONTMATTER_DELIMITER = "---";

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
  dataDir: string;
}

interface SkillCandidateSource {
  applicationId: ApplicationId | null;
  sourceType: HostDaemonInjectedSkillSource["sourceType"];
}

interface SkillRootScanArgs extends SkillCandidateSource {
  logger: ServerLogger;
  skillsRootPath: string;
}

interface SkillCandidateArgs extends SkillCandidateSource {
  candidatePath: string;
  directoryName: string;
  logger: ServerLogger;
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

interface ReadValidApplicationIdsArgs {
  appsRootPath: string;
  dataDir: string;
  logger: ServerLogger;
}

interface ApplicationManifestReadArgs {
  applicationId: ApplicationId;
  dataDir: string;
  logger: ServerLogger;
}

function isFsErrorWithCode(error: Error, code: string): boolean {
  return "code" in error && error.code === code;
}

function compactZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

function hasSupportedFrontmatterDelimiter(content: string): boolean {
  const trimmed = content.trimStart();
  return (
    trimmed.startsWith(`${SKILL_FRONTMATTER_DELIMITER}\n`) ||
    trimmed.startsWith(`${SKILL_FRONTMATTER_DELIMITER}\r\n`)
  );
}

function logInvalidSkill(args: InvalidSkillLogArgs): void {
  args.logger.warn(
    {
      applicationId: args.applicationId,
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
        applicationId: source.applicationId,
        name: args.name,
        sourceRootPath: source.sourceRootPath,
        sourceType: source.sourceType,
      },
      "Skipping colliding injected skill",
    );
  }
}

function sortDirentsByName(left: Dirent, right: Dirent): number {
  return left.name.localeCompare(right.name);
}

function toSkillFilePath(candidatePath: string): string {
  return path.join(candidatePath, SKILL_FILE_NAME);
}

function readSkillCandidate(
  args: SkillCandidateArgs,
): HostDaemonInjectedSkillSource | null {
  const skillFilePath = toSkillFilePath(args.candidatePath);
  let skillFileStat;
  try {
    skillFileStat = fs.lstatSync(skillFilePath);
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      logInvalidSkill({
        ...args,
        reason: "Missing SKILL.md",
      });
      return null;
    }
    throw error;
  }

  if (skillFileStat.isSymbolicLink()) {
    logInvalidSkill({
      ...args,
      reason: "SKILL.md is a symlink",
    });
    return null;
  }
  if (!skillFileStat.isFile()) {
    logInvalidSkill({
      ...args,
      reason: "SKILL.md is not a regular file",
    });
    return null;
  }

  const content = fs.readFileSync(skillFilePath, "utf8");
  if (!hasSupportedFrontmatterDelimiter(content)) {
    logInvalidSkill({
      ...args,
      reason: "SKILL.md frontmatter must start with a plain --- delimiter",
    });
    return null;
  }

  let parsed;
  try {
    parsed = matter(content);
  } catch (error) {
    logInvalidSkill({
      ...args,
      reason:
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Invalid SKILL.md frontmatter",
    });
    return null;
  }

  const frontmatter = skillFrontmatterSchema.safeParse(parsed.data);
  if (!frontmatter.success) {
    logInvalidSkill({
      ...args,
      reason: compactZodIssues(frontmatter.error.issues),
    });
    return null;
  }

  if (frontmatter.data.name !== args.directoryName) {
    logInvalidSkill({
      ...args,
      reason: "Frontmatter name must match the skill directory name",
    });
    return null;
  }

  if (args.sourceType === "data-dir") {
    return {
      sourceType: "data-dir",
      applicationId: null,
      name: frontmatter.data.name,
      description: frontmatter.data.description,
      sourceRootPath: args.candidatePath,
      skillFilePath,
    };
  }

  if (args.applicationId === null) {
    throw new Error("Global app skill source requires an applicationId");
  }
  return {
    sourceType: "global-app",
    applicationId: args.applicationId,
    name: frontmatter.data.name,
    description: frontmatter.data.description,
    sourceRootPath: args.candidatePath,
    skillFilePath,
  };
}

function readSkillsRoot(
  args: SkillRootScanArgs,
): HostDaemonInjectedSkillSource[] {
  let rootStat;
  try {
    rootStat = fs.lstatSync(args.skillsRootPath);
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  if (rootStat.isSymbolicLink()) {
    args.logger.warn(
      {
        applicationId: args.applicationId,
        skillsRootPath: args.skillsRootPath,
        sourceType: args.sourceType,
      },
      "Skipping symlinked injected skills root",
    );
    return [];
  }
  if (!rootStat.isDirectory()) {
    args.logger.warn(
      {
        applicationId: args.applicationId,
        skillsRootPath: args.skillsRootPath,
        sourceType: args.sourceType,
      },
      "Skipping non-directory injected skills root",
    );
    return [];
  }

  const entries = fs.readdirSync(args.skillsRootPath, {
    withFileTypes: true,
  }).sort(sortDirentsByName);
  const sources: HostDaemonInjectedSkillSource[] = [];

  for (const entry of entries) {
    const candidatePath = path.join(args.skillsRootPath, entry.name);
    if (entry.isSymbolicLink()) {
      logInvalidSkill({
        ...args,
        candidatePath,
        reason: "Skill directory is a symlink",
      });
      continue;
    }
    if (!entry.isDirectory()) {
      logInvalidSkill({
        ...args,
        candidatePath,
        reason: "Skill candidate is not a directory",
      });
      continue;
    }
    const source = readSkillCandidate({
      applicationId: args.applicationId,
      candidatePath,
      directoryName: entry.name,
      logger: args.logger,
      sourceType: args.sourceType,
    });
    if (source) {
      sources.push(source);
    }
  }

  return sources;
}

function hasValidApplicationManifest(
  args: ApplicationManifestReadArgs,
): boolean {
  let parsedJson;
  try {
    parsedJson = JSON.parse(
      fs.readFileSync(
        resolveApplicationManifestPath(args.dataDir, args.applicationId),
        "utf8",
      ),
    );
  } catch (error) {
    args.logger.warn(
      {
        applicationId: args.applicationId,
        manifestPath: resolveApplicationManifestPath(
          args.dataDir,
          args.applicationId,
        ),
        reason:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Invalid app manifest",
      },
      "Skipping invalid global app manifest for injected skills",
    );
    return false;
  }

  const manifest = appManifestSchema.safeParse(parsedJson);
  if (!manifest.success) {
    args.logger.warn(
      {
        applicationId: args.applicationId,
        issues: compactZodIssues(manifest.error.issues),
        manifestPath: resolveApplicationManifestPath(
          args.dataDir,
          args.applicationId,
        ),
      },
      "Skipping invalid global app manifest for injected skills",
    );
    return false;
  }

  if (manifest.data.id !== args.applicationId) {
    args.logger.warn(
      {
        applicationId: args.applicationId,
        manifestId: manifest.data.id,
        manifestPath: resolveApplicationManifestPath(
          args.dataDir,
          args.applicationId,
        ),
      },
      "Skipping global app skills because manifest id does not match directory",
    );
    return false;
  }

  return true;
}

function readValidApplicationIds(
  args: ReadValidApplicationIdsArgs,
): ApplicationId[] {
  let entries: Dirent[];
  try {
    entries = fs.readdirSync(args.appsRootPath, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  const applicationIds: ApplicationId[] = [];
  for (const entry of entries.sort(sortDirentsByName)) {
    if (!entry.isDirectory()) {
      continue;
    }
    const parsed = applicationIdSchema.safeParse(entry.name);
    if (!parsed.success) {
      continue;
    }
    const isValid = hasValidApplicationManifest({
      applicationId: parsed.data,
      dataDir: args.dataDir,
      logger: args.logger,
    });
    if (isValid) {
      applicationIds.push(parsed.data);
    }
  }
  return applicationIds;
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

  return resolved.sort((left, right) => left.name.localeCompare(right.name));
}

export function resolveInjectedSkillSources(
  logger: ServerLogger,
  args: ResolveInjectedSkillSourcesArgs,
): HostDaemonInjectedSkillSource[] {
  const dataDirSources = readSkillsRoot({
    applicationId: null,
    logger,
    skillsRootPath: resolveDataDirSkillsRootPath(args.dataDir),
    sourceType: "data-dir",
  });

  const appSources: HostDaemonInjectedSkillSource[] = [];
  const appsRootPath = resolveAppsRootPath(args.dataDir);
  const applicationIds = readValidApplicationIds({
    appsRootPath,
    dataDir: args.dataDir,
    logger,
  });
  for (const applicationId of applicationIds) {
    appSources.push(
      ...readSkillsRoot({
        applicationId,
        logger,
        skillsRootPath: path.join(
          resolveApplicationPath(args.dataDir, applicationId),
          "skills",
        ),
        sourceType: "global-app",
      }),
    );
  }

  return excludeCollisions(logger, [...dataDirSources, ...appSources]);
}
