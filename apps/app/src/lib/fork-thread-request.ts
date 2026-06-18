import {
  getBuiltInAgentProviderInfo,
  isAgentProviderId,
} from "@bb/agent-providers";
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
  sourceThreadTitle: string;
}

export interface BuildForkThreadRequestArgs extends ForkThreadCreateSeed {
  input: PromptInput[];
}

type ForkableThread = Pick<Thread, "environmentId" | "providerId">;

export function isThreadForkable(sourceThread: ForkableThread | null): boolean {
  if (sourceThread === null || sourceThread.environmentId === null) {
    return false;
  }
  if (!isAgentProviderId(sourceThread.providerId)) {
    return false;
  }
  return getBuiltInAgentProviderInfo(sourceThread.providerId).capabilities
    .supportsFork;
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
}: BuildForkThreadRequestArgs): AppCreateThreadRequest | null {
  if (
    !isThreadForkable({
      environmentId,
      providerId,
    })
  ) {
    return null;
  }

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
