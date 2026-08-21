import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveCodexHome } from "@bb/config/codex-home";
import { resolveDataDirSkillsRootPath } from "@bb/config/skill-storage-paths";
import type {
  HostDaemonOnlineRpcResult,
  SkillRootKind,
} from "@bb/host-daemon-contract";
import {
  CommandDispatchError,
  type CommandOf,
  ExpectedCommandDispatchError,
} from "../command-dispatch-support.js";
import {
  type CommandScanRoot,
  discoverSkills,
  type SkillScanRoot,
} from "../command-discovery.js";
import {
  type CommandRootResolution,
  resolveProviderCommandScanRoots,
} from "./list-commands.js";
import { writeHostFile } from "./file-write.js";

const SKILL_FILE_NAME = "SKILL.md";

type SkillRootResolution = CommandRootResolution;

function createBbSkillScanRoot(
  rootPath: string,
  rootKind: Extract<SkillRootKind, `bb-${string}`>,
): SkillScanRoot {
  return {
    rootPath,
    shape: "skill",
    namePrefix: "",
    source: "skill",
    origin: rootKind === "bb-project" ? "project" : "user",
    identitySeed: rootKind,
    rootKind,
  };
}

/**
 * Resolve the project-local bb root owned by this host. Global bb-user and
 * bb-builtin skills remain server-owned so remote hosts never interpret server
 * filesystem paths or create a second, divergent user catalog.
 */
function resolveBbSkillScanRoots(
  resolution: SkillRootResolution,
): SkillScanRoot[] {
  const roots: SkillScanRoot[] = [];
  if (resolution.cwd !== null) {
    roots.push(
      createBbSkillScanRoot(
        path.join(resolution.cwd, ".bb", "skills"),
        "bb-project",
      ),
    );
  }
  return roots;
}

/**
 * Classify a scan root by its originating identity so the server can map it to a
 * product scope. Plugin roots are tagged structurally (they always carry a
 * `namePrefix`); provider base roots are matched by exact path against the same
 * resolution that produced them. bb roots arrive already tagged from
 * `resolveBbSkillScanRoots`. Returns `null` for legacy command roots or an
 * unrecognized root.
 */
function classifySkillRoot(
  root: CommandScanRoot,
  resolution: CommandRootResolution,
): Pick<SkillScanRoot, "identitySeed" | "rootKind"> | null {
  if (root.source !== "skill") {
    return null;
  }
  if (root.namePrefix !== "") {
    const rootPath = "rootPath" in root ? root.rootPath : root.filePath;
    // Provider plugin discovery currently exposes a display namespace but not
    // the registry's canonical plugin id. Keep plugin skills unique by their
    // authoritative root path until that discovery contract grows a stable
    // plugin identity; native/bb skills below are path-independent.
    return {
      identitySeed: `plugin:${resolution.providerId}:${root.namePrefix}:${rootPath}`,
      rootKind: "plugin",
    };
  }
  if (root.skillIdentitySeed !== undefined) {
    const shared = resolution.providerId === "bb-shared";
    return {
      identitySeed: root.skillIdentitySeed,
      rootKind: shared
        ? root.origin === "project"
          ? "shared-project"
          : "shared-user"
        : root.origin === "project"
          ? "provider-project"
          : "provider-user",
    };
  }
  // All remaining non-plugin skill base roots are directory-shaped.
  if (root.shape !== "skill" && root.shape !== "skill-recursive") {
    return null;
  }
  const { rootPath } = root;
  if (
    resolution.cwd !== null &&
    (rootPath === path.join(resolution.cwd, ".claude", "skills") ||
      rootPath === path.join(resolution.cwd, ".codex", "skills") ||
      (resolution.providerId === "codex" &&
        root.origin === "project" &&
        path.basename(rootPath) === "skills" &&
        path.basename(path.dirname(rootPath)) === ".agents"))
  ) {
    return {
      identitySeed:
        root.skillIdentitySeed ?? `${resolution.providerId}:provider-project`,
      rootKind: "provider-project",
    };
  }
  if (
    rootPath === path.join(resolution.homeDir, ".claude", "skills") ||
    rootPath === path.join(resolution.codexHome, "skills") ||
    rootPath === path.join(resolution.codexHome, "skills", ".system")
  ) {
    return {
      identitySeed: `${resolution.providerId}:provider-user:${
        rootPath.endsWith(`${path.sep}.system`) ? "system" : "user"
      }`,
      rootKind: "provider-user",
    };
  }
  return null;
}

