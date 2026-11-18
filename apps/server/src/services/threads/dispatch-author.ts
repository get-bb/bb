import type {
  DispatchRequester,
  StartedOnBehalfOf,
  ThreadTurnInitiator,
} from "@bb/domain";

interface ResolveDispatchAuthorArgs {
  retrying: boolean;
  systemNotice: boolean;
  senderThreadId: string | null;
  requestedBy: DispatchRequester | null;
}

export interface DispatchAuthor {
  initiator: ThreadTurnInitiator;
  senderThreadId: string | null;
}

export function resolveDispatchAuthor(
  args: ResolveDispatchAuthorArgs,
): DispatchAuthor {
  if (args.retrying || args.systemNotice) {
    return { initiator: "system", senderThreadId: null };
  }
  if (args.senderThreadId !== null) {
    return { initiator: "agent", senderThreadId: args.senderThreadId };
  }
  if (args.requestedBy !== null) {
    return {
      initiator: args.requestedBy.initiator,
      senderThreadId: args.requestedBy.senderThreadId,
    };
  }
  return { initiator: "user", senderThreadId: null };
}

export function resolveTurnAuthor(author: DispatchAuthor): DispatchAuthor {
  if (author.initiator === "user") {
    return { initiator: "user", senderThreadId: null };
  }
  return author;
}

export function startedOnBehalfOfRequester(
  requestedBy: DispatchRequester | null,
): StartedOnBehalfOf | null {
  if (requestedBy === null || requestedBy.initiator === "user") {
    return null;
  }
  return {
    initiator: requestedBy.initiator,
    senderThreadId: requestedBy.senderThreadId,
  };
}
