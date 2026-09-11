import type { ServerAccessProviderDeclaration } from "@get-bb/plugin-sdk";

export interface ServerAccessProviderRecord {
  pluginId: string;
  provider: ServerAccessProviderDeclaration;
}

export interface ServerAccessBridge {
  list(): ServerAccessProviderRecord[];
  invoke<T>(pluginId: string, run: () => Promise<T>): Promise<T>;
}

let bridge: ServerAccessBridge | undefined;

export function setServerAccessBridge(
  value: ServerAccessBridge | undefined,
): void {
  bridge = value;
}

export function listServerAccessProviders(): ServerAccessProviderRecord[] {
  return bridge?.list() ?? [];
}

export async function invokeServerAccessProvider<T>(
  record: ServerAccessProviderRecord,
  run: () => Promise<T>,
): Promise<T> {
  if (!bridge) throw new Error("Server access provider is unavailable");
  return bridge.invoke(record.pluginId, run);
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
