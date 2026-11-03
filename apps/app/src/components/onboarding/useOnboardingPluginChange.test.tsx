// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { BbHttpError } from "@bb/sdk/browser";
import type { PluginInstallJob } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCatalogPluginInstall } from "@/hooks/queries/plugin-install-job-queries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import { useOnboardingPluginChange } from "./useOnboardingPluginChange";

const plugins = vi.hoisted(() => ({
  setEnabled: vi.fn(),
  jobs: new Map<string, PluginInstallJob>(),
}));

vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent: vi.fn() }));
vi.mock("@/components/plugin/useSetPluginEnabled", () => ({
  useSetPluginEnabled: () => plugins.setEnabled,
}));
vi.mock("@/hooks/cache-owners/plugin-cache-owner", () => ({
  applyPluginInstallJob: vi.fn(),
}));
vi.mock("@/hooks/queries/plugin-install-job-queries", () => ({
  startCatalogPluginInstall: vi.fn(),
  usePluginInstallJob: (jobId: string | null) =>
    jobId === null ? null : (plugins.jobs.get(jobId) ?? null),
}));

afterEach(() => {
  cleanup();
  plugins.jobs.clear();
  vi.clearAllMocks();
});

function job(state: "running" | "failed"): PluginInstallJob {
  const fields = {
    id: "job_1",
    target: {
      kind: "catalog" as const,
      entryId: "workflows",
      marketplace: "bb",
    },
    displayName: "Workflows",
  };
  return state === "failed"
    ? { ...fields, state, error: "npm exited 1" }
    : { ...fields, state };
}

function renderChange(installed: boolean) {
  const { wrapper } = createQueryClientTestHarness();
  return renderHook(
    () =>
      useOnboardingPluginChange({
        onboardingEntry: "first_run",
        plugin: {
          pluginId: "workflows",
          entryId: "workflows",
          marketplace: "bb",
          installed,
        },
      }),
    { wrapper },
  );
}

function recorded() {
  return vi
    .mocked(recordTelemetryEvent)
    .mock.calls.map(([event]) => event.properties);
}

const base = {
  entry: "first_run",
  step: "plugins",
  resource_id: "workflows",
} as const;

describe("onboarding plugin changes", () => {
  it("records an install job that fails after it started", async () => {
    vi.mocked(startCatalogPluginInstall).mockResolvedValue(job("running"));
    plugins.jobs.set("job_1", job("running"));
    const view = renderChange(false);

    await act(() => view.result.current(true));
    expect(recorded()).toEqual([
      { ...base, operation: "install", outcome: "started" },
    ]);

    plugins.jobs.set("job_1", job("failed"));
    view.rerender();
    view.rerender();

    expect(recorded()).toEqual([
      { ...base, operation: "install", outcome: "started" },
      {
        ...base,
        operation: "install",
        outcome: "failed",
        failure_reason: "command_failed",
      },
    ]);
  });

  it("records why an install request was refused and rethrows it", async () => {
    const refused = new BbHttpError({
      body: null,
      code: "plugin_not_found",
      message: "Not found",
      status: 404,
    });
    vi.mocked(startCatalogPluginInstall).mockRejectedValue(refused);
    const view = renderChange(false);

    await expect(act(() => view.result.current(true))).rejects.toBe(refused);
    expect(recorded()).toEqual([
      { ...base, operation: "install", outcome: "started" },
      {
        ...base,
        operation: "install",
        outcome: "failed",
        failure_reason: "not_found",
      },
    ]);
  });

  it.each([
    [true, "enable"],
    [false, "disable"],
  ] as const)(
    "records switching an installed plugin %s as %s",
    async (enabled, operation) => {
      plugins.setEnabled.mockRejectedValueOnce(new Error("offline"));
      const view = renderChange(true);

      await expect(act(() => view.result.current(enabled))).rejects.toThrow(
        "offline",
      );
      plugins.setEnabled.mockResolvedValueOnce(undefined);
      await act(() => view.result.current(enabled));

      expect(recorded()).toEqual([
        { ...base, operation, outcome: "started" },
        { ...base, operation, outcome: "failed", failure_reason: "other" },
        { ...base, operation, outcome: "started" },
        { ...base, operation, outcome: "succeeded" },
      ]);
    },
  );
});
