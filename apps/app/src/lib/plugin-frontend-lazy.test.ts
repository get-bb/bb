import { describe, expect, it, vi } from "vitest";
import { createRetryingModuleLoader } from "./plugin-frontend-lazy";

describe("createRetryingModuleLoader", () => {
  it("refetches after a rejection instead of replaying it", async () => {
    // The plugin runtime lives in a lazily fetched chunk. A caching loader
    // that kept the rejected promise would leave plugin UI dead for the rest
    // of the page's life after one flaky chunk fetch.
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("chunk fetch failed"))
      .mockResolvedValue("module");
    const loader = createRetryingModuleLoader(load);

    await expect(loader()).rejects.toThrow("chunk fetch failed");
    await expect(loader()).resolves.toBe("module");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("loads once and shares the result across concurrent callers", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("module");
    const loader = createRetryingModuleLoader(load);

    const [first, second] = await Promise.all([loader(), loader()]);

    expect(first).toBe("module");
    expect(second).toBe("module");
    // Boot and a realtime reconcile can race on the first page load; the
    // chunk must not be fetched twice.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps serving the loaded module without refetching", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("module");
    const loader = createRetryingModuleLoader(load);

    await loader();
    await loader();

    expect(load).toHaveBeenCalledTimes(1);
  });
});
