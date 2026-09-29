// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shares concurrent reads across consumers and preserves usage after cancellation and errors", async () => {
  const { readUsage, useUsageSnapshot } = await import("./usage-client.js");
  let finish!: (value: Response) => void;
  let finishOther!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      (_url: string, { signal }: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          finish = resolve;
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    )
    .mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finishOther = resolve;
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const view = renderHook(useUsageSnapshot);
  const input = {
    force: false,
    machineIds: null,
    providerId: null,
    maxAgeMs: 60_000,
  };
  const controller = new AbortController();
  const sharedController = new AbortController();
  let a!: ReturnType<typeof readUsage>;
  let b!: ReturnType<typeof readUsage>;
  let other!: ReturnType<typeof readUsage>;
  act(() => {
    a = readUsage(input, sharedController.signal);
    b = readUsage(input);
    other = readUsage({ ...input, machineIds: ["other"] }, controller.signal);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(view.result.current.isRefreshing).toBe(true);
  const kept = {
    machines: [
      {
        id: "kept",
        displayName: "Kept",
        status: "connected",
        error: null,
        providers: [],
      },
    ],
  };
  await act(async () => {
    sharedController.abort();
    finish(Response.json({ ok: true, result: kept }));
    const results = await Promise.allSettled([a, b]);
    expect(results[1]).toEqual({ status: "fulfilled", value: kept });
    controller.abort();
    finishOther(Response.json({ ok: true, result: { machines: [] } }));
    await other;
  });
  expect(view.result.current).toEqual({
    data: kept,
    error: null,
    isRefreshing: false,
  });
  fetcher.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    await expect(readUsage(input)).rejects.toThrow("offline");
  });
  expect(view.result.current.data).toEqual(kept);
  expect(view.result.current.error).toBe("Couldn’t refresh usage.");
});
