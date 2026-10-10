import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPluginContributions,
  fetchPluginMentionSearch,
} from "./plugin-contribution-requests";

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
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("fetchPluginContributions", () => {
  it("fetches contributions and drops malformed entries", async () => {
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

    await expect(
      fetchPluginContributions(new AbortController().signal),
    ).resolves.toEqual({
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
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/contributions",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("shapes a failed contributions request as empty rather than an error", async () => {
    mockFetchJsonOnce(
      {
        mentionProviders: [
          { pluginId: "linear", id: "issues", label: "Linear issues" },
        ],
      },
      { status: 503 },
    );

    await expect(
      fetchPluginContributions(new AbortController().signal),
    ).resolves.toEqual({
      mentionProviders: [],
    });
  });
});

describe("fetchPluginMentionSearch", () => {
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

    await expect(
      fetchPluginMentionSearch(
        {
          trigger: "#",
          query: "42",
          projectId: "proj_1",
          threadId: null,
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual([
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
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/mentions/search?q=42&trigger=%23&projectId=proj_1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
