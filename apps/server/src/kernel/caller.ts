import { AsyncLocalStorage } from "node:async_hooks";
import { isRawThreadId } from "@bb/domain";
import type { CallerDoor, OperationCaller } from "@bb/operations";
import { APP_SURFACE_HEADER_NAME } from "@bb/config/app-surface";
import {
  getGateAuthKind,
  type GateAuthHeaderReader,
} from "../request-context.js";

export const OPERATION_DOOR_HEADER = "x-bb-door";
export const OPERATION_THREAD_HEADER = "x-bb-thread-id";

const storage = new AsyncLocalStorage<OperationCaller>();

export function currentOperationCaller(): OperationCaller | null {
  return storage.getStore() ?? null;
}

export function runAsOperationCaller<T>(
  caller: OperationCaller,
  work: () => T,
): T {
  return storage.run(caller, work);
}

function requestThread(header: string | undefined): string | null {
  const value = header?.trim();
  return value !== undefined && isRawThreadId(value) ? value : null;
}

function requestDoor(
  context: GateAuthHeaderReader,
  thread: string | null,
): CallerDoor {
  if (thread !== null) return "agent";
  const declared = context.req.header(OPERATION_DOOR_HEADER);
  if (declared === "cli" || declared === "app") return declared;
  if (context.req.header(APP_SURFACE_HEADER_NAME) !== undefined) return "app";
  return "http";
}

export function callerFromRequest(
  context: GateAuthHeaderReader,
): OperationCaller {
  const thread = requestThread(context.req.header(OPERATION_THREAD_HEADER));
  return {
    user: getGateAuthKind(context) === "machine" ? "machine" : "owner",
    door: requestDoor(context, thread),
    thread,
    via: [],
  };
}
