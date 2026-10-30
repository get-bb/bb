// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePluginFrontendLoadFailed } from "./plugin-frontend-boot-state";
import {
  bootPluginFrontends,
  schedulePluginFrontendReconcile,
} from "./plugin-frontend-lazy";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("reports a failed plugin frontend boot as failed until a retry succeeds", async () => {
  const fetchMock = vi.fn(async () =>
    fetchMock.mock.calls.length === 1
      ? new Response(JSON.stringify({ error: "bad request" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        })
      : new Response(JSON.stringify({ plugins: [] }), {
          headers: { "content-type": "application/json" },
        }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const loadFailed = renderHook(() => usePluginFrontendLoadFailed());

  await bootPluginFrontends();
  loadFailed.rerender();
  expect(loadFailed.result.current).toBe(true);

  schedulePluginFrontendReconcile();
  await vi.waitFor(() => {
    loadFailed.rerender();
    expect(loadFailed.result.current).toBe(false);
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
