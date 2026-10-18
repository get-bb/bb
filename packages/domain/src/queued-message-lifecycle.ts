import { z } from "zod";

export const queuedMessageStateValues = [
  "queued",
  "scheduled",
  "waiting",
  "failed_retrying",
  "failed_exhausted",
  "claimed",
] as const;
export const queuedMessageStateSchema = z.enum(queuedMessageStateValues);
export type QueuedMessageState = z.infer<typeof queuedMessageStateSchema>;

export const QUEUED_MESSAGE_FAILED_STATES = [
  "failed_retrying",
  "failed_exhausted",
] as const satisfies readonly QueuedMessageState[];

export const QUEUED_MESSAGE_AUTOMATICALLY_DRAINABLE_STATES = [
  "queued",
  "scheduled",
  "waiting",
] as const satisfies readonly QueuedMessageState[];

export type QueuedMessageLifecycleEventType =
  | "queue.created"
  | "wait.recorded"
  | "wait.cleared"
  | "dispatch.claimed"
  | "claim.released"
  | "drain.failed";

export type QueuedMessageLifecycleFrom = QueuedMessageState | "new";

const RESTING_STATES = [
  "queued",
  "scheduled",
  "waiting",
  "failed_retrying",
  "failed_exhausted",
] as const satisfies readonly QueuedMessageState[];

const WAIT_RECORDED_TARGETS = [
  "waiting",
  "scheduled",
] as const satisfies readonly QueuedMessageState[];

const UNFAILED_RESTING_TRANSITIONS = {
  "wait.recorded": WAIT_RECORDED_TARGETS,
  "wait.cleared": ["queued"],
  "dispatch.claimed": ["claimed"],
  "drain.failed": QUEUED_MESSAGE_FAILED_STATES,
} as const satisfies Partial<
  Record<QueuedMessageLifecycleEventType, readonly QueuedMessageState[]>
>;

export const QUEUED_MESSAGE_LIFECYCLE: Record<
  QueuedMessageLifecycleFrom,
  Partial<
    Record<QueuedMessageLifecycleEventType, readonly QueuedMessageState[]>
  >
> = {
  new: { "queue.created": ["queued", "waiting", "scheduled"] },
  queued: UNFAILED_RESTING_TRANSITIONS,
  scheduled: UNFAILED_RESTING_TRANSITIONS,
  waiting: UNFAILED_RESTING_TRANSITIONS,
  failed_retrying: {
    "wait.recorded": WAIT_RECORDED_TARGETS,
    "wait.cleared": ["failed_retrying"],
    "dispatch.claimed": ["claimed"],
    "drain.failed": QUEUED_MESSAGE_FAILED_STATES,
  },
  failed_exhausted: {
    "wait.recorded": WAIT_RECORDED_TARGETS,
    "wait.cleared": ["failed_exhausted"],
    "dispatch.claimed": ["claimed"],
    "drain.failed": QUEUED_MESSAGE_FAILED_STATES,
  },
  claimed: {
    "wait.recorded": WAIT_RECORDED_TARGETS,
    "claim.released": RESTING_STATES,
  },
};

export interface QueuedMessageStateFacts {
  claimed: boolean;
  failed: boolean;
  retryBooked: boolean;
  scheduled: boolean;
  waiting: boolean;
}

export function queuedMessageStateFor(
  facts: QueuedMessageStateFacts,
): QueuedMessageState {
  if (facts.claimed) return "claimed";
  if (facts.failed) {
    return facts.retryBooked ? "failed_retrying" : "failed_exhausted";
  }
  if (facts.scheduled) return "scheduled";
  return facts.waiting ? "waiting" : "queued";
}

export function isQueuedMessageFailedState(
  state: QueuedMessageState,
): state is (typeof QUEUED_MESSAGE_FAILED_STATES)[number] {
  return state === "failed_retrying" || state === "failed_exhausted";
}

interface EvaluateQueuedMessageTransitionArgs {
  event: QueuedMessageLifecycleEventType;
  from: QueuedMessageLifecycleFrom;
  to: QueuedMessageState;
}

type QueuedMessageTransitionEvaluation =
  | { to: QueuedMessageState }
  | { illegal: string };

export function evaluateQueuedMessageTransition(
  args: EvaluateQueuedMessageTransitionArgs,
): QueuedMessageTransitionEvaluation {
  const targets = QUEUED_MESSAGE_LIFECYCLE[args.from][args.event];
  if (targets === undefined) {
    return { illegal: `no ${args.event} transition from ${args.from}` };
  }
  if (!targets.includes(args.to)) {
    return {
      illegal: `${args.event} from ${args.from} cannot land on ${args.to}`,
    };
  }
  return { to: args.to };
}
