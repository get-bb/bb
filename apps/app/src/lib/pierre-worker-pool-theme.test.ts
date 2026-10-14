import type { WorkerPoolManager } from "@pierre/diffs/worker";
import { describe, expect, it, vi } from "vitest";
import { syncPierreWorkerPoolTheme } from "./pierre-worker-pool-theme";

const CURRENT = { dark: "pierre-dark", light: "pierre-light" };

function createFakePool() {
  const setRenderOptions = vi.fn<WorkerPoolManager["setRenderOptions"]>(() =>
    Promise.resolve(),
  );
  return { pool: { setRenderOptions }, setRenderOptions };
}

describe("syncPierreWorkerPoolTheme", () => {
  it("does not call setRenderOptions when the pool already has the current theme", () => {
    const { pool, setRenderOptions } = createFakePool();

    syncPierreWorkerPoolTheme(pool, { ...CURRENT }, CURRENT);

    expect(setRenderOptions).not.toHaveBeenCalled();
  });

  it("pushes a theme change once, then stays quiet until the next change", () => {
    const { pool, setRenderOptions } = createFakePool();
    const next = { dark: "github-dark", light: CURRENT.light };

    syncPierreWorkerPoolTheme(pool, CURRENT, CURRENT);
    syncPierreWorkerPoolTheme(pool, CURRENT, next);
    expect(setRenderOptions).toHaveBeenCalledTimes(1);
    expect(setRenderOptions).toHaveBeenCalledWith({ theme: next });

    syncPierreWorkerPoolTheme(pool, CURRENT, { ...next });
    expect(setRenderOptions).toHaveBeenCalledTimes(1);
  });

  it("applies the current theme to a pool constructed with a different one", () => {
    const { pool, setRenderOptions } = createFakePool();

    syncPierreWorkerPoolTheme(
      pool,
      { dark: "stale-dark", light: "stale-light" },
      CURRENT,
    );

    expect(setRenderOptions).toHaveBeenCalledTimes(1);
    expect(setRenderOptions).toHaveBeenCalledWith({ theme: CURRENT });
  });
});
