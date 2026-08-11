import type { ThreadRuntimeDisplayStatus } from "@bb/domain";

export interface SentMessageEditAvailability {
  activeBackgroundAgentCount: number;
  activeBackgroundCommandCount: number;
  activeWorkflowCount: number;
  archivedAt: number | null;
  deletedAt: number | null;
  hasPendingInteraction: boolean;
  isExperimentEnabled: boolean;
  isEditSessionActive: boolean;
  isMutationPending: boolean;
  isTimelinePending: boolean;
  queuedMessageCount: number;
  providerId: string;
  runtimeDisplayStatus: ThreadRuntimeDisplayStatus;
}

/**
 * Client-side affordance policy for the UX prototype. The eventual mutation
 * must repeat the full eligibility check on the server before changing state.
 */
export function canStartSentMessageEdit({
  activeBackgroundAgentCount,
  activeBackgroundCommandCount,
  activeWorkflowCount,
  archivedAt,
  deletedAt,
  hasPendingInteraction,
  isExperimentEnabled,
  isEditSessionActive,
  isMutationPending,
  isTimelinePending,
  queuedMessageCount,
  providerId,
  runtimeDisplayStatus,
}: SentMessageEditAvailability): boolean {
  return (
    isExperimentEnabled &&
    (providerId === "claude-code" ||
      providerId === "codex" ||
      providerId === "pi") &&
    runtimeDisplayStatus === "idle" &&
    archivedAt === null &&
    deletedAt === null &&
    !hasPendingInteraction &&
    !isEditSessionActive &&
    !isMutationPending &&
    !isTimelinePending &&
    queuedMessageCount === 0 &&
    activeWorkflowCount === 0 &&
    activeBackgroundAgentCount === 0 &&
    activeBackgroundCommandCount === 0
  );
}

export function shouldDiscardSentMessageEdit(args: {
  currentThreadId: string | null;
  editThreadId: string | null;
  isTimelineLoading: boolean;
  targetStillPresent: boolean;
}): boolean {
  return (
    args.editThreadId !== null &&
    args.editThreadId === args.currentThreadId &&
    !args.isTimelineLoading &&
    !args.targetStillPresent
  );
}
