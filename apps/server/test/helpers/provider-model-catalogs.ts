import type { AvailableModel } from "@bb/domain";
import { vi } from "vitest";
import {
  createProviderModelCatalogStore,
  type ProviderModelCatalogStore,
} from "../../src/services/providers/provider-model-catalog-store.js";
import type { ProviderRegistration } from "../../src/services/providers/provider-registry.js";
import { availableModelFixture } from "./available-models.js";
import type { HostRpcHandlerResult } from "./host-rpc.js";
import type { TestAppHarness } from "./test-app.js";

export function installCatalogStore(
  harness: TestAppHarness,
  args: { clock: { now: number }; memoryEntryLimit?: number },
): ProviderModelCatalogStore {
  const store = createProviderModelCatalogStore({
    now: () => args.clock.now,
    pushCoalesceMs: 0,
    memoryEntryLimit: args.memoryEntryLimit ?? 256,
  });
  harness.deps.lifecycleDedupers.providerModelCatalogs = store;
  return store;
}

export function modelList(...modelIds: string[]): AvailableModel[] {
  return modelIds.map((model) => availableModelFixture({ model }));
}

export function catalogAnswer(
  models: AvailableModel[],
  selectedOnlyModels: AvailableModel[] = [],
): HostRpcHandlerResult {
  return { ok: true, result: { models, selectedOnlyModels } };
}

export function errorAnswer(errorCode: string): HostRpcHandlerResult {
  return { ok: false, errorCode, errorMessage: `model list ${errorCode}` };
}

export function healthAnswer(
  status: "ready" | "not_installed",
): HostRpcHandlerResult {
  return {
    ok: true,
    result: {
      supported: true,
      health: {
        status,
        statusMessage: null,
        accountEmail: null,
        planLabel: null,
        installedVersion: null,
        minimumSupportedVersion: null,
        canInstall: false,
        canUpdate: false,
        loginCommand: null,
      },
    },
  };
}

export function requireRegistration(
  harness: TestAppHarness,
  providerId: string,
): ProviderRegistration {
  const registration = harness.deps.providerRegistry.get(providerId);
  if (registration === null) {
    throw new Error(`Missing provider registration ${providerId}`);
  }
  return registration;
}

export function capturePushes(harness: TestAppHarness): string[] {
  const hostIds: string[] = [];
  harness.hub.onChangedMessage((message) => {
    if (
      message.entity === "host" &&
      message.changes.includes("provider-model-catalog-changed")
    ) {
      hostIds.push(message.id);
    }
  });
  return hostIds;
}

export function captureLogLines(harness: TestAppHarness) {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  harness.deps.logger = { ...harness.deps.logger, info, warn, error };
  return (message: string) =>
    (
      [
        ["info", info],
        ["warn", warn],
        ["error", error],
      ] as const
    ).flatMap(([level, log]) =>
      log.mock.calls.flatMap(([fields, logged]) =>
        logged === message ? [{ level, ...fields }] : [],
      ),
    );
}

export function settleTimers(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
