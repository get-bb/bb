import { constants } from "node:fs";
import { isPathWithinDirectory } from "@bb/process-utils";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  HostDaemonOnlineRpcResult,
  WorkspaceProjectSkillFile,
} from "@bb/host-daemon-contract";
import {
  CommandDispatchError,
  type CommandOf,
} from "../command-dispatch-support.js";
import { SKILL_FILE_NAME } from "../command-discovery.js";
import { isFsErrorWithCode } from "../fs-errors.js";
import { readFileForTransport } from "./file-read.js";
import { listSharedSkills } from "./list-skills.js";
import { resolveNonSymlinkDirectoryPath } from "./root-path.js";

const PROJECT_SKILLS_RELATIVE_SEGMENTS = [".bb", "skills"] as const;
const AGENT_INSTRUCTIONS_RELATIVE_SEGMENTS = [".bb", "AGENTS.md"] as const;
type SkillReadPolicy =
  CommandOf<"host.read_workspace_agent_context">["projectSkillRead"];

interface ProjectSkillFiles {
  skills: WorkspaceProjectSkillFile[];
  truncated: boolean;
}

function isMissingPathError(error: unknown): boolean {
  return (
    isFsErrorWithCode(error, "ENOENT") ||
    (error instanceof CommandDispatchError && error.code === "ENOENT")
  );
}

async function readContainedUtf8File(args: {
  filePath: string;
  rootPath: string;
}): Promise<string | null> {
  try {
    const file = await readFileForTransport({
      resolvedPath: args.filePath,
      resultPath: args.filePath,
      rootPath: args.rootPath,
    });
    if (!("content" in file)) {
      return null;
    }
    return file.contentEncoding === "utf8"
      ? file.content
      : Buffer.from(file.content, "base64").toString("utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
}

async function listProjectSkillDirectoryNames(
  skillsRootPath: string,
  rootPath: string,
  excludeNames: string[],
): Promise<string[]> {
  try {
    const realSkillsRoot = await resolveNonSymlinkDirectoryPath({
      description: "Path",
      path: skillsRootPath,
    });
    const realRoot = await fs.realpath(rootPath);
    if (!isPathWithinDirectory(realRoot, realSkillsRoot)) {
      throw new CommandDispatchError(
        "invalid_path",
        "Skills path escapes read root",
      );
    }
    const entries = await fs.readdir(realSkillsRoot, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          !excludeNames.includes(entry.name),
      )
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
}

async function readProjectSkillFile(args: {
  directoryName: string;
  rootPath: string;
  skillsRootPath: string;
  maxFileBytes: number;
  remainingBytes: number;
}): Promise<WorkspaceProjectSkillFile | null> {
  const directoryPath = path.join(args.skillsRootPath, args.directoryName);
  try {
    const entries = await fs.readdir(directoryPath);
    if (!entries.includes(SKILL_FILE_NAME)) return null;
    const filePath = path.join(directoryPath, SKILL_FILE_NAME);
    const stat = await fs.lstat(filePath);
    if (!stat.isFile()) return null;
    const realPath = await fs.realpath(filePath);
    if (!isPathWithinDirectory(await fs.realpath(args.rootPath), realPath)) {
      throw new CommandDispatchError(
        "invalid_path",
        "Skill file escapes read root",
      );
    }
    const oversized = {
      kind: "oversized" as const,
      directoryName: args.directoryName,
      sizeBytes: stat.size,
    };
    const budgetExceeded = {
      kind: "budget-exceeded" as const,
      directoryName: args.directoryName,
    };
    if (stat.size > args.maxFileBytes) return oversized;
    if (stat.size + 2 > args.remainingBytes) return budgetExceeded;
    const limit = Math.min(args.maxFileBytes, args.remainingBytes);
    const file = await fs.open(
      realPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let content: string;
    try {
      let bytes = Buffer.allocUnsafe(Math.min(stat.size + 1, limit + 1));
      let length = 0;
      while (length <= limit) {
        if (length === bytes.length) {
          const grown = Buffer.allocUnsafe(
            Math.min(bytes.length * 2, limit + 1),
          );
          bytes.copy(grown);
          bytes = grown;
        }
        const result = await file.read(
          bytes,
          length,
          bytes.length - length,
          null,
        );
        if (result.bytesRead === 0) break;
        length += result.bytesRead;
      }
      if (length > args.maxFileBytes)
        return { ...oversized, sizeBytes: length };
      if (length > limit) return budgetExceeded;
      content = bytes.subarray(0, length).toString("utf8");
    } finally {
      await file.close();
    }
    if (Buffer.byteLength(JSON.stringify(content)) > args.remainingBytes)
      return budgetExceeded;
    return { kind: "file", directoryName: args.directoryName, content };
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

async function readProjectSkillFiles(
  rootPath: string,
  policy: SkillReadPolicy,
): Promise<ProjectSkillFiles> {
  const skillsRootPath = path.join(
    rootPath,
    ...PROJECT_SKILLS_RELATIVE_SEGMENTS,
  );
  const directoryNames = await listProjectSkillDirectoryNames(
    skillsRootPath,
    rootPath,
    policy.excludeNames,
  );
  const skills: WorkspaceProjectSkillFile[] = [];
  let remainingBytes = policy.maxContentBytes;
  for (const directoryName of directoryNames.slice(0, policy.limit)) {
    const file = await readProjectSkillFile({
      directoryName,
      rootPath,
      skillsRootPath,
      maxFileBytes: policy.maxFileBytes,
      remainingBytes,
    });
    if (file === null) continue;
    if (file.kind === "file")
      remainingBytes -= Buffer.byteLength(JSON.stringify(file.content));
    skills.push(file);
  }
  return { skills, truncated: directoryNames.length > policy.limit };
}

async function readAgentInstructions(rootPath: string): Promise<string | null> {
  const content = await readContainedUtf8File({
    filePath: path.join(rootPath, ...AGENT_INSTRUCTIONS_RELATIVE_SEGMENTS),
    rootPath,
  });
  const trimmed = content?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export async function readWorkspaceAgentContext(
  command: CommandOf<"host.read_workspace_agent_context">,
): Promise<HostDaemonOnlineRpcResult<"host.read_workspace_agent_context">> {
  if (!path.isAbsolute(command.rootPath)) {
    throw new CommandDispatchError("invalid_path", "rootPath must be absolute");
  }
  const [projectSkills, agentInstructions, sharedSkills] = await Promise.all([
    readProjectSkillFiles(command.rootPath, command.projectSkillRead),
    command.includeAgentInstructions
      ? readAgentInstructions(command.rootPath)
      : Promise.resolve(null),
    listSharedSkills({
      cwd: command.rootPath,
      roots: command.sharedSkillRoots,
    }),
  ]);
  return {
    agentInstructions,
    projectSkills: projectSkills.skills,
    projectSkillsTruncated: projectSkills.truncated,
    sharedSkills,
  };
}
