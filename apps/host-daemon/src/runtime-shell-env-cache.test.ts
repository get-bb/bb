import { createDeferredPromise } from "@bb/test-helpers";
import { describe, expect, it, vi } from "vitest";
import {
  createRuntimeShellEnvCache,
  type RuntimeShellEnv,
} from "./runtime-shell-env-cache.js";

interface CacheFixtureArgs {
  resolvedAtMs?: number;
  startupPath: string;
}

function createFixture({ resolvedAtMs, startupPath }: CacheFixtureArgs) {
  let currentTime = 0;
  let appliedEnv: RuntimeShellEnv = { PATH: startupPath };
  const resolveShellEnv = vi.fn<() => Promise<RuntimeShellEnv>>();
  const onRefreshError = vi.fn();
  const cache = createRuntimeShellEnvCache({
    applyShellEnv: async (shellEnv) => {
      appliedEnv = shellEnv;
    },
    now: () => currentTime,
    onRefreshError,
    readShellEnv: () => appliedEnv,
    resolveShellEnv,
    ttlMs: 100,
    ...(resolvedAtMs === undefined ? {} : { resolvedAtMs }),
  });
  return {
    cache,
    onRefreshError,
    readAppliedPath: () => appliedEnv.PATH,
    resolveShellEnv,
    setTime: (value: number) => {
      currentTime = value;
    },
  };
}

describe("createRuntimeShellEnvCache", () => {
  it("blocks on the first resolve when no startup environment was recorded", async () => {
    const fixture = createFixture({ startupPath: "/old/bin" });
    fixture.resolveShellEnv.mockResolvedValue({ PATH: "/new/bin" });

    await expect(
      fixture.cache.refresh({ allowStale: true }),
    ).resolves.toEqual({ PATH: "/new/bin" });
    expect(fixture.readAppliedPath()).toBe("/new/bin");
  });

  it("serves the last resolved environment while a stale refresh runs", async () => {
    const fixture = createFixture({ resolvedAtMs: 0, startupPath: "/old/bin" });
    const resolve = createDeferredPromise<RuntimeShellEnv>();
    fixture.resolveShellEnv.mockReturnValue(resolve.promise);
    fixture.setTime(100);

    await expect(fixture.cache.refresh({ allowStale: true })).resolves.toEqual({
      PATH: "/old/bin",
    });
    expect(fixture.readAppliedPath()).toBe("/old/bin");

    resolve.resolve({ PATH: "/new/bin" });
    await resolve.promise;
    await expect(fixture.cache.refresh({ allowStale: true })).resolves.toEqual({
      PATH: "/new/bin",
    });
    expect(fixture.resolveShellEnv).toHaveBeenCalledOnce();
  });

  it("does not wait for a refresh another caller already started", async () => {
    const fixture = createFixture({ resolvedAtMs: 0, startupPath: "/old/bin" });
    const resolve = createDeferredPromise<RuntimeShellEnv>();
    fixture.resolveShellEnv.mockReturnValue(resolve.promise);
    fixture.setTime(100);

    const blocking = fixture.cache.refresh({ allowStale: false });
    await expect(fixture.cache.refresh({ allowStale: true })).resolves.toEqual({
      PATH: "/old/bin",
    });

    resolve.resolve({ PATH: "/new/bin" });
    await expect(blocking).resolves.toEqual({ PATH: "/new/bin" });
    expect(fixture.resolveShellEnv).toHaveBeenCalledOnce();
  });

  it("waits for the resolved environment when stale answers are not allowed", async () => {
    const fixture = createFixture({ resolvedAtMs: 0, startupPath: "/old/bin" });
    fixture.resolveShellEnv.mockResolvedValue({ PATH: "/new/bin" });
    fixture.setTime(100);

    await expect(fixture.cache.refresh({ allowStale: false })).resolves.toEqual(
      { PATH: "/new/bin" },
    );
  });

  it("skips the resolve entirely inside the refresh window", async () => {
    const fixture = createFixture({ resolvedAtMs: 0, startupPath: "/old/bin" });
    fixture.resolveShellEnv.mockResolvedValue({ PATH: "/new/bin" });
    fixture.setTime(99);

    await expect(fixture.cache.refresh({ allowStale: false })).resolves.toEqual(
      { PATH: "/old/bin" },
    );
    expect(fixture.resolveShellEnv).not.toHaveBeenCalled();
  });

  it("keeps serving the last environment after a failed background refresh", async () => {
    const fixture = createFixture({ resolvedAtMs: 0, startupPath: "/old/bin" });
    const failure = new Error("login shell timed out");
    fixture.resolveShellEnv
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ PATH: "/new/bin" });
    fixture.setTime(100);

    await expect(fixture.cache.refresh({ allowStale: true })).resolves.toEqual({
      PATH: "/old/bin",
    });
    await vi.waitFor(() =>
      expect(fixture.onRefreshError).toHaveBeenCalledWith(failure),
    );

    fixture.setTime(200);
    await expect(fixture.cache.refresh({ allowStale: true })).resolves.toEqual({
      PATH: "/old/bin",
    });
    await vi.waitFor(() => expect(fixture.readAppliedPath()).toBe("/new/bin"));
    expect(fixture.resolveShellEnv).toHaveBeenCalledTimes(2);
  });

  it("blocks again after a failed refresh when no environment was ever resolved", async () => {
    const fixture = createFixture({ startupPath: "/old/bin" });
    fixture.resolveShellEnv
      .mockRejectedValueOnce(new Error("login shell timed out"))
      .mockResolvedValueOnce({ PATH: "/new/bin" });

    await expect(fixture.cache.refresh({ allowStale: true })).rejects.toThrow(
      "login shell timed out",
    );
    await expect(fixture.cache.refresh({ allowStale: true })).resolves.toEqual({
      PATH: "/new/bin",
    });
  });
});
