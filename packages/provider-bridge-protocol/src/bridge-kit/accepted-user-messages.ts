import type { ClientTurnRequestId, ThreadEvent } from "@bb/domain";
import { turnScope } from "@bb/domain";

export interface AcceptedUserMessageState {
  pendingAcceptedUserMessages: AcceptedUserMessage[];
}

export interface AcceptedUserMessage {
  clientRequestId: ClientTurnRequestId;
}

export interface CreateAcceptedUserMessageArgs {
  clientRequestId: ClientTurnRequestId;
}

export interface BuildAcceptedUserMessageEventArgs extends CreateAcceptedUserMessageArgs {
  providerThreadId: string;
  threadId: string;
  turnId: string;
}

export interface QueueAcceptedUserMessageArgs<
  TState extends AcceptedUserMessageState,
> extends CreateAcceptedUserMessageArgs {
  state: TState;
}

export interface DrainAcceptedUserMessagesArgs<
  TState extends AcceptedUserMessageState,
> {
  events: ThreadEvent[];
  providerThreadId: string;
  state: TState;
  threadId: string;
  turnId: string;
}

function createAcceptedUserMessage(
  args: CreateAcceptedUserMessageArgs,
): AcceptedUserMessage {
  return { clientRequestId: args.clientRequestId };
}

export function buildAcceptedUserMessageEvent(
  args: BuildAcceptedUserMessageEventArgs,
): ThreadEvent[] {
  const accepted = createAcceptedUserMessage(args);
  return [
    {
      type: "turn/input/accepted",
      threadId: args.threadId,
      providerThreadId: args.providerThreadId,
      scope: turnScope(args.turnId),
      clientRequestId: accepted.clientRequestId,
    },
  ];
}

export function queueAcceptedUserMessage<
  TState extends AcceptedUserMessageState,
>(args: QueueAcceptedUserMessageArgs<TState>): void {
  const accepted = createAcceptedUserMessage(args);
  args.state.pendingAcceptedUserMessages.push(accepted);
}

export function drainAcceptedUserMessages<
  TState extends AcceptedUserMessageState,
>(args: DrainAcceptedUserMessagesArgs<TState>): void {
  while (args.state.pendingAcceptedUserMessages.length > 0) {
    const accepted = args.state.pendingAcceptedUserMessages.shift();
    if (!accepted) {
      return;
    }
    args.events.push({
      type: "turn/input/accepted",
      threadId: args.threadId,
      providerThreadId: args.providerThreadId,
      scope: turnScope(args.turnId),
      clientRequestId: accepted.clientRequestId,
    });
  }
}
