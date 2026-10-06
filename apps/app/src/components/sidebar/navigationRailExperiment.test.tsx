// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultExperiments } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useNavigationRailExperiment } from "./navigationRailExperiment";

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useSystemRealtimeSubscription: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it("keeps the rail on reload while config loads, then honors and remembers a disabled rail", async () => {
  const config = vi
    .spyOn(sdk.system, "config")
    .mockResolvedValue(
      makeSystemConfig({
        experiments: { ...defaultExperiments, navigationRail: true },
      }),
    );
  const first = renderHook(useNavigationRailExperiment, {
    wrapper: createQueryClientTestHarness().wrapper,
  });
  await waitFor(() => expect(first.result.current).toBe(true));
  first.unmount();

  let resolveConfig: (
    value: ReturnType<typeof makeSystemConfig>,
  ) => void = () => {};
  config.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveConfig = resolve;
      }),
  );
  const reload = renderHook(useNavigationRailExperiment, {
    wrapper: createQueryClientTestHarness().wrapper,
  });
  expect(reload.result.current).toBe(true);
  resolveConfig(makeSystemConfig());
  await waitFor(() => expect(reload.result.current).toBe(false));
  reload.unmount();

  config.mockImplementation(() => new Promise(() => {}));
  const disabledReload = renderHook(useNavigationRailExperiment, {
    wrapper: createQueryClientTestHarness().wrapper,
  });
  expect(disabledReload.result.current).toBe(false);
});
