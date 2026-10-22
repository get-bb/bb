// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import type { PluginMentionTrigger } from "@bb/client-core";
import {
  usePromptMentions,
  usePromptMentionTriggers,
} from "./usePromptMentions";

vi.mock("@/lib/sdk", () => ({
  sdk: { system: { config: vi.fn() } },
}));

function responseJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function urlForFetchInput(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const NO_MENTION: {
  mention: { text: string; trigger: PluginMentionTrigger } | null;
} = { mention: null };

describe("usePromptMentions", () => {
  it("shows loading for a non-at plugin trigger while the query is debouncing", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(makeSystemConfig());
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = urlForFetchInput(input);
      if (url === "/api/v1/plugins/contributions") {
        return Promise.resolve(
          responseJson({
            threadActions: [],
            mentionProviders: [
              {
                pluginId: "github",
                id: "issues",
                label: "GitHub issues",
                triggers: ["@", "#"],
              },
            ],
          }),
        );
      }
      if (url.startsWith("/api/v1/plugins/mentions/search?")) {
        return Promise.resolve(
          responseJson({
            ok: true,
            groups: [
              {
                pluginId: "github",
                providerId: "issues",
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
          }),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper } = createQueryClientTestHarness();
    const { result, rerender } = renderHook(
      ({
        mention,
      }: {
        mention: { text: string; trigger: PluginMentionTrigger } | null;
      }) => ({
        triggers: usePromptMentionTriggers(),
        ...usePromptMentions(
          { projectId: "proj_1", environmentId: null },
          mention,
        ),
      }),
      { wrapper, initialProps: NO_MENTION },
    );

    await waitFor(() => {
      expect(result.current.triggers).toEqual(["@", "#"]);
    });

    rerender({ mention: { text: "42", trigger: "#" } });

    expect(result.current.isLoading).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        urlForFetchInput(input).startsWith("/api/v1/plugins/mentions/search?"),
      ),
    ).toHaveLength(0);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          urlForFetchInput(input).startsWith(
            "/api/v1/plugins/mentions/search?",
          ),
        ),
      ).toHaveLength(1);
    });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.results.suggestions).toHaveLength(1);
    });
  });

  it("reports refreshing while newer results load behind the current ones", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(makeSystemConfig());
    let releaseSecondSearch: (() => void) | null = null;
    let searchCount = 0;
    const searchResponse = (title: string) =>
      responseJson({
        ok: true,
        groups: [
          {
            pluginId: "github",
            providerId: "issues",
            label: "GitHub issues",
            items: [
              {
                itemId: `issue:${title}`,
                title,
                subtitle: "owner/repo",
                icon: null,
              },
            ],
          },
        ],
      });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = urlForFetchInput(input);
      if (url === "/api/v1/plugins/contributions") {
        return Promise.resolve(
          responseJson({
            threadActions: [],
            mentionProviders: [
              {
                pluginId: "github",
                id: "issues",
                label: "GitHub issues",
                triggers: ["#"],
              },
            ],
          }),
        );
      }
      if (url.startsWith("/api/v1/plugins/mentions/search?")) {
        searchCount += 1;
        if (searchCount === 1) {
          return Promise.resolve(searchResponse("#42 Fix login bug"));
        }
        return new Promise<Response>((resolve) => {
          releaseSecondSearch = () =>
            resolve(searchResponse("#43 Fix logout bug"));
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper } = createQueryClientTestHarness();
    const { result, rerender } = renderHook(
      ({
        mention,
      }: {
        mention: { text: string; trigger: PluginMentionTrigger } | null;
      }) => ({
        triggers: usePromptMentionTriggers(),
        ...usePromptMentions(
          { projectId: "proj_1", environmentId: null },
          mention,
        ),
      }),
      { wrapper, initialProps: NO_MENTION },
    );
    await waitFor(() => {
      expect(result.current.triggers).toContain("#");
    });

    rerender({ mention: { text: "42", trigger: "#" } });
    await waitFor(() => {
      expect(result.current.results.suggestions).toHaveLength(1);
    });
    expect(result.current.isRefreshing).toBe(false);

    rerender({ mention: { text: "43", trigger: "#" } });
    await waitFor(() => {
      expect(releaseSecondSearch).not.toBeNull();
      expect(result.current.isRefreshing).toBe(true);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.results.suggestions).toHaveLength(1);

    act(() => {
      releaseSecondSearch?.();
    });
    await waitFor(() => {
      expect(result.current.isRefreshing).toBe(false);
    });
  });
});
