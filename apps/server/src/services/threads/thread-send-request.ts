import {
  isBlankPromptInput,
  isStandaloneBuiltinClearCommand,
  isStandaloneBuiltinCompactCommand,
  type Thread,
} from "@bb/domain";
import type {
  SendMessageRequest,
  SendMessageResponse,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import {
  CONTINUE_TURN_TEXT,
  continueTurnInput,
} from "./continue-turn-input.js";
import { attemptDispatch } from "./dispatch-attempt.js";
import { requireThreadCommandEnvironment } from "./thread-command-environment.js";
import { assertThreadHostAcceptsWork } from "./thread-host-admission.js";
import { runWithTurnTrace } from "../system/turn-trace.js";
import { assertProviderAcceptsPromptActions } from "../providers/provider-plan-command.js";

interface AcceptThreadSendRequestArgs {
  payload: SendMessageRequest;
  thread: Thread;
}

export async function acceptThreadSendRequest(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: AcceptThreadSendRequestArgs,
): Promise<SendMessageResponse> {
  assertThreadHostAcceptsWork(deps.db, args.thread);
  assertProviderAcceptsPromptActions(deps.providerRegistry, {
    input: args.payload.input,
    providerId: args.thread.providerId,
  });
  const { compactFirst, ...submitted } = args.payload;
  const request = isBlankPromptInput(submitted.input)
    ? continueThreadRequest(args.thread, submitted)
    : submitted;
  if (isStandaloneBuiltinClearCommand(request.input)) {
    if (compactFirst) throwInvalidCompactFirst("cannot clear the context");
    const environment = await requireThreadCommandEnvironment(deps, {
      thread: args.thread,
    });
    const outcome = await attemptDispatch(deps, {
      thread: args.thread,
      payload: request,
      source: { kind: "operation", environment },
      queuePayload: { kind: "inline" },
      pluginSubmission: null,
      systemNotice: null,
      origin: null,
      originPluginId: null,
      startedOnBehalfOf: null,
      trigger: "user",
    });
    return {
      ok: true,
      delivery: "sent",
      messageSequence:
        outcome.kind === "dispatched" ? outcome.messageSequence : null,
    };
  }

  if (compactFirst) {
    if (isStandaloneBuiltinCompactCommand(request.input)) {
      throwInvalidCompactFirst("needs a message to send after compacting");
    }
    if (request.sendAt !== undefined) {
      throwInvalidCompactFirst("cannot be scheduled with sendAt");
    }
    if (request.mode === "steer") {
      throwInvalidCompactFirst("cannot steer a turn");
    }
  }
  const payload: SendMessageRequest = compactFirst
    ? { ...request, mode: "queue-if-active", compactFirst }
    : request;

  const outcome = await runWithTurnTrace(
    deps,
    { threadId: args.thread.id },
    () =>
      attemptDispatch(deps, {
        thread: args.thread,
        payload,
        source: { kind: "inline" },
        queuePayload: { kind: "inline" },
        pluginSubmission: payload.pluginSubmission ?? null,
        systemNotice: null,
        origin: payload.originPluginId === undefined ? null : "plugin",
        originPluginId: payload.originPluginId ?? null,
        startedOnBehalfOf: null,
        trigger: "user",
      }),
  );
  if (outcome.kind === "dispatched") {
    return {
      ok: true,
      delivery: "sent",
      messageSequence: outcome.messageSequence,
    };
  }
  return {
    ok: true,
    delivery: "queued",
    queuedMessage: outcome.entry,
  };
}

function continueThreadRequest(
  thread: Thread,
  request: Omit<SendMessageRequest, "compactFirst">,
): Omit<SendMessageRequest, "compactFirst"> {
  if (thread.status !== "idle" && thread.status !== "error") {
    throw new ApiError(
      409,
      "invalid_request",
      "A blank message only continues an idle thread; type a message to steer or queue it",
    );
  }
  if (request.sendAt !== undefined) {
    throw new ApiError(
      400,
      "invalid_request",
      "A blank message cannot be scheduled with sendAt",
    );
  }
  return { ...request, input: continueTurnInput(CONTINUE_TURN_TEXT) };
}

function throwInvalidCompactFirst(reason: string): never {
  throw new ApiError(400, "invalid_request", `compactFirst ${reason}`);
}
