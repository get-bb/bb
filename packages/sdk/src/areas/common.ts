import type {
  SystemExecutionOptionsQuery,
  SystemExecutionOptionsResponse,
} from "@bb/server-contract";
import type { BbSdkTransport } from "../transport.js";

export interface CreateSdkAreaArgs {
  transport: BbSdkTransport;
}

type SignalRequestOptions = { init: { signal: AbortSignal } };

export function signalRequestArgs(
  signal: AbortSignal | undefined,
): [] | [SignalRequestOptions] {
  return signal === undefined ? [] : [{ init: { signal } }];
}

export async function readExecutionOptions(
  transport: BbSdkTransport,
  input: SystemExecutionOptionsQuery & { signal?: AbortSignal },
): Promise<SystemExecutionOptionsResponse> {
  return transport.readJson(
    transport.api.v1.system["execution-options"].$get(
      {
        query: {
          environmentId: input.environmentId,
          hostId: input.hostId,
          providerId: input.providerId,
        },
      },
      ...signalRequestArgs(input.signal),
    ),
  );
}
