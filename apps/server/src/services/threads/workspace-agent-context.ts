import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { joinHostPathSegments } from "../lib/host-path.js";
import {
  resolveProjectSkillSourceFromContent,
  type ProjectInjectedSkillSource,
} from "../skills/injected-skills.js";
import {
  sharedSkillNativeRoots,
  toResolvedSharedSkills,
  type ResolvedSharedSkills,
} from "../skills/shared-skills.js";

export interface WorkspaceAgentContext {
  agentInstructions: string | null;
  projectSkillSources: ProjectInjectedSkillSource[];
  sharedSkills: ResolvedSharedSkills;
}

export async function readWorkspaceAgentContext(
  deps: LoggedWorkSessionDeps,
  args: { hostId: string; workspacePath: string },
): Promise<WorkspaceAgentContext> {
  const result = await callHostRetryableOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.read_workspace_agent_context",
      rootPath: args.workspacePath,
      sharedSkillRoots: sharedSkillNativeRoots(deps),
    },
  });
  const skillsRootPath = joinHostPathSegments(
    args.workspacePath,
    ".bb",
    "skills",
  );
  if (result.projectSkillsTruncated) {
    deps.logger.warn(
      { skillsRootPath, limit: result.projectSkills.length },
      "Project skill enumeration reached the skill count limit",
    );
  }
  const projectSkillSources: ProjectInjectedSkillSource[] = [];
  for (const skill of result.projectSkills) {
    const candidatePath = joinHostPathSegments(
      skillsRootPath,
      skill.directoryName,
    );
    if (skill.kind === "oversized") {
      deps.logger.warn(
        {
          candidatePath,
          reason: `SKILL.md is ${skill.sizeBytes} bytes, over the project skill size limit`,
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
    if (source) {
      projectSkillSources.push(source);
    }
  }
  return {
    agentInstructions: result.agentInstructions,
    projectSkillSources,
    sharedSkills: toResolvedSharedSkills(deps, result.sharedSkills),
  };
}
