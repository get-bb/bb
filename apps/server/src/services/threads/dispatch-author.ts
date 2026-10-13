import type { StartedOnBehalfOf, ThreadTurnInitiator } from "@bb/domain";

interface ResolveDispatchAuthorArgs {
  retrying: boolean;
  senderThreadId: string | null;
  startedOnBehalfOf: StartedOnBehalfOf | null;
}

interface DispatchAuthor {
  initiator: ThreadTurnInitiator;
  senderThreadId: string | null;
}

export function resolveDispatchAuthor(
  args: ResolveDispatchAuthorArgs,
): DispatchAuthor {
  if (args.retrying) {
    return { initiator: "system", senderThreadId: null };
  }
  if (args.senderThreadId !== null) {
    return { initiator: "agent", senderThreadId: args.senderThreadId };
  }
  if (args.startedOnBehalfOf !== null) {
    return {
      initiator: args.startedOnBehalfOf.initiator,
      senderThreadId: args.startedOnBehalfOf.senderThreadId,
    };
  }
  return { initiator: "user", senderThreadId: null };
}