/**
 * Resolve the skill scan roots for a provider and tag each with its `rootKind`.
 * Reuses the command-typeahead root resolution verbatim (single source of root
 * paths), then drops non-skill roots and roots that do not classify.
 */
export async function resolveSkillScanRoots(
  resolution: SkillRootResolution,
): Promise<SkillScanRoot[]> {
  const skillRoots = resolveBbSkillScanRoots(resolution);
  const providerRoots = await resolveProviderCommandScanRoots(resolution);
  for (const root of providerRoots) {
    const classification = classifySkillRoot(root, resolution);
    if (classification === null) {
      continue;
    }
    skillRoots.push({ ...root, ...classification });
  }
  return skillRoots;
}

export async function listHostSkills(
  command: CommandOf<"host.list_skills">,
  _options: { dataDir: string },
): Promise<HostDaemonOnlineRpcResult<"host.list_skills">> {
  if (command.cwd !== null && !path.isAbsolute(command.cwd)) {
    throw new CommandDispatchError("invalid_path", "cwd must be absolute");
  }
  const homeDir = os.homedir();
  const roots = await resolveSkillScanRoots({
    cwd: command.cwd,
    homeDir,
    codexHome: resolveCodexHome(homeDir),
    providerId: command.providerId,
    ...(command.nativeSkillRoots !== undefined
      ? { nativeSkillRoots: command.nativeSkillRoots }
      : {}),
  });
  const skills = await discoverSkills({ roots });
  return { skills };
}

function isSafeSkillName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    name === path.basename(name) &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}

/**
 * Resolve the root that owns a deletable skill. bb roots are derived locally;
 * provider roots are supplied by the server after authoritative discovery.
 */
function resolveDeletableSkillRoot(
  args: {
    scope: CommandOf<"host.delete_skill">["scope"];
    cwd: string | null;
    rootPath: string | null;
  },
  dataDir: string,
): string {
  if (args.scope === "bb-user") {
    return resolveDataDirSkillsRootPath(dataDir);
  }
  if (args.scope === "bb-project") {
    const cwd = args.cwd;
    if (cwd === null) {
      throw new CommandDispatchError(
        "invalid_path",
        "cwd is required for a bb-project skill",
      );
    }
    if (!path.isAbsolute(cwd)) {
      throw new CommandDispatchError("invalid_path", "cwd must be absolute");
    }
    return path.join(cwd, ".bb", "skills");
  }
  if (args.rootPath === null || !path.isAbsolute(args.rootPath)) {
    throw new CommandDispatchError(
      "invalid_path",
      "rootPath must be absolute for a provider skill",
    );
  }
  return args.rootPath;
}

async function realpathOrNull(targetPath: string): Promise<string | null> {
  try {
    return await fs.realpath(targetPath);
  } catch {
    return null;
  }
}

/**
 * Delete a user-owned skill directory. Defense-in-depth confinement requires a
 * safe single-segment name and an exact realpath match to the named direct
 * child `<root>/<name>`, refusing symlink leaves before recursive removal.
 */
