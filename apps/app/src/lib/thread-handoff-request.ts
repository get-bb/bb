import type { Environment, PromptTextMention } from "@bb/domain";
import type { PromptDraftState } from "@/lib/prompt-draft";

export const THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY =
  "threadHandoffCreateSeed";

export type ThreadHandoffEnvironmentTarget =
  | { type: "project-default" }
  | { type: "reuse"; environmentId: string }
  | { type: "managed-worktree"; hostId: string; baseBranch: string }
  | { type: "personal"; hostId: string };

export interface ThreadHandoffCreateSeed {
  environmentTarget: ThreadHandoffEnvironmentTarget;
  projectId: string;
  sourceThreadId: string;
  sourceThreadTitle: string;
}

export interface ThreadHandoffLocationState {
  focusPrompt: true;
  [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: ThreadHandoffCreateSeed;
}

export function buildThreadHandoffLocationState(
  seed: ThreadHandoffCreateSeed,
): ThreadHandoffLocationState {
  return {
    focusPrompt: true,
    [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: seed,
  };
}

export function buildEnvironmentRecoveryHandoffTarget(
  environment: Pick<
    Environment,
    "branchName" | "hostId" | "workspaceProvisionType"
  >,
): ThreadHandoffEnvironmentTarget | null {
  if (
    environment.workspaceProvisionType === "managed-worktree" &&
    environment.branchName
  ) {
    return {
      type: "managed-worktree",
      hostId: environment.hostId,
      baseBranch: environment.branchName,
    };
  }
  if (environment.workspaceProvisionType === "personal") {
    return { type: "personal", hostId: environment.hostId };
  }
  return null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readEnvironmentTarget(
  value: unknown,
): ThreadHandoffEnvironmentTarget | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  switch (candidate.type) {
    case "project-default":
      return { type: "project-default" };
    case "reuse": {
      const environmentId = readNonEmptyString(candidate.environmentId);
      return environmentId ? { type: "reuse", environmentId } : null;
    }
    case "managed-worktree": {
      const hostId = readNonEmptyString(candidate.hostId);
      const baseBranch = readNonEmptyString(candidate.baseBranch);
      return hostId && baseBranch
        ? { type: "managed-worktree", hostId, baseBranch }
        : null;
    }
    case "personal": {
      const hostId = readNonEmptyString(candidate.hostId);
      return hostId ? { type: "personal", hostId } : null;
    }
    default:
      return null;
  }
}

export function readThreadHandoffCreateSeedFromLocationState(
  state: unknown,
): ThreadHandoffCreateSeed | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as Record<string, unknown>)[
    THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY
  ];
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Record<string, unknown>;
  const environmentTarget = readEnvironmentTarget(value.environmentTarget);
  if (
    environmentTarget === null ||
    typeof value.projectId !== "string" ||
    value.projectId.length === 0 ||
    typeof value.sourceThreadId !== "string" ||
    value.sourceThreadId.length === 0 ||
    typeof value.sourceThreadTitle !== "string" ||
    value.sourceThreadTitle.trim().length === 0
  ) {
    return null;
  }
  return {
    environmentTarget,
    projectId: value.projectId,
    sourceThreadId: value.sourceThreadId,
    sourceThreadTitle: value.sourceThreadTitle.trim(),
  };
}

export function buildThreadHandoffPromptDraft(
  seed: ThreadHandoffCreateSeed,
): PromptDraftState {
  const prefix = "Continue from ";
  const mentionText = `@thread:${seed.sourceThreadId}`;
  const text = `${prefix}${mentionText}`;
  const mention: PromptTextMention = {
    start: prefix.length,
    end: prefix.length + mentionText.length,
    resource: {
      kind: "thread",
      projectId: seed.projectId,
      threadId: seed.sourceThreadId,
      label: seed.sourceThreadTitle,
    },
  };

  return { text, mentions: [mention], attachments: [] };
}
