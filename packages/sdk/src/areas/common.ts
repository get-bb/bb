import type { BbSdkContext, BbSdkTransport } from "../transport.js";

export interface CreateSdkAreaArgs {
  context: BbSdkContext;
  transport: BbSdkTransport;
}

type SignalRequestOptions = { init: { signal: AbortSignal } };

export function signalRequestArgs(
  signal: AbortSignal | undefined,
): [] | [SignalRequestOptions] {
  return signal === undefined ? [] : [{ init: { signal } }];
}
