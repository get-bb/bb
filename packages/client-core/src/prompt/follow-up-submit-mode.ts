export type FollowUpBlockedReason =
  | "loading-execution-options"
  | "loading-pending-interactions"
  | "pending-interaction"
  | "unavailable";

/**
 * `queue-while-stopping` is its own arm rather than a `queue` with the stop
 * button omitted. A composer in this state must not offer to stop a run that
 * is already stopping, and must not steer on Enter — there is no turn left to
 * steer — so the two differ in more than an affordance. What they share is the
 * only thing that matters to the user: the message is accepted and runs next.
 */
export type FollowUpSubmitMode =
  | { kind: "ready" }
  | { kind: "queue"; onStop: () => void }
  | { kind: "queue-while-stopping" }
  | { kind: "blocked"; reason: FollowUpBlockedReason };
