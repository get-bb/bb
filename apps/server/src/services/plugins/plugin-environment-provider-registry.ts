import type { NormalizedPluginEnvironmentComposition } from "@get-bb/plugin-sdk/internal/host-policy";
import type { NormalizedPluginEnvironmentProvider } from "@get-bb/plugin-sdk/internal/host-policy";
import type { PluginHookInvocation } from "./plugin-hook-registry.js";

export interface PluginEnvironmentProviderRecord {
  pluginId: string;
  provider: NormalizedPluginEnvironmentProvider;
  icon?: { bytes: Uint8Array; contentType: string; hash: string };
}

export interface PluginEnvironmentCompositionRecord {
  pluginId: string;
  composition: NormalizedPluginEnvironmentComposition;
  icon?: { bytes: Uint8Array; contentType: string; hash: string };
}
export interface PluginEnvironmentProviderBridge {
  listEnvironmentCompositions?(): PluginEnvironmentCompositionRecord[];
  listEnvironmentProviders(): PluginEnvironmentProviderRecord[];
  getEnvironmentProvider(
    id: string,
  ): PluginEnvironmentProviderRecord | undefined;
  invokeProvider<T>(
    pluginId: string,
    label: string,
    run: () => Promise<T>,
  ): Promise<PluginHookInvocation<T>>;
  readonly decisionTimeoutMs: number;
}

let bridge: PluginEnvironmentProviderBridge | undefined;
let recheckHandler: ((pluginId: string) => void) | undefined;

export function setPluginEnvironmentProviderBridge(
  next: PluginEnvironmentProviderBridge | undefined,
): void {
  bridge = next;
}

export function listEnvironmentCompositions(): PluginEnvironmentCompositionRecord[] {
  return bridge?.listEnvironmentCompositions?.() ?? [];
}

export function listEnvironmentProviders(): PluginEnvironmentProviderRecord[] {
  return bridge?.listEnvironmentProviders() ?? [];
}

export function getEnvironmentProvider(
  id: string,
): PluginEnvironmentProviderRecord | undefined {
  return bridge?.getEnvironmentProvider(id);
}

export async function invokeEnvironmentProvider<T>(
  record: PluginEnvironmentProviderRecord,
  label: string,
  run: () => Promise<T>,
): Promise<PluginHookInvocation<T>> {
  if (bridge === undefined) {
    return { ok: false, error: "plugin runtime is not available" };
  }
  return bridge.invokeProvider(record.pluginId, label, run);
}

export function environmentProviderDecisionTimeoutMs(): number {
  return bridge?.decisionTimeoutMs ?? 10_000;
}

export function setEnvironmentProviderRecheckHandler(
  handler: ((pluginId: string) => void) | undefined,
): void {
  recheckHandler = handler;
}

export function requestEnvironmentProviderRecheck(pluginId: string): void {
  recheckHandler?.(pluginId);
}

let provisioningRecheckHandler: ((threadId: string) => void) | undefined;

export function setEnvironmentProvisioningRecheckHandler(
  handler: ((threadId: string) => void) | undefined,
): void {
  provisioningRecheckHandler = handler;
}

export function requestEnvironmentProvisioningRecheck(threadId: string): void {
  provisioningRecheckHandler?.(threadId);
}
