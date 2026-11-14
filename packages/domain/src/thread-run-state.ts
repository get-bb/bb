export const threadTurnRequestKindValues = [
  "thread-start",
  "new-turn",
  "steer",
] as const;
export type ThreadTurnRequestKind =
  (typeof threadTurnRequestKindValues)[number];

export const threadTurnRequestPhaseValues = [
  "sent",
  "accepted",
  "unconfirmed",
] as const;
export type ThreadTurnRequestPhase =
  (typeof threadTurnRequestPhaseValues)[number];

export const heldTurnCompletionStatusValues = [
  "completed",
  "failed",
  "interrupted",
] as const;
export type HeldTurnCompletionStatus =
  (typeof heldTurnCompletionStatusValues)[number];
