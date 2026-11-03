// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { BbHttpError } from "@bb/sdk/browser";
import type { PluginInstallJob } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCatalogPluginInstall } from "@/hooks/queries/plugin-install-job-queries";
import { makeInstalledPlugin } from "@/test/fixtures/plugins";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import {
  useOnboardingPluginChange,
  useOnboardingPluginInstallOutcomes,
} from "./useOnboardingPluginChange";

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
vi.mock("@/hooks/queries/plugin-install-job-queries", async (original) => ({
  ...(await original<
    typeof import("@/hooks/queries/plugin-install-job-queries")
  >()),
  startCatalogPluginInstall: vi.fn(),
  usePluginInstallJobs: () => ({ data: [...plugins.jobs.values()] }),
}));

afterEach(() => {
  cleanup();
  plugins.jobs.clear();
  vi.clearAllMocks();
});

function job(
  state: PluginInstallJob["state"],
  id = "job_1",
  entryId = "workflows",
): PluginInstallJob {
  const fields = {
    id,
    target: { kind: "catalog" as const, entryId, marketplace: "bb" },
    displayName: entryId,
  };
  switch (state) {
    case "succeeded":
      return {
        ...fields,
        state,
        plugin: makeInstalledPlugin({ id: entryId }),
      };
    case "failed":
      return { ...fields, state, error: "npm exited 1" };
    default:
      return { ...fields, state };
  }
}

function renderGuide() {
  const { wrapper } = createQueryClientTestHarness();
  const guide = renderHook(
    () => useOnboardingPluginInstallOutcomes("first_run"),
    { wrapper },
  );
  const renderCard = (pluginId: string, installed: boolean) =>
    renderHook(
      () =>
        useOnboardingPluginChange({
          onboardingEntry: "first_run",
          plugin: { pluginId, entryId: pluginId, marketplace: "bb", installed },
          trackInstall: guide.result.current,
        }),
      { wrapper },
    );
  const settle = (next: PluginInstallJob) => {
    plugins.jobs.set(next.id, next);
    guide.rerender();
    guide.rerender();
  };
  return { guide, renderCard, settle };
}

function renderChange(installed: boolean) {
  return renderGuide().renderCard("workflows", installed);
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
  it.each([
    ["succeeded", [{ ...base, operation: "install", outcome: "succeeded" }]],
    [
      "failed",
      [
        {
          ...base,
          operation: "install",
          outcome: "failed",
          failure_reason: "command_failed",
        },
      ],
    ],
    ["cancelled", []],
  ] as const)(
    "records a %s install job once after its card unmounts",
    async (state, outcomes) => {
      vi.mocked(startCatalogPluginInstall).mockResolvedValue(job("running"));
      plugins.jobs.set("job_1", job("running"));
      const { renderCard, settle } = renderGuide();
      const card = renderCard("workflows", false);

      await act(() => card.result.current(true));
      card.unmount();
      settle(job(state));
      settle(job(state));
      const remounted = renderCard("workflows", true);
      remounted.rerender();

      expect(recorded()).toEqual([
        { ...base, operation: "install", outcome: "started" },
        ...outcomes,
      ]);
    },
  );

  it("records each started job once while its card stays mounted", async () => {
    const { renderCard, settle } = renderGuide();
    const workflows = renderCard("workflows", false);
    const briefs = renderCard("briefs", false);
    vi.mocked(startCatalogPluginInstall).mockResolvedValueOnce(
      job("running", "job_1", "workflows"),
    );
    await act(() => workflows.result.current(true));
    vi.mocked(startCatalogPluginInstall).mockResolvedValueOnce(
      job("queued", "job_2", "briefs"),
    );
    await act(() => briefs.result.current(true));

    settle(job("failed", "job_2", "briefs"));
    settle(job("succeeded", "job_1", "workflows"));
    workflows.rerender();
    briefs.rerender();
    settle(job("succeeded", "job_1", "workflows"));

    expect(recorded()).toEqual([
      { ...base, operation: "install", outcome: "started" },
      {
        ...base,
        resource_id: "briefs",
        operation: "install",
        outcome: "started",
      },
      {
        ...base,
        resource_id: "briefs",
        operation: "install",
        outcome: "failed",
        failure_reason: "command_failed",
      },
      { ...base, operation: "install", outcome: "succeeded" },
    ]);
  });

  it("ignores jobs the guide did not start", () => {
    const { settle } = renderGuide();
    settle(job("succeeded", "job_9", "workflows"));
    expect(recorded()).toEqual([]);
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
