import { Buffer } from "node:buffer";
import path from "node:path";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  resolveProjectSkillSourceFromContent,
  type ProjectInjectedSkillSource,
} from "./injected-skills.js";

const SKILL_FILE_NAME = "SKILL.md";
const MAX_PROJECT_SKILLS = 1_000;
const MAX_PROJECT_SKILL_FILE_BYTES = 10 * 1024 * 1024;
const PROJECT_SKILL_READ_CONCURRENCY = 16;

interface ResolveWorkspaceProjectSkillsArgs {
  hostId: string;
  workspacePath: string;
}

async function readProjectSkill(
  deps: LoggedWorkSessionDeps,
  args: {
    directoryName: string;
    skillsRootPath: string;
    workspacePath: string;
    hostId: string;
  },
): Promise<ProjectInjectedSkillSource | null> {
  const candidatePath = path.join(args.skillsRootPath, args.directoryName);
  const skillFilePath = path.join(candidatePath, SKILL_FILE_NAME);
  let result;
  try {
    result = await callHostRetryableOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.read_file",
        path: skillFilePath,
        rootPath: args.workspacePath,
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.body.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  if (result.sizeBytes > MAX_PROJECT_SKILL_FILE_BYTES) {
    deps.logger.warn(
      {
        candidatePath,
        reason: `SKILL.md exceeds ${MAX_PROJECT_SKILL_FILE_BYTES} bytes`,
        sourceType: "project",
      },
      "Skipping invalid injected skill",
    );
    return null;
  }
  const content =
    result.contentEncoding === "utf8"
      ? result.content
      : Buffer.from(result.content, "base64").toString("utf8");
  return resolveProjectSkillSourceFromContent(deps.logger, {
    candidatePath,
    content,
    directoryName: args.directoryName,
  });
}

export async function resolveWorkspaceProjectSkills(
  deps: LoggedWorkSessionDeps,
  args: ResolveWorkspaceProjectSkillsArgs,
): Promise<ProjectInjectedSkillSource[]> {
  const skillsRootPath = path.join(args.workspacePath, ".bb", "skills");
  const result = await callHostRetryableOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.list_files",
      path: skillsRootPath,
      query: SKILL_FILE_NAME,
      limit: MAX_PROJECT_SKILLS,
    },
  });
  if (result.truncated) {
    deps.logger.warn(
      { skillsRootPath, limit: MAX_PROJECT_SKILLS },
      "Project skill enumeration reached the skill count limit",
    );
  }

  const directoryNames = result.files
    .map((file) => file.path.split("/"))
    .filter(
      (segments) => segments.length === 2 && segments[1] === SKILL_FILE_NAME,
    )
    .map((segments) => segments[0])
    .filter((name): name is string => name !== undefined)
    .sort((left, right) => left.localeCompare(right));
  const sources: ProjectInjectedSkillSource[] = [];
  for (
    let offset = 0;
    offset < directoryNames.length;
    offset += PROJECT_SKILL_READ_CONCURRENCY
  ) {
    const batch = directoryNames.slice(
      offset,
      offset + PROJECT_SKILL_READ_CONCURRENCY,
    );
    const batchSources = await Promise.all(
      batch.map((directoryName) =>
        readProjectSkill(deps, {
          directoryName,
          hostId: args.hostId,
          skillsRootPath,
          workspacePath: args.workspacePath,
        }),
      ),
    );
    for (const source of batchSources) {
      if (source) sources.push(source);
    }
  }
  return sources;
}
