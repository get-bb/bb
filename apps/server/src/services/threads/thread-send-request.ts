import type { Thread } from "@bb/domain";
import type {
  SendMessageRequest,
  SendMessageResponse,
} from "@bb/server-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { attemptDispatch } from "./dispatch-attempt.js";

interface AcceptThreadSendRequestArgs {
  payload: SendMessageRequest;
  thread: Thread;
}

/**
 * Takes a public `send` request (the `/threads/:id/send` route, `bb thread
 * tell`, `sdk.threads.send`) and runs it through the dispatch checkpoint.
 *
 * There is nothing left here to decide. What used to be a four-way routing
 * decision — queue it, defer it behind an interaction, hold it back, or
 * send it — was four spellings of "this cannot run yet", and the checkpoint
 * answers all four with one typed wait on one queued row. So this function's
 * whole job is now to translate the attempt's outcome into the wire response.
 */
export async function acceptThreadSendRequest(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: AcceptThreadSendRequestArgs,
): Promise<SendMessageResponse> {
  const outcome = await attemptDispatch(deps, {
    thread: args.thread,
    payload: args.payload,
    source: { kind: "inline" },
    queuePayload: { kind: "inline" },
    origin: null,
    originPluginId: null,
    startedOnBehalfOf: null,
    trigger: "user",
  });
  if (outcome.kind === "dispatched") {
    return { ok: true, delivery: "sent" };
  }
  return {
    ok: true,
    delivery: "queued",
    queuedMessageId: outcome.entry.id,
    // A queued row's `waitingOn` is null only when a drain cleared its wait
    // and is about to re-attempt it — a state this row, just written by the
    // attempt above, cannot be in. The fallback narrows the type honestly.
    waitingOn: outcome.entry.waitingOn ?? { kind: "thread-busy" },
    sendAt: outcome.entry.sendAt,
  };
}
