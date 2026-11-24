import { DEFAULT_PATH_LIST_EXCLUDE_NAMES } from "../../routes/path-list-policy.js";
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
import type { WorkspaceFolderStatus } from "./workspace-folder-instructions.js";

export interface WorkspaceAgentContext {
  agentInstructions: string | null;
  folders: WorkspaceFolderStatus[];
  projectSkillSources: ProjectInjectedSkillSource[];
  sharedSkills: ResolvedSharedSkills;
}

export async function readWorkspaceAgentContext(
  deps: LoggedWorkSessionDeps,
  args: {
    hostId: string;
    workspacePath: string;
    includeAgentInstructions: boolean;
    folderPaths: readonly string[];
  },
): Promise<WorkspaceAgentContext> {
  const result = await callHostRetryableOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.read_workspace_agent_context",
      rootPath: args.workspacePath,
      includeAgentInstructions: args.includeAgentInstructions,
      folderPaths: [...args.folderPaths],
      projectSkillRead: {
        limit: 1_000,
        maxFileBytes: 10 * 1024 * 1024,
        maxFrontmatterBytes: 4 * 1024 * 1024,
        excludeNames: [...DEFAULT_PATH_LIST_EXCLUDE_NAMES],
      },
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
    if (skill.kind !== "file") {
      deps.logger.warn(
        {
          candidatePath,
          reason:
            skill.kind === "oversized"
              ? `SKILL.md is ${skill.sizeBytes} bytes, over the project skill size limit`
              : "SKILL.md frontmatter exceeds the remaining project skill frontmatter budget",
          sourceType: "project",
        },
        "Skipping invalid injected skill",
      );
      continue;
    }
    const source = resolveProjectSkillSourceFromContent(deps.logger, {
      candidatePath,
      content: skill.frontmatter,
      directoryName: skill.directoryName,
    });
    if (source) {
      projectSkillSources.push(source);
    }
  }
  return {
    agentInstructions: result.agentInstructions,
    folders: result.folders,
    projectSkillSources,
    sharedSkills: toResolvedSharedSkills(deps, result.sharedSkills),
  };
}
