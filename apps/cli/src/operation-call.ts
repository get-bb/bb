import type { BbSdkTransport } from "@bb/sdk/node";
import {
  createOperationCaller as createSdkOperationCaller,
  type OperationCaller,
} from "@bb/sdk/operation-call";
import { createCliTransport } from "./client.js";

export function createOperationCaller(baseUrl: string): OperationCaller {
  let caller: OperationCaller | null = null;
  const resolve = (): OperationCaller => {
    if (caller !== null) return caller;
    const transport: BbSdkTransport = createCliTransport(baseUrl);
    caller = createSdkOperationCaller(transport);
    return caller;
  };
  return {
    call: (name, input, signal) => resolve().call(name, input, signal),
    send: (name, input, signal) => resolve().send(name, input, signal),
  };
}
