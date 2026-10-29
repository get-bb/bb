import { QueryClient } from "@tanstack/react-query";
import type { PluginInstallJob } from "@bb/server-contract";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pluginInstallJobsQueryKey } from "@/hooks/queries/query-keys";
import {
  observeOnboardingPluginInstall,
  runOnboardingPluginAction,
} from "./onboarding-plugin-telemetry";

const recordTelemetryEvent = vi.hoisted(() => vi.fn());
const listJobs = vi.hoisted(() => vi.fn());
vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent }));
vi.mock("@/hooks/queries/plugin-client", () => ({
  createPluginsClient: () => ({ installJobs: { list: listJobs } }),
}));
const clients: QueryClient[] = [];
const queued: PluginInstallJob = {
  id: "job",
  displayName: "Private plugin",
  target: {
    kind: "catalog",
    entryId: "private-plugin",
    marketplace: "bb-community",
  },
  state: "queued",
};

beforeEach(() => {
  recordTelemetryEvent.mockClear();
  listJobs.mockReset();
  listJobs.mockResolvedValue([queued]);
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

it.each(["failed", "cancelled"] as const)(
  "observes %s after leaving the card without duplicate outcomes",
  async (state) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    clients.push(client);
    client.setQueryData(pluginInstallJobsQueryKey(), [queued]);
    observeOnboardingPluginInstall(client, queued, "replay");
    expect(recordTelemetryEvent).not.toHaveBeenCalled();
    const terminal: PluginInstallJob =
      state === "failed"
        ? { ...queued, state, error: "secret failure" }
        : { ...queued, state };
    client.setQueryData(pluginInstallJobsQueryKey(), [terminal]);
    client.setQueryData(pluginInstallJobsQueryKey(), [terminal]);
    expect(recordTelemetryEvent).toHaveBeenCalledTimes(1);
    expect(recordTelemetryEvent).toHaveBeenCalledWith({
      name: "onboarding_operation",
      properties: {
        entry: "replay",
        operation: "plugin_install",
        outcome: state,
        error_category: state === "failed" ? "job_failed" : null,
      },
    });
  },
);

it("records an unknown transport result then a later authoritative cancellation", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  client.setQueryData(pluginInstallJobsQueryKey(), [queued]);
  observeOnboardingPluginInstall(client, queued, "first_run");
  listJobs.mockRejectedValue(new Error("private transport detail"));
  await client.refetchQueries({ queryKey: pluginInstallJobsQueryKey() });
  client.setQueryData(pluginInstallJobsQueryKey(), [
    { ...queued, state: "cancelled" },
  ]);
  expect(
    recordTelemetryEvent.mock.calls.map(([event]) => event.properties.outcome),
  ).toEqual(["unknown", "cancelled"]);
});

it.each(["plugin_install", "plugin_enable"] as const)(
  "keeps request failures distinct for %s",
  async (operation) => {
    const failure = new Error("private request");
    await expect(
      runOnboardingPluginAction("first_run", operation, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(
      recordTelemetryEvent.mock.calls.map(([event]) => event.properties),
    ).toEqual([
      {
        entry: "first_run",
        operation,
        outcome: "started",
        error_category: null,
      },
      {
        entry: "first_run",
        operation,
        outcome: operation === "plugin_install" ? "unknown" : "failed",
        error_category: "request",
      },
    ]);
  },
);

it("does not mark an accepted install as succeeded", async () => {
  await runOnboardingPluginAction(
    "first_run",
    "plugin_install",
    async () => queued,
  );
  expect(
    recordTelemetryEvent.mock.calls.map(([event]) => event.properties.outcome),
  ).toEqual(["started"]);
});

it("records successful enable before unrelated refresh work", async () => {
  await runOnboardingPluginAction(
    "replay",
    "plugin_enable",
    async () => undefined,
  );
  expect(
    recordTelemetryEvent.mock.calls.map(([event]) => event.properties.outcome),
  ).toEqual(["started", "succeeded"]);
});
