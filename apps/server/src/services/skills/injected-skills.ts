import type { Dirent } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { resolveDataDirSkillsRootPath } from "@bb/config/skill-storage-paths";
import type { HostDaemonInjectedSkillSource } from "@bb/host-daemon-contract";
import { z } from "zod";
import type { ServerLogger } from "../../types.js";

const SKILL_FILE_NAME = "SKILL.md";
const SKILL_NAME_PATTERN = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
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
  additionalSkillsRootPaths?: readonly string[];
  builtinSkillsRootPath: string;
  dataDir: string;
  /**
   * Skills roots contributed by running plugins (design §4.4). Their own
   * precedence tier: overridden by project and user (data-dir/inherited)
   * skills by name, and overriding built-ins by name. Earlier roots win
   * plugin-vs-plugin name collisions.
   */
  pluginSkillsRootPaths?: readonly string[];
  projectSkillsRootPath?: string;
}

interface SkillCandidateSource {
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

  return {
    sourceType: args.sourceType,
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
        skillsRootPath: args.skillsRootPath,
        sourceType: args.sourceType,
      },
      "Skipping non-directory injected skills root",
    );
    return [];
  }

  const entries = fs
    .readdirSync(args.skillsRootPath, {
      withFileTypes: true,
    })
    .sort(sortDirentsByName);
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

interface ExcludeOverriddenBuiltinsArgs {
  builtinSources: readonly HostDaemonInjectedSkillSource[];
  userSources: readonly HostDaemonInjectedSkillSource[];
}

interface ExcludeOverriddenLowerPriorityUserSourcesArgs {
  higherPrioritySources: readonly HostDaemonInjectedSkillSource[];
  lowerPrioritySources: readonly HostDaemonInjectedSkillSource[];
}

/**
 * A data-dir skill that reuses a built-in skill's name overrides the built-in
 * copy, even when user sources later collide each other out: a user touching a
 * name always silences the built-in.
 */
function excludeOverriddenBuiltins(
  logger: ServerLogger,
  args: ExcludeOverriddenBuiltinsArgs,
): HostDaemonInjectedSkillSource[] {
  const userClaimedNames = new Set(
    args.userSources.map((source) => source.name),
  );
  return args.builtinSources.filter((source) => {
    if (!userClaimedNames.has(source.name)) {
      return true;
    }
    logger.info(
      {
        name: source.name,
        sourceRootPath: source.sourceRootPath,
      },
      "Built-in injected skill overridden by user skill",
    );
    return false;
  });
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
    logger.info(
      {
        name: source.name,
        sourceRootPath: source.sourceRootPath,
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

  return resolved.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Discovers the injected skills for a thread command from built-in skills
 * bundled with the server, data-dir skills under `<dataDir>/skills`, and
 * plugin skills roots. Precedence by name: project > data-dir/inherited
 * user skills > plugin > builtin. Inherited roots are ordered by priority,
 * so earlier roots override later roots.
 *
 * All source paths are server-machine paths that the local host daemon reads
 * from its filesystem.
 */
export function resolveInjectedSkillSources(
  logger: ServerLogger,
  args: ResolveInjectedSkillSourcesArgs,
): HostDaemonInjectedSkillSource[] {
  const projectSources =
    args.projectSkillsRootPath !== undefined
      ? readSkillsRoot({
          logger,
          skillsRootPath: args.projectSkillsRootPath,
          sourceType: "project",
        })
      : [];
  const builtinSources = readSkillsRoot({
    logger,
    skillsRootPath: args.builtinSkillsRootPath,
    sourceType: "builtin",
  });

  const dataDirSources = readSkillsRoot({
    logger,
    skillsRootPath: resolveDataDirSkillsRootPath(args.dataDir),
    sourceType: "data-dir",
  });
  const inheritedSourceGroups = (args.additionalSkillsRootPaths ?? []).map(
    (skillsRootPath) =>
      readSkillsRoot({
        logger,
        skillsRootPath,
        sourceType: "data-dir",
      }),
  );

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
    dataDirSources,
  );
  // The plugin tier (design §4.4): sources ride the "data-dir" wire label —
  // the daemon stages every sourceType identically, so the tier is purely a
  // server-side precedence concept and needs no daemon-contract change.
  const pluginSourceGroups = (args.pluginSkillsRootPaths ?? []).map(
    (skillsRootPath) =>
      readSkillsRoot({
        logger,
        skillsRootPath,
        sourceType: "data-dir",
      }),
  );
  const pluginSources = pluginSourceGroups.reduce<
    HostDaemonInjectedSkillSource[]
  >(
    (higherPrioritySources, lowerPrioritySources) => [
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
  const activeBuiltinSources = excludeOverriddenBuiltins(logger, {
    builtinSources,
    userSources: [...userSources, ...activePluginSources],
  });
  const globalSources = excludeCollisions(logger, [
    ...activeBuiltinSources,
    ...userSources,
    ...activePluginSources,
  ]);
  const activeProjectSources = excludeCollisions(logger, projectSources);
  const projectNames = new Set(
    activeProjectSources.map((source) => source.name),
  );

  return [...activeProjectSources, ...globalSources]
    .filter(
      (source) =>
        source.sourceType === "project" || !projectNames.has(source.name),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}
