import {
  createStandaloneBuiltinCompactCommandInput,
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
import { attemptDispatch } from "./dispatch-attempt.js";
import { requireThreadCommandEnvironment } from "./thread-command-environment.js";
import { ensureThreadIsWritable, sendThreadMessage } from "./thread-send.js";
import { assertThreadHostAcceptsWork } from "./thread-host-admission.js";
import { runWithTurnTrace } from "../system/turn-trace.js";

interface AcceptThreadSendRequestArgs {
  payload: SendMessageRequest;
  thread: Thread;
}

export async function acceptThreadSendRequest(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: AcceptThreadSendRequestArgs,
): Promise<SendMessageResponse> {
  assertThreadHostAcceptsWork(deps.db, args.thread);
  const { compactFirst, ...request } = args.payload;
  if (isStandaloneBuiltinClearCommand(request.input)) {
    if (compactFirst) throwInvalidCompactFirst("cannot clear the context");
    const environment = await requireThreadCommandEnvironment(deps, {
      thread: args.thread,
    });
    await sendThreadMessage(deps, {
      environment,
      payload: request,
      thread: args.thread,
      trigger: "user",
    });
    return { ok: true, delivery: "sent" };
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
    await compactThreadContext(deps, args.thread);
  }
  const payload: SendMessageRequest = compactFirst
    ? { ...request, mode: "queue-if-active" }
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
        origin: null,
        originPluginId: null,
        startedOnBehalfOf: null,
        trigger: "user",
      }),
  );
  if (outcome.kind === "dispatched") {
    return { ok: true, delivery: "sent" };
  }
  return {
    ok: true,
    delivery: "queued",
    queuedMessage: outcome.entry,
  };
}

function throwInvalidCompactFirst(reason: string): never {
  throw new ApiError(400, "invalid_request", `compactFirst ${reason}`);
}

export async function compactThreadContext(
  deps: LoggedPendingInteractionWorkSessionDeps,
  thread: Thread,
): Promise<void> {
  ensureThreadIsWritable(thread);
  if (!deps.providerRegistry.supportsManualCompaction(thread.providerId)) {
    throw new ApiError(
      409,
      "invalid_request",
      `Provider "${thread.providerId}" does not support manual context compaction`,
    );
  }
  if (thread.status !== "idle" && thread.status !== "error") {
    throw new ApiError(
      409,
      "invalid_request",
      "Context can only be compacted while the thread is idle or errored",
    );
  }

  const environment = await requireThreadCommandEnvironment(deps, { thread });
  await sendThreadMessage(deps, {
    environment,
    payload: {
      input: createStandaloneBuiltinCompactCommandInput(),
      mode: "start",
    },
    thread,
    trigger: "user",
  });
}
