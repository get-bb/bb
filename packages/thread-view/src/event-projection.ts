import type { ActiveThinking } from "@bb/domain";
import type { AcceptedClientRequestContext } from "./accepted-client-request-context.js";
import type {
  BuildEventProjectionMessagesOptions,
  EventProjectionMessage,
  EventProjectionWorkflowMessage,
} from "./event-projection-message.js";

export type EventProjectionTurnStatus =
  | "pending"
  | "completed"
  | "error"
  | "interrupted";

export type EventProjectionTurnMessageDetail = "summary" | "full";

interface EventProjectionState {
  activeThinking: ActiveThinking | null;
  activeWorkflows: EventProjectionWorkflowMessage[];
  activeBackgroundCommands: EventProjectionWorkflowMessage[];
}

export interface BuildEventProjectionOptions extends BuildEventProjectionMessagesOptions {
  acceptedClientRequestContext?: AcceptedClientRequestContext;
  turnMessageDetail: EventProjectionTurnMessageDetail;
}

export type EventProjectionEntry =
  | EventProjectionMessageEntry
  | EventProjectionTurnEntry;

interface EventProjectionMessageEntry {
  kind: "projected-message";
  message: EventProjectionMessage;
}

interface EventProjectionTurnEntry {
  kind: "turn";
  turn: EventProjectionTurn;
}

export interface EventProjectionTurn {
  turnId: string;
  threadId: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  startedAt: number;
  createdAt: number;
  completedAt: number | null;
  status: EventProjectionTurnStatus;
  summaryCount: number;
  externalUserBoundarySeqs?: number[];
  terminalMessage?: EventProjectionMessage;
  messages?: EventProjectionMessage[];
}

export interface EventProjection {
  entries: EventProjectionEntry[];
  state: EventProjectionState;
}
