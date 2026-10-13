export interface ExternalUserBoundaryTurnSpan {
  completionSequence: number | null;
  sequenceStart: number;
  turnId: string;
}

export interface ExternalUserBoundaryMessage {
  sequence: number;
  turnId: string | null;
}

export function isExternalUserBoundaryForTurn(
  turn: ExternalUserBoundaryTurnSpan,
  message: ExternalUserBoundaryMessage,
): boolean {
  return (
    message.turnId !== turn.turnId &&
    message.sequence > turn.sequenceStart &&
    (turn.completionSequence === null ||
      message.sequence < turn.completionSequence)
  );
}