export async function deleteHostSkill(
  command: CommandOf<"host.delete_skill">,
  options: { dataDir: string },
): Promise<HostDaemonOnlineRpcResult<"host.delete_skill">> {
  if (!isSafeSkillName(command.name)) {
    throw new CommandDispatchError(
      "invalid_skill_name",
      "Skill name must be a single path segment",
    );
  }
  const root = resolveDeletableSkillRoot(
    {
      scope: command.scope,
      cwd: command.cwd,
      rootPath: command.rootPath,
    },
    options.dataDir,
  );
  const skillDirPath = path.join(root, command.name);

  const realRoot = await realpathOrNull(root);
  const realTarget = await realpathOrNull(skillDirPath);
  if (realRoot === null || realTarget === null) {
    throw new ExpectedCommandDispatchError(
      "skill_not_found",
      `Skill "${command.name}" not found`,
    );
  }
  // Must resolve to the named direct child — a symlinked leaf pointing anywhere
  // else (in or out of the root) is refused for this destructive op.
  if (realTarget !== path.join(realRoot, command.name)) {
    throw new CommandDispatchError(
      "skill_outside_root",
      "Refusing to delete a skill that resolves outside its skill root",
    );
  }

  const targetStat = await fs.stat(realTarget).catch(() => null);
  if (targetStat === null || !targetStat.isDirectory()) {
    throw new ExpectedCommandDispatchError(
      "skill_not_found",
      `Skill "${command.name}" not found`,
    );
  }
  const skillFileStat = await fs
    .stat(path.join(realTarget, SKILL_FILE_NAME))
    .catch(() => null);
  if (skillFileStat === null || !skillFileStat.isFile()) {
    throw new CommandDispatchError(
      "not_a_skill",
      `"${command.name}" is not a skill directory`,
    );
  }

  await fs.rm(realTarget, { recursive: true, force: false });
  return { deletedPath: realTarget };
}

/**
 * Overwrite an existing bb skill's SKILL.md. Same confinement as delete: path
 * built host-side from `(scope, name, cwd)`, name a single safe segment, and the
 * resolved target must be exactly `<bb-root>/<name>` of an existing skill (one
 * whose SKILL.md already exists). Edits only — never creates a new skill.
 */
export async function writeHostSkill(
  command: CommandOf<"host.write_skill">,
  options: { dataDir: string },
): Promise<HostDaemonOnlineRpcResult<"host.write_skill">> {
  if (!isSafeSkillName(command.name)) {
    throw new CommandDispatchError(
      "invalid_skill_name",
      "Skill name must be a single path segment",
    );
  }
  const root = resolveDeletableSkillRoot(
    { scope: command.scope, cwd: command.cwd, rootPath: null },
    options.dataDir,
  );
  const realRoot = await realpathOrNull(root);
  const realTarget = await realpathOrNull(path.join(root, command.name));
  if (realRoot === null || realTarget === null) {
    throw new ExpectedCommandDispatchError(
      "skill_not_found",
      `Skill "${command.name}" not found`,
    );
  }
  if (realTarget !== path.join(realRoot, command.name)) {
    throw new CommandDispatchError(
      "skill_outside_root",
      "Refusing to edit a skill that resolves outside its bb root",
    );
  }
  const skillFilePath = path.join(realTarget, SKILL_FILE_NAME);
  // Edit-only: the SKILL.md must already exist (creation is via prompt).
  const skillFileStat = await fs.stat(skillFilePath).catch(() => null);
  if (skillFileStat === null || !skillFileStat.isFile()) {
    throw new ExpectedCommandDispatchError(
      "skill_not_found",
      `Skill "${command.name}" not found`,
    );
  }
  const result = await writeHostFile({
    type: "host.write_file",
    path: skillFilePath,
    rootPath: realTarget,
    content: command.content,
    contentEncoding: "utf8",
    createParents: false,
    expectedSha256: command.expectedSha256,
  });
  if (result.outcome === "conflict") {
    return result;
  }
  return {
    outcome: "written",
    filePath: skillFilePath,
    sha256: result.sha256,
  };
}
