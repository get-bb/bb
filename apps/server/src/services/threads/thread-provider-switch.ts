import {
  getThread,
  getThreadExecutionOverride,
  listQueuedThreadMessages,
  setThreadExecutionOverride,
  updateThread,
} from "@bb/db";
import {
  THREAD_PROVIDER_COMMANDS_STATE_KIND,
  THREAD_SESSION_OPTIONS_STATE_KIND,
  THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND,
  threadScope,
  type ExtensionKind,
  type JsonValue,
  type ReasoningLevel,
  type Thread,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { requireThreadCommandEnvironment } from "./thread-command-environment.js";
import { clearThreadContext } from "./thread-context-clear.js";
import { resolveSystemExecutionOptionsForValidation } from "../system/execution-options.js";
import {
  appendThreadEventInTransaction,
  getLastExecutionOptions,
} from "./thread-events.js";
import { resolveThreadFallbackModel } from "./thread-execution-plan.js";

export async function switchThreadProvider(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    thread: Thread;
    providerId: string;
    model?: string;
    reasoningLevel?: ReasoningLevel;
  },
): Promise<Thread> {
  const { thread, providerId } = args;
  if (providerId === thread.providerId) {
    throw new ApiError(400, "invalid_request", "Choose a different provider");
  }
  if (listQueuedThreadMessages(deps.db, thread.id).length > 0) {
    throw new ApiError(
      409,
      "invalid_request",
      "Send or remove queued messages before changing providers",
    );
  }
  const environment = await requireThreadCommandEnvironment(deps, { thread });
  const catalog = await resolveSystemExecutionOptionsForValidation(
    deps,
    { environmentId: environment.id, providerId },
    args.model ?? null,
  );
  if (catalog.modelLoadError !== null) {
    throw new ApiError(
      503,
      "model_catalog_unavailable",
      `Unable to load ${providerId} models on this host`,
    );
  }
  const models = [...catalog.models, ...catalog.selectedOnlyModels];
  const selected = args.model
    ? models.find((candidate) => candidate.model === args.model)
    : (models.find((candidate) => candidate.isDefault) ?? models[0]);
  if (!selected) {
    throw new ApiError(
      400,
      "invalid_request",
      `Model ${args.model ?? "default"} is not available for ${providerId}`,
    );
  }
  const reasoningLevel = args.reasoningLevel ?? selected.defaultReasoningEffort;
  if (
    selected.supportedReasoningEfforts.length > 0 &&
    !selected.supportedReasoningEfforts.some(
      (effort) => effort.reasoningEffort === reasoningLevel,
    )
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      `Reasoning level ${reasoningLevel} is not available for ${selected.model}`,
    );
  }
  const previousModel =
    getThreadExecutionOverride(deps.db, thread.id)?.modelOverride ??
    getLastExecutionOptions(deps, thread.id)?.model ??
    resolveThreadFallbackModel(deps, thread) ??
    "previous model";
  await clearThreadContext(deps, {
    environment,
    thread,
    providerSwitch: {
      fromProviderId: thread.providerId,
      fromModel: previousModel,
      toProviderId: providerId,
      toModel: selected.model,
    },
    beforeCommitInTransaction: ({ tx }) => {
      if (listQueuedThreadMessages(tx, thread.id).length > 0) {
        throw new ApiError(
          409,
          "invalid_request",
          "Queued messages appeared while changing providers",
        );
      }
      updateThread(tx, deps.hub, thread.id, { providerId });
      setThreadExecutionOverride(tx, {
        threadId: thread.id,
        modelOverride: selected.model,
        reasoningLevelOverride: reasoningLevel,
      });
      const resetStates: { kind: ExtensionKind; payload: JsonValue }[] = [
        {
          kind: THREAD_PROVIDER_COMMANDS_STATE_KIND,
          payload: { commands: [] },
        },
        { kind: THREAD_SESSION_OPTIONS_STATE_KIND, payload: { options: [] } },
        {
          kind: THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND,
          payload: { selections: {} },
        },
      ];
      for (const { kind, payload } of resetStates) {
        appendThreadEventInTransaction(tx, {
          threadId: thread.id,
          environmentId: thread.environmentId,
          type: "thread/extensionState/updated",
          scope: threadScope(),
          data: { providerThreadId: "", kind, payload },
        });
      }
    },
  });
  const updated = getThread(deps.db, thread.id);
  if (!updated) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  return updated;
}
