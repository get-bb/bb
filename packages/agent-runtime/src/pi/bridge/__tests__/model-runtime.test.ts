import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadConfiguredPiServices, firstRuntime, secondRuntime } = vi.hoisted(
  () => {
    const firstRuntime = { getModel: vi.fn() };
    const secondRuntime = { getModel: vi.fn() };
    return {
      firstRuntime,
      loadConfiguredPiServices: vi.fn(
        async ({
          cwd,
        }: {
          cwd: string;
        }): Promise<{
          configErrors: string[];
          services: { modelRuntime: { getModel: unknown } };
        }> => ({
          configErrors: [],
          services: {
            modelRuntime:
              cwd === "/tmp/project-one" ? firstRuntime : secondRuntime,
          },
        }),
      ),
      secondRuntime,
    };
  },
);

vi.mock("../configured-services.js", () => ({
  loadConfiguredPiServices,
}));

import {
  getPiModelRuntime,
  resetPiModelRuntimesForTests,
} from "../model-runtime.js";

describe("Pi bridge model runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPiModelRuntimesForTests();
  });

  it("caches a configured model runtime for each requested project", async () => {
    const first = await getPiModelRuntime("/tmp/project-one");
    const firstAgain = await getPiModelRuntime("/tmp/project-one");
    const second = await getPiModelRuntime("/tmp/project-two");

    expect(first).toBe(firstRuntime);
    expect(firstAgain).toBe(firstRuntime);
    expect(second).toBe(secondRuntime);
    expect(loadConfiguredPiServices).toHaveBeenCalledTimes(2);
    expect(loadConfiguredPiServices).toHaveBeenNthCalledWith(1, {
      cwd: "/tmp/project-one",
    });
    expect(loadConfiguredPiServices).toHaveBeenNthCalledWith(2, {
      cwd: "/tmp/project-two",
    });
  });

  // A broken third-party extension used to reject here, so the picker lost
  // every model instead of the one provider that failed to register.
  it("still returns the runtime when the Pi configuration reports errors", async () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    loadConfiguredPiServices.mockResolvedValueOnce({
      configErrors: ['Failed to load Pi extension "broken.ts": boom'],
      services: { modelRuntime: firstRuntime },
    });

    await expect(getPiModelRuntime("/tmp/project-one")).resolves.toBe(
      firstRuntime,
    );
    expect(write).toHaveBeenCalledWith(
      'pi bridge: Failed to load Pi extension "broken.ts": boom\n',
    );
    write.mockRestore();
  });

  // The bridge outlives the broken configuration, so a memoized partial
  // runtime would hide the repaired extension until the process restarts.
  it("reloads after a partial load so a repaired extension appears", async () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    loadConfiguredPiServices.mockResolvedValueOnce({
      configErrors: ['Failed to load Pi extension "broken.ts": boom'],
      services: { modelRuntime: secondRuntime },
    });

    await expect(getPiModelRuntime("/tmp/project-one")).resolves.toBe(
      secondRuntime,
    );
    await expect(getPiModelRuntime("/tmp/project-one")).resolves.toBe(
      firstRuntime,
    );
    expect(loadConfiguredPiServices).toHaveBeenCalledTimes(2);
    write.mockRestore();
  });

  it("keeps the memo when the configuration is clean", async () => {
    await getPiModelRuntime("/tmp/project-one");
    await getPiModelRuntime("/tmp/project-one");

    expect(loadConfiguredPiServices).toHaveBeenCalledOnce();
  });

  it("drops the memo when the services fail to build", async () => {
    loadConfiguredPiServices.mockRejectedValueOnce(new Error("no agent dir"));

    await expect(getPiModelRuntime("/tmp/project-one")).rejects.toThrow(
      "no agent dir",
    );
    await expect(getPiModelRuntime("/tmp/project-one")).resolves.toBe(
      firstRuntime,
    );
  });
});
