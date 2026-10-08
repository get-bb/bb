import { joinHostPathSegments } from "../lib/host-path.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  resolveProjectSkillSourceFromContent,
  type ProjectInjectedSkillSource,
} from "./injected-skills.js";

const MAX_PROJECT_SKILLS = 1_000;
const MAX_PROJECT_SKILL_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PROJECT_SKILLS_TOTAL_BYTES = 32 * 1024 * 1024;

interface ResolveWorkspaceProjectSkillsArgs {
  hostId: string;
  workspacePath: string;
}

export async function resolveWorkspaceProjectSkills(
  deps: LoggedWorkSessionDeps,
  args: ResolveWorkspaceProjectSkillsArgs,
): Promise<ProjectInjectedSkillSource[]> {
  const skillsRootPath = joinHostPathSegments(
    args.workspacePath,
    ".bb",
    "skills",
  );
  const result = await callHostRetryableOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.read_skill_files",
      path: skillsRootPath,
      rootPath: args.workspacePath,
      limit: MAX_PROJECT_SKILLS,
      maxFileBytes: MAX_PROJECT_SKILL_FILE_BYTES,
      maxTotalBytes: MAX_PROJECT_SKILLS_TOTAL_BYTES,
    },
  });
  if (result.truncated) {
    deps.logger.warn(
      { skillsRootPath, limit: MAX_PROJECT_SKILLS },
      "Project skill enumeration reached the skill count limit",
    );
  }

  const sources: ProjectInjectedSkillSource[] = [];
  for (const skill of result.skills) {
    const candidatePath = joinHostPathSegments(
      skillsRootPath,
      skill.directoryName,
    );
    if (skill.content === null) {
      deps.logger.warn(
        {
          candidatePath,
          reason:
            skill.sizeBytes > MAX_PROJECT_SKILL_FILE_BYTES
              ? `SKILL.md exceeds ${MAX_PROJECT_SKILL_FILE_BYTES} bytes`
              : `Project skills exceed ${MAX_PROJECT_SKILLS_TOTAL_BYTES} bytes in total`,
          sourceType: "project",
        },
        "Skipping invalid injected skill",
      );
      continue;
    }
    const source = resolveProjectSkillSourceFromContent(deps.logger, {
      candidatePath,
      content: skill.content,
      directoryName: skill.directoryName,
    });
    if (source) sources.push(source);
  }
  return sources;
}
