import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { HistoryEntry } from "./history-prompt.js";
import plugin from "./server.js";

function text(value: string): HistoryEntry["input"] {
  return [{ type: "text", text: value, mentions: [] }];
}

function draft(value: string) {
  return { text: value, mentions: [] };
}

function entry(
  id: string,
  createdAt: number,
  value: string,
  location: { projectId?: string; threadId?: string } = {},
): HistoryEntry {
  return {
    id,
    createdAt,
    input: text(value),
    projectId: location.projectId ?? "proj_a",
    threadId: location.threadId ?? "thr_a",
  };
}

function historyList(history: HistoryEntry[]) {
  return vi.fn(async (args: { cursor?: string; limit?: string } = {}) => {
    const newestFirst = [...history].sort(
      (left, right) =>
        right.createdAt - left.createdAt || right.id.localeCompare(left.id),
    );
    const start = args.cursor === undefined ? 0 : Number(args.cursor);
    const limit = Number(args.limit ?? "100");
    const end = start + limit;
    return {
      entries: newestFirst.slice(start, end),
      nextCursor: end < newestFirst.length ? String(end) : null,
    };
  });
}

async function setup(entries: readonly HistoryEntry[]) {
  const history = [...entries];
  const list = historyList(history);
  const fake = createFakePluginHost({
    pluginId: "prompt-library",
    sdk: {
      promptHistory: { list },
      projects: {
        list: async () => [
          { id: "proj_a", name: "Alpha" },
          { id: "proj_b", name: "Beta" },
        ],
      },
    },
  });
  await plugin(fake.bb);
  const call = (method: string, input: unknown) =>
    fake.harness.behavior.callRpc(method, input);
  return { ...fake, history, list, call };
}

