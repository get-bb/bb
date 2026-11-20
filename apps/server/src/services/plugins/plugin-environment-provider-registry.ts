import type { NormalizedPluginEnvironmentComposition } from "@get-bb/plugin-sdk/internal/host-policy";
import type { NormalizedPluginEnvironmentProvider } from "@get-bb/plugin-sdk/internal/host-policy";
import {
  DEFAULT_PLUGIN_HOOK_TIMEOUT_MS,
  invokeBridgedProvider,
  type PluginHookInvocation,
} from "./plugin-hook-registry.js";

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
    record: PluginEnvironmentProviderRecord,
    label: string,
    run: () => Promise<T>,
  ): Promise<PluginHookInvocation<T>>;
  readonly decisionTimeoutMs: number;
}

let bridge: PluginEnvironmentProviderBridge | undefined;

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
  return invokeBridgedProvider(bridge, record, label, run);
}

export function environmentProviderDecisionTimeoutMs(): number {
  return bridge?.decisionTimeoutMs ?? DEFAULT_PLUGIN_HOOK_TIMEOUT_MS;
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
