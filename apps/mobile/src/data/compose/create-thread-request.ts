import type { AppCreateThreadRequest } from "@bb/client-core";
import type {
  PermissionMode,
  PromptInput,
  ReasoningLevel,
  ServiceTier,
} from "@bb/domain";
import type { CreateExecutionInputSources } from "@bb/server-contract";
import {
  resolveThreadEnvironmentArgs,
  type ThreadEnvironmentSelection,
} from "./environment-selection";

/**
 * Build the `POST /threads` body from the compose screen's state. The prompt
 * arrives as the composer's `PromptInput[]` (text + mentions, attachments;
 * `composerValueToPromptInput` in @/composer). Optional execution fields are
 * omitted (not sent as undefined) so the server applies its own defaults,
 * and the environment selection is resolved through
 * `resolveThreadEnvironmentArgs`.
 */

export interface BuildCreateThreadRequestInput {
  projectId: string;
  input: readonly PromptInput[];
  providerId?: string | null;
  model?: string | null;
  reasoningLevel?: ReasoningLevel | null;
  permissionMode?: PermissionMode | null;
  serviceTier?: ServiceTier | null;
  environment: ThreadEnvironmentSelection;
  /** File the thread under a section (manual mode). */
  sectionId?: string | null;
  title?: string | null;
  /**
   * Which execution fields the user picked explicitly vs. inherited from a
   * client preference (server bookkeeping; omit when nothing was touched).
   */
  executionInputSources?: CreateExecutionInputSources;
  /** For the managed-worktree base branch default (from `useProjectBranches`). */
  defaultBranch?: string | null;
  defaultWorktreeBaseBranch?: string | null;
}

export type ThreadCreationBlocker =
  | "empty-prompt"
  | "missing-project"
  | "reuse-environment-required"
  | "fork-unsupported";

export type BuildCreateThreadRequestResult =
  | { request: AppCreateThreadRequest; blocker: null }
  | { request: null; blocker: ThreadCreationBlocker };

export const THREAD_CREATION_BLOCKER_MESSAGES: Record<
  ThreadCreationBlocker,
  string
> = {
  "empty-prompt": "Type a message to start the thread.",
  "missing-project": "Pick a project first.",
  "reuse-environment-required": "Pick a worktree to reuse.",
  "fork-unsupported": "This provider cannot fork threads.",
};

/** A text part with visible characters or any attachment part. */
export function hasPromptContent(input: readonly PromptInput[]): boolean {
  return input.some((part) =>
    part.type === "text" ? part.text.trim().length > 0 : true,
  );
}

export function buildCreateThreadRequest(
  input: BuildCreateThreadRequestInput,
): BuildCreateThreadRequestResult {
  const projectId = input.projectId.trim();
  if (projectId.length === 0) {
    return { request: null, blocker: "missing-project" };
  }
  if (!hasPromptContent(input.input)) {
    return { request: null, blocker: "empty-prompt" };
  }
  const environment = resolveThreadEnvironmentArgs({
    selection: input.environment,
    projectId,
    defaultBranch: input.defaultBranch,
    defaultWorktreeBaseBranch: input.defaultWorktreeBaseBranch,
  });
  if (environment === null) {
    return { request: null, blocker: "reuse-environment-required" };
  }
  const title = input.title?.trim();
  return {
    blocker: null,
    request: {
      projectId,
      input: [...input.input],
      environment,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.reasoningLevel ? { reasoningLevel: input.reasoningLevel } : {}),
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
      ...(input.sectionId ? { sectionId: input.sectionId } : {}),
      ...(title ? { title } : {}),
      ...(input.executionInputSources
        ? { executionInputSources: input.executionInputSources }
        : {}),
    },
  };
}
