// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import { pluginListQueryKey } from "@/hooks/queries/query-keys";
import { appQueryClient } from "./app-query-client";
import {
  bootPluginFrontends,
  schedulePluginFrontendReconcile,
} from "./plugin-frontend-lazy";
import { settleLazyModules } from "@/test/lazy-modules";

await import("./plugin-frontend");

afterEach(() => {
  vi.unstubAllGlobals();
});

it("re-reads the plugin list after boot when a change was announced before boot started", async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ plugins: [] }), {
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  appQueryClient.setQueryData(pluginListQueryKey(true), [], {
    updatedAt: Date.now() - 1_000,
  });

  schedulePluginFrontendReconcile();
  await settleLazyModules(bootPluginFrontends());
  expect(fetchMock).not.toHaveBeenCalled();

  await vi.waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/plugins"),
      expect.anything(),
    );
  });
});
