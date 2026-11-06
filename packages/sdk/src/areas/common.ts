import type {
  SystemExecutionOptionsQuery,
  SystemExecutionOptionsResponse,
} from "@bb/server-contract";
import type { OperationCaller } from "../operation-call.js";
import type { BbSdkTransport } from "../transport.js";

export interface CreateSdkAreaArgs {
  transport: BbSdkTransport;
  operations: OperationCaller;
}

type SignalRequestOptions = { init: { signal: AbortSignal } };

export function signalRequestArgs(
  signal: AbortSignal | undefined,
): [] | [SignalRequestOptions] {
  return signal === undefined ? [] : [{ init: { signal } }];
}

export function readExecutionOptions(
  operations: OperationCaller,
  input: Omit<SystemExecutionOptionsQuery, "preferCached"> & {
    preferCached?: boolean;
    signal?: AbortSignal;
  },
): Promise<SystemExecutionOptionsResponse> {
  return operations.call(
    "system.executionOptions",
    {
      environmentId: input.environmentId,
      hostId: input.hostId,
      projectId: input.projectId,
      providerId: input.providerId,
      selectedModel: input.selectedModel,
      preferCached:
        input.preferCached === undefined
          ? undefined
          : input.preferCached
            ? "true"
            : "false",
    },
    { signal: input.signal },
  );
}
