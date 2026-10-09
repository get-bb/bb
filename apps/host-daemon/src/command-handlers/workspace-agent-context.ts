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
const MAX_PROJECT_SKILLS = 1_000;
const MAX_PROJECT_SKILL_FILE_BYTES = 10 * 1024 * 1024;

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
): Promise<string[]> {
  try {
    await resolveNonSymlinkDirectoryPath({
      description: "Path",
      path: skillsRootPath,
    });
    const entries = await fs.readdir(skillsRootPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
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
}): Promise<WorkspaceProjectSkillFile | null> {
  const skillFilePath = path.join(
    args.skillsRootPath,
    args.directoryName,
    SKILL_FILE_NAME,
  );
  let stat;
  try {
    stat = await fs.lstat(skillFilePath);
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
  if (!stat.isFile()) {
    return null;
  }
  if (stat.size > MAX_PROJECT_SKILL_FILE_BYTES) {
    return {
      kind: "oversized",
      directoryName: args.directoryName,
      sizeBytes: stat.size,
    };
  }
  const content = await readContainedUtf8File({
    filePath: skillFilePath,
    rootPath: args.rootPath,
  });
  return content === null
    ? null
    : { kind: "file", directoryName: args.directoryName, content };
}

async function readProjectSkillFiles(
  rootPath: string,
): Promise<ProjectSkillFiles> {
  const skillsRootPath = path.join(
    rootPath,
    ...PROJECT_SKILLS_RELATIVE_SEGMENTS,
  );
  const directoryNames = await listProjectSkillDirectoryNames(skillsRootPath);
  const files = await Promise.all(
    directoryNames
      .slice(0, MAX_PROJECT_SKILLS)
      .map((directoryName) =>
        readProjectSkillFile({ directoryName, rootPath, skillsRootPath }),
      ),
  );
  return {
    skills: files.filter((file) => file !== null),
    truncated: directoryNames.length > MAX_PROJECT_SKILLS,
  };
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
    readProjectSkillFiles(command.rootPath),
    readAgentInstructions(command.rootPath),
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
