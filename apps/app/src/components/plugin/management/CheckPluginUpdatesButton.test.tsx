// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { allPluginListQueryKeyPrefix } from "@/hooks/queries/query-keys";
import type { PluginUpdatesEntry } from "@/hooks/queries/plugin-catalog-queries";
import {
  CheckPluginUpdatesButton,
  summarizeUpdateCheck,
} from "./CheckPluginUpdatesButton";

const installed = { version: "1.0.0", display: "1.0.0" };

function entry(
  id: string,
  outcome: PluginUpdatesEntry["outcome"],
  detail: string | null = null,
): PluginUpdatesEntry {
  return {
    id,
    outcome,
    devMode: false,
    installed,
    candidate: null,
    blocked: null,
    detail,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("summarizeUpdateCheck", () => {
  it("counts and names available updates", () => {
    expect(
      summarizeUpdateCheck([
        entry("b", "update-available"),
        entry("a", "update-available"),
        entry("c", "current"),
      ]),
    ).toEqual({
      tone: "success",
      title: "2 plugin updates available",
      description: "a, b",
    });
    expect(
      summarizeUpdateCheck([entry("a", "current")], { pluginId: "a" }),
    ).toMatchObject({ title: "a is up to date" });
  });

  it("warns instead of reporting up to date when a check did not complete", () => {
    const offline = entry("offline", "unavailable", "network unreachable");
    expect(summarizeUpdateCheck([offline, entry("ok", "current")])).toEqual({
      tone: "warning",
      title: "Update check incomplete",
      description: "Could not check 1 plugin: offline.",
    });
    expect(summarizeUpdateCheck([offline], { pluginId: "offline" })).toEqual({
      tone: "warning",
      title: "Could not check offline for updates",
      description: "network unreachable",
    });
    expect(
      summarizeUpdateCheck([offline, entry("fresh", "update-available")]),
    ).toEqual({
      tone: "warning",
      title: "1 plugin update available",
      description: "fresh Could not check 1 plugin: offline.",
    });
  });
});

describe("CheckPluginUpdatesButton", () => {
  it("posts a full or scoped check and refetches the plugin list", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ results: [{ id: "a", outcome: "current", installed }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper, queryClient } = createQueryClientTestHarness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    render(
      <>
        <CheckPluginUpdatesButton />
        <CheckPluginUpdatesButton pluginId="a" appearance="inline" />
      </>,
      { wrapper },
    );
    const [toolbar, inline] = screen.getAllByRole("button", {
      name: "Check for updates",
    });

    fireEvent.click(toolbar!);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(inline!);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const bodies = fetchMock.mock.calls.map((call) => {
      const [url, init] = call as unknown as [string, RequestInit];
      expect(url).toContain("/plugins/updates/check");
      expect(init.method).toBe("POST");
      return JSON.parse(String(init.body));
    });
    expect(bodies).toEqual([{}, { id: "a" }]);
    await vi.waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: allPluginListQueryKeyPrefix(),
      }),
    );
  });
});
