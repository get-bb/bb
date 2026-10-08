import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  SKILL_FILE_NAME,
  type SkillScanRoot,
} from "../command-discovery.js";
import {
  type DeclaredScanRootResolution,
  resolveDeclaredScanRoots,
} from "./list-commands.js";
import { writeHostFile } from "./file-write.js";
import { isFsErrorWithCode } from "../fs-errors.js";
import { resolveNonSymlinkDirectoryPath } from "./root-path.js";

type SkillRootResolution = DeclaredScanRootResolution;

const SHARED_SKILLS_PROVIDER_ID = "bb-shared";
const SKILL_FILE_READ_CONCURRENCY = 16;

type SkillFile =
  HostDaemonOnlineRpcResult<"host.read_skill_files">["skills"][number];

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

function resolveBbSkillScanRoots(
  resolution: SkillRootResolution,
): SkillScanRoot[] {
  const roots: SkillScanRoot[] = [];
  if (
    resolution.cwd !== null &&
    resolution.providerId !== SHARED_SKILLS_PROVIDER_ID
  ) {
    roots.push(
      createBbSkillScanRoot(
        path.join(resolution.cwd, ".bb", "skills"),
        "bb-project",
      ),
    );
  }
  return roots;
}

function classifySkillRoot(
  root: CommandScanRoot,
  resolution: SkillRootResolution,
): Pick<SkillScanRoot, "identitySeed" | "rootKind"> | null {
  if (root.source !== "skill") {
    return null;
  }
  if (root.namePrefix !== "") {
    const rootPath = "rootPath" in root ? root.rootPath : root.filePath;
    return {
      identitySeed: `plugin:${resolution.providerId}:${root.namePrefix}:${rootPath}`,
      rootKind: "plugin",
    };
  }
  if (root.skillIdentitySeed === undefined) {
    return null;
  }
  const shared = resolution.providerId === SHARED_SKILLS_PROVIDER_ID;
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

export async function resolveSkillScanRoots(
  resolution: SkillRootResolution,
): Promise<SkillScanRoot[]> {
  const skillRoots = resolveBbSkillScanRoots(resolution);
  const providerRoots = await resolveDeclaredScanRoots(resolution);
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
  const roots = await resolveSkillScanRoots({
    cwd: command.cwd,
    homeDir: os.homedir(),
    providerId: command.providerId,
    nativeRoots: command.nativeRoots,
  });
  const skills = await discoverSkills({ roots });
  return { skills };
}

async function readSkillFile(args: {
  directoryName: string;
  maxFileBytes: number;
  rootPath: string;
}): Promise<SkillFile | null> {
  const filePath = path.join(
    args.rootPath,
    args.directoryName,
    SKILL_FILE_NAME,
  );
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile()) {
      return null;
    }
    if (stat.size > args.maxFileBytes) {
      return {
        directoryName: args.directoryName,
        sizeBytes: stat.size,
        content: null,
      };
    }
    return {
      directoryName: args.directoryName,
      sizeBytes: stat.size,
      content: await fs.readFile(filePath, "utf8"),
    };
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

export async function readHostSkillFiles(
  command: CommandOf<"host.read_skill_files">,
): Promise<HostDaemonOnlineRpcResult<"host.read_skill_files">> {
  if (!path.isAbsolute(command.path)) {
    throw new CommandDispatchError("invalid_path", "Path must be absolute");
  }
  let rootPath: string;
  try {
    rootPath = await resolveNonSymlinkDirectoryPath({
      description: "Path",
      path: command.path,
    });
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return { skills: [], truncated: false };
    }
    throw error;
  }
  const directoryNames = (await fs.readdir(rootPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const skills: SkillFile[] = [];
  const limited = directoryNames.slice(0, command.limit);
  for (
    let offset = 0;
    offset < limited.length;
    offset += SKILL_FILE_READ_CONCURRENCY
  ) {
    const batch = await Promise.all(
      limited
        .slice(offset, offset + SKILL_FILE_READ_CONCURRENCY)
        .map((directoryName) =>
          readSkillFile({
            directoryName,
            maxFileBytes: command.maxFileBytes,
            rootPath,
          }),
        ),
    );
    for (const skill of batch) {
      if (skill !== null) skills.push(skill);
    }
  }
  return { skills, truncated: directoryNames.length > command.limit };
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
