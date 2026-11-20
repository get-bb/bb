import type { ServerAccessOrigin } from "@bb/domain";
import type { ServerAccessProviderDeclaration } from "@get-bb/plugin-sdk";

export interface ServerAccessProviderRecord {
  pluginId: string;
  provider: ServerAccessProviderDeclaration;
}

export interface ServerAccessBridge {
  list(): ServerAccessProviderRecord[];
  invoke<T>(
    record: ServerAccessProviderRecord,
    run: () => Promise<T>,
  ): Promise<T>;
}

let bridge: ServerAccessBridge | undefined;
let admittedOrigins: readonly ServerAccessOrigin[] = [];
let availableOrigins: ReadonlySet<string> = new Set();

export function setServerAccessBridge(
  value: ServerAccessBridge | undefined,
): void {
  bridge = value;
  setAdmittedServerAccessOrigins([]);
}

export function availableServerAccessOrigins(): ReadonlySet<string> {
  return availableOrigins;
}

export function admittedServerAccessOrigins(): readonly ServerAccessOrigin[] {
  return admittedOrigins;
}

export function setAdmittedServerAccessOrigins(
  origins: readonly ServerAccessOrigin[],
): void {
  admittedOrigins = origins;
  availableOrigins = new Set(origins.map((entry) => entry.origin));
}

export function listServerAccessProviders(): ServerAccessProviderRecord[] {
  return bridge?.list() ?? [];
}

export async function invokeServerAccessProvider<T>(
  record: ServerAccessProviderRecord,
  run: () => Promise<T>,
): Promise<T> {
  if (!bridge) throw new Error("Server access provider is unavailable");
  return bridge.invoke(record, run);
}

let recheckHandler: ((pluginId: string) => void) | undefined;

export function setServerAccessRecheckHandler(
  handler: ((pluginId: string) => void) | undefined,
): void {
  recheckHandler = handler;
}

export function requestServerAccessRecheck(pluginId: string): void {
  recheckHandler?.(pluginId);
}
