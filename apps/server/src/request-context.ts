import { AsyncLocalStorage } from "node:async_hooks";
import { getConnInfo } from "@hono/node-server/conninfo";
import {
  APP_SURFACE_HEADER_NAME,
  parseAppSurface,
  type AppSurface,
} from "@bb/config/app-surface";
import type { Context } from "hono";

export const TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY = "bbTrustedRemoteAddress";
export const GATE_AUTH_HEADER_NAME = "x-bb-gate-auth";
export const GATE_MACHINE_ID_HEADER_NAME = "x-bb-gate-machine-id";
export type GateAuthKind = "machine" | "session";

const connectIsRemoteStorage = new AsyncLocalStorage<boolean>();

export interface GateAuthHeaderReader {
  req: { header(name: string): string | undefined };
}

export interface TrustedRemoteAddressReader {
  get(key: typeof TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY): string | undefined;
}

declare module "hono" {
  interface ContextVariableMap {
    [TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY]: string | undefined;
  }
}

export function captureTrustedRemoteAddress(context: Context): void {
  try {
    context.set(
      TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY,
      getConnInfo(context).remote.address,
    );
  } catch {
    context.set(TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY, undefined);
  }
}

export function getTrustedRemoteAddress(
  context: TrustedRemoteAddressReader,
): string | undefined {
  return context.get(TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY);
}

export function getGateAuthKind(
  context: GateAuthHeaderReader,
): GateAuthKind | null {
  const value = context.req.header(GATE_AUTH_HEADER_NAME);
  return value === "machine" || value === "session" ? value : null;
}

export function getGateMachineId(context: GateAuthHeaderReader): string | null {
  const value = context.req.header(GATE_MACHINE_ID_HEADER_NAME)?.trim();
  return value ? value : null;
}

export function runWithConnectRemote<T>(
  connectIsRemote: boolean,
  callback: () => T,
): T {
  return connectIsRemoteStorage.run(connectIsRemote, callback);
}

export function getConnectIsRemote(): boolean {
  return connectIsRemoteStorage.getStore() ?? false;
}

export function resolveRequestAppSurface(
  context: Context,
  fallback: AppSurface,
): AppSurface {
  return (
    parseAppSurface(context.req.header(APP_SURFACE_HEADER_NAME)) ?? fallback
  );
}
