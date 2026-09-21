// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import {
  usePluginContributions,
  usePluginMentionSearch,
} from "./plugin-contribution-queries";

vi.mock("@/lib/sdk", () => ({
  sdk: { system: { config: vi.fn() } },
}));

function mockFetchJsonOnce(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("usePluginContributions", () => {
  it("fetches contributions and drops malformed entries", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(makeSystemConfig());
    const fetchMock = mockFetchJsonOnce({
      cliCommands: [],
      mentionProviders: [
        { pluginId: "linear", id: "issues", label: "Linear issues" },
        {
          pluginId: "github",
          id: "pulls",
          label: "GitHub pull requests",
          triggers: ["@", "#"],
        },
        {
          pluginId: "bad-trigger",
          id: "issues",
          label: "Bad trigger",
          triggers: ["?"],
        },
        {
          pluginId: "duplicate-trigger",
          id: "issues",
          label: "Duplicate trigger",
          triggers: ["#", "#"],
        },
        {
          pluginId: "empty-trigger",
          id: "issues",
          label: "Empty trigger",
          triggers: [],
        },
        { pluginId: "broken" },
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => usePluginContributions(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual({
        mentionProviders: [
          {
            pluginId: "linear",
            id: "issues",
            label: "Linear issues",
            triggers: ["@"],
          },
          {
            pluginId: "github",
            id: "pulls",
            label: "GitHub pull requests",
            triggers: ["@", "#"],
          },
        ],
      });
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/contributions",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("shapes a failed contributions request as empty rather than an error", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(makeSystemConfig());
    mockFetchJsonOnce({ ok: false }, { status: 503 });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => usePluginContributions(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual({
        mentionProviders: [],
      });
    });
  });
});

describe("usePluginMentionSearch", () => {
  it("shows fast providers while slow providers load and isolates superseded queries", async () => {
    let finishSlow: (response: Response) => void = () => {};
    let slowSignal: AbortSignal | undefined;
    const group = (providerId: string, title: string) => ({
      pluginId: "fixture",
      providerId,
      label: providerId,
      items: [
        { itemId: `${providerId}:${title}`, title, subtitle: null, icon: null },
      ],
    });
    const response = (providerId: string, title: string) =>
      new Response(JSON.stringify({ groups: [group(providerId, title)] }));
    const fetchMock = vi.fn((url: string, options: { signal: AbortSignal }) => {
      const params = new URL(url, "http://localhost").searchParams;
      const providerId = params.get("providerId")!;
      const query = params.get("q")!;
      if (providerId === "slow" && query === "first") {
        slowSignal = options.signal;
        return new Promise<Response>((resolve) => {
          finishSlow = resolve;
        });
      }
      return Promise.resolve(response(providerId, query));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = createQueryClientTestHarness();
    const { result, rerender } = renderHook(
      ({ query }) =>
        usePluginMentionSearch(
          {
            trigger: "#",
            query,
            projectId: null,
            threadId: null,
          },
          {
            enabled: true,
            providers: [
              {
                pluginId: "fixture",
                id: "slow",
                label: "slow",
                triggers: ["#"],
              },
              {
                pluginId: "fixture",
                id: "fast",
                label: "fast",
                triggers: ["#"],
              },
              {
                pluginId: "fixture",
                id: "other",
                label: "other",
                triggers: ["@"],
              },
            ],
          },
        ),
      { wrapper, initialProps: { query: "first" } },
    );
    await waitFor(() =>
      expect(result.current.data).toEqual([group("fast", "first")]),
    );
    expect(result.current.isFetching).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    rerender({ query: "second" });
    await waitFor(() =>
      expect(result.current.data).toEqual([
        group("slow", "second"),
        group("fast", "second"),
      ]),
    );
    expect(slowSignal?.aborted).toBe(true);
    await act(async () => {
      finishSlow(response("slow", "first"));
    });
    expect(result.current.data).toEqual([
      group("slow", "second"),
      group("fast", "second"),
    ]);
    expect(result.current.isFetching).toBe(false);
  });

  it("includes the active trigger in the search request", async () => {
    const fetchMock = mockFetchJsonOnce({
      ok: true,
      groups: [
        {
          pluginId: "github",
          providerId: "issue",
          label: "GitHub issues",
          items: [
            {
              itemId: "issue:owner/repo#42",
              title: "#42 Fix login bug",
              subtitle: "owner/repo",
              icon: null,
            },
          ],
        },
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        usePluginMentionSearch(
          {
            trigger: "#",
            query: "42",
            projectId: "proj_1",
            threadId: null,
          },
          {
            enabled: true,
            providers: [
              {
                pluginId: "github",
                id: "issue",
                label: "GitHub issues",
                triggers: ["#"],
              },
            ],
          },
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([
        {
          pluginId: "github",
          providerId: "issue",
          label: "GitHub issues",
          items: [
            {
              itemId: "issue:owner/repo#42",
              title: "#42 Fix login bug",
              subtitle: "owner/repo",
              icon: null,
            },
          ],
        },
      ]);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/mentions/search?q=42&trigger=%23&pluginId=github&providerId=issue&projectId=proj_1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
