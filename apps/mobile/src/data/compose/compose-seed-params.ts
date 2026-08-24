import type {
  ForkThreadCreateSeed,
  ThreadHandoffCreateSeed,
} from "@bb/client-core";

/**
 * The `/compose` route params that seed a new thread from an existing one
 * (the native stand-in for the web's router location state): "Fork from
 * here" on a message, "Handoff to new thread" from the context banner, and
 * "New thread in this worktree". Builders produce the params the actions
 * navigate with; readers parse them back inside the compose controller.
 * Router params are strings, so numbers travel as decimal text.
 */

export interface ComposeSeedParams {
  projectId?: string;
  reuseEnvironmentId?: string;
  forkSourceThreadId?: string;
  forkSourceSeqEnd?: string;
  forkSourceThreadTitle?: string;
  handoffSourceThreadId?: string;
  handoffSourceThreadTitle?: string;
}

/** Fork seed as the compose controller needs it (execution picks come from prefs). */
export type ComposeForkSeed = Pick<
  ForkThreadCreateSeed,
  | "environmentId"
  | "projectId"
  | "sourceSeqEnd"
  | "sourceThreadId"
  | "sourceThreadTitle"
>;

export function buildForkComposeParams(
  seed: ComposeForkSeed,
): ComposeSeedParams {
  return {
    projectId: seed.projectId,
    reuseEnvironmentId: seed.environmentId,
    forkSourceThreadId: seed.sourceThreadId,
    ...(seed.sourceSeqEnd !== undefined
      ? { forkSourceSeqEnd: String(seed.sourceSeqEnd) }
      : {}),
    forkSourceThreadTitle: seed.sourceThreadTitle,
  };
}

export function buildHandoffComposeParams(
  seed: ThreadHandoffCreateSeed,
): ComposeSeedParams {
  return {
    projectId: seed.projectId,
    ...(seed.environmentId !== null
      ? { reuseEnvironmentId: seed.environmentId }
      : {}),
    handoffSourceThreadId: seed.sourceThreadId,
    handoffSourceThreadTitle: seed.sourceThreadTitle,
  };
}

export function buildNewThreadInWorktreeComposeParams({
  projectId,
  environmentId,
}: {
  projectId: string;
  environmentId: string;
}): ComposeSeedParams {
  return { projectId, reuseEnvironmentId: environmentId };
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function parseSourceSeqEnd(value: string | undefined): number | undefined {
  const trimmed = value?.trim() ?? "";
  if (!/^\d+$/u.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * The fork seed carried by compose params, or null when absent / malformed
 * (a fork needs its source thread, project, and environment to reuse).
 */
export function readForkSeedFromComposeParams(
  params: ComposeSeedParams,
): ComposeForkSeed | null {
  const sourceThreadId = nonEmpty(params.forkSourceThreadId);
  const projectId = nonEmpty(params.projectId);
  const environmentId = nonEmpty(params.reuseEnvironmentId);
  if (!sourceThreadId || !projectId || !environmentId) return null;
  return {
    environmentId,
    projectId,
    sourceSeqEnd: parseSourceSeqEnd(params.forkSourceSeqEnd),
    sourceThreadId,
    sourceThreadTitle:
      nonEmpty(params.forkSourceThreadTitle) ?? sourceThreadId.slice(0, 8),
  };
}

export function readHandoffSeedFromComposeParams(
  params: ComposeSeedParams,
): ThreadHandoffCreateSeed | null {
  const sourceThreadId = nonEmpty(params.handoffSourceThreadId);
  const projectId = nonEmpty(params.projectId);
  if (!sourceThreadId || !projectId) return null;
  return {
    environmentId: nonEmpty(params.reuseEnvironmentId),
    projectId,
    sourceThreadId,
    sourceThreadTitle:
      nonEmpty(params.handoffSourceThreadTitle) ?? sourceThreadId.slice(0, 8),
  };
}
