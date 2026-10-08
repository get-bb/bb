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
import { isPathWithinDirectory } from "@bb/process-utils";
import { isFsErrorWithCode } from "../fs-errors.js";
import { resolveNonSymlinkDirectoryPath } from "./root-path.js";

type SkillRootResolution = DeclaredScanRootResolution;

const SHARED_SKILLS_PROVIDER_ID = "bb-shared";

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

async function orNullIfMissing<T>(operation: Promise<T>): Promise<T | null> {
  try {
    return await operation;
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
  if (!path.isAbsolute(command.rootPath)) {
    throw new CommandDispatchError("invalid_path", "rootPath must be absolute");
  }
  const rootPath = await orNullIfMissing(
    resolveNonSymlinkDirectoryPath({ description: "Path", path: command.path }),
  );
  if (rootPath === null) {
    return { skills: [], truncated: false };
  }
  const realReadRootPath = await fs.realpath(command.rootPath);
  if (!isPathWithinDirectory(realReadRootPath, rootPath)) {
    throw new CommandDispatchError(
      "invalid_path",
      `Path "${command.path}" escapes read root`,
    );
  }
  const excludedNames = new Set(command.excludeNames);
  const directoryNames = (await fs.readdir(rootPath, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !excludedNames.has(entry.name),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const skills: SkillFile[] = [];
  let remainingBytes = command.maxTotalBytes;
  for (const directoryName of directoryNames.slice(0, command.limit)) {
    const directoryPath = path.join(rootPath, directoryName);
    const entryNames = await orNullIfMissing(fs.readdir(directoryPath));
    if (!entryNames?.includes(SKILL_FILE_NAME)) continue;
    const filePath = path.join(directoryPath, SKILL_FILE_NAME);
    const stat = await orNullIfMissing(fs.lstat(filePath));
    if (!stat?.isFile()) continue;
    const allowedBytes = Math.min(command.maxFileBytes, remainingBytes);
    const bytes =
      stat.size > allowedBytes
        ? undefined
        : await orNullIfMissing(fs.readFile(filePath));
    if (bytes === null) continue;
    const sizeBytes = bytes?.length ?? stat.size;
    const content =
      bytes === undefined || sizeBytes > command.maxFileBytes
        ? null
        : bytes.toString("utf8");
    const encodedBytes =
      content === null ? 0 : Buffer.byteLength(JSON.stringify(content));
    if (content === null || encodedBytes > remainingBytes) {
      skills.push({ directoryName, sizeBytes, content: null });
      continue;
    }
    remainingBytes -= encodedBytes;
    skills.push({ directoryName, sizeBytes, content });
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
