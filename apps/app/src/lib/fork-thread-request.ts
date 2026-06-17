import type {
  PermissionMode,
  PromptInput,
  ReasoningLevel,
  ServiceTier,
  Thread,
} from "@bb/domain";
import type { AppCreateThreadRequest } from "@/lib/api";

export const FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY =
  "forkThreadCreateSeed";

export interface ForkThreadCreateSeed {
  environmentId: string;
  model: string;
  permissionMode: PermissionMode;
  projectId: string;
  providerId: string;
  reasoningLevel: ReasoningLevel;
  serviceTier: ServiceTier | undefined;
  sourceSeqEnd: number | undefined;
  sourceThreadId: string;
}

export interface BuildForkThreadRequestArgs extends ForkThreadCreateSeed {
  input: PromptInput[];
}

export function isThreadForkable(
  sourceThread: Pick<Thread, "environmentId"> | null,
): boolean {
  return sourceThread !== null && sourceThread.environmentId !== null;
}

export function buildForkThreadRequest({
  environmentId,
  input,
  model,
  permissionMode,
  projectId,
  providerId,
  reasoningLevel,
  serviceTier,
  sourceSeqEnd,
  sourceThreadId,
}: BuildForkThreadRequestArgs): AppCreateThreadRequest {
  return {
    environment: { type: "reuse", environmentId },
    input,
    model,
    originKind: "fork",
    permissionMode,
    projectId,
    providerId,
    reasoningLevel,
    ...(serviceTier ? { serviceTier } : {}),
    ...(sourceSeqEnd !== undefined ? { sourceSeqEnd } : {}),
    sourceThreadId,
    startedOnBehalfOf: null,
  };
}