const GLOBAL = { scope: "global", projectId: null, threadId: null } as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("prompt library server", () => {
  it("lists starred prompts first and collapses repeated history, newest first", async () => {
    const { call } = await setup([
      entry("h1", 1, "write the release notes"),
      entry("h2", 2, "fix the timeline cache", { projectId: "proj_b" }),
      entry("h3", 3, "write the release notes"),
    ]);
    const starred = await call("star", {
      prompt: draft("fix the timeline cache"),
    });

    const result = await call("search", { ...GLOBAL, query: "" });

    expect(result).toMatchObject({
      starred: [{ id: (starred as { id: string }).id }],
      recent: [
        { id: "h3", projectName: "Alpha", starredId: null },
        {
          id: "h2",
          projectName: "Beta",
          starredId: (starred as { id: string }).id,
        },
      ],
    });
  });

  it("turns history mentions and attachments into a composer prompt", async () => {
    const { call } = await setup([
      {
        id: "h1",
        createdAt: 1,
        projectId: "proj_a",
        threadId: "thr_a",
        input: [
          {
            type: "text",
            text: "see @a.ts",
            mentions: [
              {
                start: 4,
                end: 9,
                resource: {
                  kind: "path",
                  source: "workspace",
                  entryKind: "file",
                  path: "src/a.ts",
                  label: "a.ts",
                },
              },
            ],
          },
          {
            type: "text",
            text: "then #42",
            mentions: [
              {
                start: 5,
                end: 8,
                resource: {
                  kind: "plugin",
                  pluginId: "github",
                  itemId: "issues:42",
                  label: "#42",
                },
              },
            ],
          },
          { type: "localImage", path: ".bb/attachments/shot.png" },
        ],
      },
    ]);

    const result = (await call("search", { ...GLOBAL, query: "" })) as {
      recent: { prompt: unknown }[];
    };

    expect(result.recent[0]?.prompt).toEqual({
      text: "see @a.ts\n\nthen #42",
      mentions: [
        {
          from: 4,
          to: 9,
          kind: "path",
          source: "workspace",
          entryKind: "file",
          path: "src/a.ts",
          label: "a.ts",
        },
        {
          from: 16,
          to: 19,
          kind: "plugin",
          pluginId: "github",
          provider: "issues",
          id: "42",
          label: "#42",
        },
      ],
      attachments: [
        {
          type: "localImage",
          path: ".bb/attachments/shot.png",
          name: "shot.png",
          sizeBytes: 0,
        },
      ],
    });
  });

  it("fuzzy-matches every word and highlights the matched characters", async () => {
    const { call } = await setup([
      entry("h1", 1, "fix the timeline cache"),
      entry("h2", 2, "timeline only"),
      entry("h3", 3, "unrelated prompt"),
    ]);

    const result = (await call("search", {
      ...GLOBAL,
      query: "tmln cach",
    })) as {
      recent: {
        id: string;
        snippet: { text: string; highlights: number[][] };
      }[];
    };

    expect(result.recent.map((row) => row.id)).toEqual(["h1"]);
    expect(result.recent[0]?.snippet.highlights.length).toBeGreaterThan(0);
  });

  it("loads older pages only when the loaded ones have too few matches", async () => {
    const { call, list } = await setup([
      entry("old", 1, "migrate the billing tables"),
      ...Array.from({ length: 1200 }, (_, index) =>
        entry(`new-${index}`, 10 + index, `recent prompt ${index}`),
      ),
    ]);

    const result = (await call("search", { ...GLOBAL, query: "mgrt blng" })) as {
      recent: { id: string }[];
    };

    expect(result.recent.map((row) => row.id)).toEqual(["old"]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("loads only the newest page while it yields enough results", async () => {
    const { call, list } = await setup(
      Array.from({ length: 1200 }, (_, index) =>
        entry(`h${index}`, index, `prompt number ${index}`),
      ),
    );

    const result = (await call("search", { ...GLOBAL, query: "" })) as {
      recent: { id: string }[];
    };

    expect(result.recent).toHaveLength(30);
    expect(result.recent[0]?.id).toBe("h1199");
    expect(list).toHaveBeenCalledOnce();
  });

  it("adds new prompts on later searches and keeps prompts core no longer returns", async () => {
    const { call, history, list } = await setup([
      entry("h1", 1, "first prompt"),
    ]);
    await call("search", { ...GLOBAL, query: "" });
    history.push(entry("h2", 2, "second prompt"));
    history.splice(0, 1);
    list.mockClear();

    const result = (await call("search", { ...GLOBAL, query: "" })) as {
      recent: { id: string }[];
    };

    expect(result.recent.map((row) => row.id)).toEqual(["h2", "h1"]);
    expect(list).toHaveBeenCalledOnce();
  });

  it("scopes history to the thread or project and skips a missing target", async () => {
    const { call, list } = await setup([
      entry("h1", 1, "in thread a", { threadId: "thr_a" }),
      entry("h2", 2, "in thread b", { threadId: "thr_b" }),
    ]);

    const thread = (await call("search", {
      query: "",
      scope: "thread",
      projectId: "proj_a",
      threadId: "thr_b",
    })) as { recent: { id: string }[] };
    expect(thread.recent.map((row) => row.id)).toEqual(["h2"]);

    list.mockClear();
    const missing = (await call("search", {
      query: "",
      scope: "project",
      projectId: null,
      threadId: null,
    })) as { recent: unknown[] };
    expect(missing.recent).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it("stars text and mentions only, dedupes by text, and orders by last use", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    const { call } = await setup([]);
    const first = (await call("star", {
      prompt: {
        ...draft("first prompt"),
        attachments: [
          {
            type: "localImage",
            path: ".bb/attachments/shot.png",
            name: "shot.png",
            sizeBytes: 0,
          },
        ],
      },
    })) as { id: string };
    vi.setSystemTime(2_000);
    const second = (await call("star", { prompt: draft("second prompt") })) as {
      id: string;
    };
    const duplicate = (await call("star", {
      prompt: draft("first prompt"),
    })) as { id: string };
    expect(duplicate.id).toBe(first.id);

    vi.setSystemTime(3_000);
    await call("markUsed", { id: first.id });
    const listed = (await call("search", { ...GLOBAL, query: "" })) as {
      starred: { id: string; prompt: unknown }[];
    };
    expect(listed.starred.map((row) => row.id)).toEqual([first.id, second.id]);
    expect(listed.starred[0]?.prompt).toEqual(draft("first prompt"));

    await expect(call("unstar", { id: second.id })).resolves.toEqual({
      unstarred: true,
    });
    await expect(call("unstar", { id: second.id })).resolves.toEqual({
      unstarred: false,
    });
  });

  it("rejects saving a prompt with no text", async () => {
    const { call } = await setup([]);
    await expect(call("star", { prompt: draft("   ") })).rejects.toThrow(
      "A starred prompt needs some text.",
    );
  });

  it("manages starred prompts and searches from the CLI", async () => {
    const { harness } = await setup([entry("h1", 1, "deploy the preview")]);

    const starred = await harness.behavior.runCli([
      "star",
      "review",
      "this",
      "diff",
      "--json",
    ]);
    expect(starred.exitCode).toBe(0);
    const { id } = JSON.parse(starred.stdout ?? "") as { id: string };

    const list = await harness.behavior.runCli(["list"]);
    expect(list.stdout).toBe(`${id}  review this diff`);

    const search = await harness.behavior.runCli([
      "search",
      "deploy",
      "--json",
    ]);
    expect(JSON.parse(search.stdout ?? "")).toMatchObject({
      starred: [],
      recent: [{ id: "h1" }],
    });

    await expect(
      harness.behavior.runCli(["unstar", id]),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: `Unstarred ${id}`,
    });
    await expect(
      harness.behavior.runCli(["unstar", id]),
    ).resolves.toMatchObject({
      exitCode: 1,
    });
  });
});
