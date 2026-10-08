import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin, {
  EMPTY_FORK_MAX_AGE_MS,
  EMPTY_FORK_SWEEP_PAGE_SIZE,
  REPLY_SEED_PREFIX,
} from "./server";

const PLUGIN_ID = "side-chat";

interface TimelineRow {
  kind: string;
  role?: string;
  text?: string;
  children?: TimelineRow[] | null;
}

function conversationRow(text: string, role = "assistant") {
  return { kind: "conversation", role, text };
}

function turnRow(children: TimelineRow[] | null) {
  return { kind: "turn", children };
}

function timelineResult(rows: TimelineRow[]) {
  return { rows };
}

const hosts: ReturnType<typeof createFakePluginHost>[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

async function loadPlugin(sdkThreads: Record<string, unknown>) {
  const host = createFakePluginHost({
    pluginId: PLUGIN_ID,
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) =>
          makeThreadResponse({
            id: threadId,
            originKind: "fork",
            originPluginId: PLUGIN_ID,
            visibility: "hidden",
          }),
        ...sdkThreads,
      },
    },
  });
  hosts.push(host);
  await plugin(host.bb);
  return host;
}

describe("createSideChat rpc", () => {
  it("does not read the source timeline to decide whether to include the anchor", async () => {
    const timeline = vi.fn();
    const fork = vi.fn(
      async (_args: { agentContextSeed?: Array<{ text: string }> }) =>
        makeThreadResponse({ id: "thr_fork" }),
    );
    const { harness } = await loadPlugin({ timeline, fork });

    await harness.callRpc("createSideChat", {
      sourceThreadId: "thr_src",
      sourceSeqEnd: 7,
      anchorText: "latest answer",
    });

    expect(timeline).not.toHaveBeenCalled();
    expect(fork.mock.calls[0]?.[0].agentContextSeed?.[0]?.text).toBe(
      `${REPLY_SEED_PREFIX}latest answer`,
    );
  });

  it("forks hidden+isolated with a seed when the anchor is an earlier message", async () => {
    const fork = vi.fn(async () => makeThreadResponse({ id: "thr_fork" }));
    const { harness } = await loadPlugin({
      timeline: async () =>
        timelineResult([
          conversationRow("earlier answer"),
          conversationRow("latest answer"),
        ]),
      fork,
    });

    const result = await harness.callRpc("createSideChat", {
      sourceThreadId: "thr_src",
      sourceSeqEnd: 42,
      anchorText: "  earlier answer  ",
    });

    expect(result).toEqual({ threadId: "thr_fork" });
    expect(fork).toHaveBeenCalledWith({
      lifecycleOwnerThreadId: "thr_src",
      sourceThreadId: "thr_src",
      sourceSeqEnd: 42,
      visibility: "hidden",
      agentContextSeed: [
        {
          type: "text",
          text: `${REPLY_SEED_PREFIX}earlier answer`,
          mentions: [],
          visibility: "agent-only",
        },
      ],
      origin: "plugin",
      originPluginId: PLUGIN_ID,
    });
  });

  it("falls back to a tip fork when the anchor predates any provider session", async () => {
    const sessionUnavailable = Object.assign(
      new Error("HTTP 400: Cannot fork: source has no active session to clone"),
      { code: "fork_source_session_unavailable" },
    );
    const fork = vi
      .fn()
      .mockRejectedValueOnce(sessionUnavailable)
      .mockResolvedValueOnce(makeThreadResponse({ id: "thr_tip_fork" }));
    const { harness } = await loadPlugin({
      timeline: async () =>
        timelineResult([
          conversationRow("earlier answer"),
          conversationRow("latest answer"),
        ]),
      fork,
    });

    const result = await harness.callRpc("createSideChat", {
      sourceThreadId: "thr_src",
      sourceSeqEnd: 1,
      anchorText: "earlier answer",
    });

    expect(result).toEqual({ threadId: "thr_tip_fork" });
    expect(fork).toHaveBeenCalledTimes(2);
    expect(fork.mock.calls[1]?.[0]).not.toHaveProperty("sourceSeqEnd");
    expect(fork.mock.calls[1]?.[0].agentContextSeed?.[0]?.text).toContain(
      "earlier answer",
    );
  });

  it("rethrows point-fork failures that are not missing-session errors", async () => {
    const fork = vi.fn().mockRejectedValue(new Error("HTTP 403: forbidden"));
    const { harness } = await loadPlugin({
      timeline: async () => timelineResult([conversationRow("latest answer")]),
      fork,
    });

    await expect(
      harness.callRpc("createSideChat", {
        sourceThreadId: "thr_src",
        sourceSeqEnd: 3,
        anchorText: "x",
      }),
    ).rejects.toThrow("forbidden");
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it("does not fall back on message text alone — only the structured code triggers it", async () => {
    const messageOnly = new Error(
      "HTTP 400: Cannot fork: source has no active session to clone",
    );
    const fork = vi.fn().mockRejectedValue(messageOnly);
    const { harness } = await loadPlugin({
      timeline: async () => timelineResult([conversationRow("latest answer")]),
      fork,
    });

    await expect(
      harness.callRpc("createSideChat", {
        sourceThreadId: "thr_src",
        sourceSeqEnd: 3,
        anchorText: "x",
      }),
    ).rejects.toThrow("no active session");
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it("forks from the tip without a seed or sourceSeqEnd for empty anchors", async () => {
    const fork = vi.fn(async () => makeThreadResponse({ id: "thr_fork" }));
    const { harness } = await loadPlugin({
      timeline: async () => timelineResult([conversationRow("latest answer")]),
      fork,
    });

    await harness.callRpc("createSideChat", {
      sourceThreadId: "thr_src",
      anchorText: "   ",
    });

    expect(fork).toHaveBeenCalledWith({
      lifecycleOwnerThreadId: "thr_src",
      sourceThreadId: "thr_src",
      visibility: "hidden",
      origin: "plugin",
      originPluginId: PLUGIN_ID,
    });
  });
});

describe("empty-fork sweep", () => {
  it("discovers existing forks once and remembers discovery after reload", async () => {
    const list = vi.fn(async () => []);
    const host = await loadPlugin({ list });
    await host.harness.runSchedule("empty-fork-cleanup");
    const reloaded = await host.harness.lifecycle.reload(plugin);
    hosts.push(reloaded);
    await reloaded.harness.runSchedule("empty-fork-cleanup");
    await reloaded.harness.runSchedule("empty-fork-cleanup");
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("leaves a pending fork alone when it becomes visible before cleanup", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = Date.now();
    const thread = makeThreadResponse({
      id: "thr_promoted",
      originKind: "fork",
      originPluginId: PLUGIN_ID,
      visibility: "hidden",
      createdAt: now,
    });
    const timeline = vi.fn(async () => timelineResult([]));
    const archive = vi.fn(async () => ({ ok: true }));
    const { harness } = await loadPlugin({
      list: async () => [thread],
      get: async () => thread,
      timeline,
      archive,
      queuedMessages: { list: async () => [] },
    });
    await harness.runSchedule("empty-fork-cleanup");
    thread.visibility = "visible";
    vi.setSystemTime(now + EMPTY_FORK_MAX_AGE_MS + 1);
    await harness.runSchedule("empty-fork-cleanup");
    expect(archive).not.toHaveBeenCalled();
    expect(timeline).not.toHaveBeenCalled();
  });

  it("uses a deadline index when all pending candidates are in the future", async () => {
    const { bb, harness } = await loadPlugin({ list: async () => [] });
    await harness.runSchedule("empty-fork-cleanup");
    const db = bb.storage.database();
    db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000)
      INSERT INTO cleanup_candidates(thread_id, created_at, due_at)
      SELECT 'future-'||x,?,? FROM n`).run(
      Date.now(),
      Date.now() + EMPTY_FORK_MAX_AGE_MS,
    );
    const prepare = vi.spyOn(db, "prepare");
    await harness.runSchedule("empty-fork-cleanup");
    const queries = prepare.mock.calls.map(([sql]) => sql);
    prepare.mockRestore();
    const candidateQuery = queries.find((sql) =>
      sql.includes("FROM cleanup_candidates"),
    );
    expect(candidateQuery).toBeDefined();
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${candidateQuery}`)
      .all(Date.now());
    expect(plan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.stringMatching(/SEARCH cleanup_candidates .*due_at</),
        }),
      ]),
    );
  });

  it.each([false, true])(
    "cleans up new forks only after their deadline (tip fallback: %s)",
    async (fallback) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const createdAt = Date.now();
      const thread = makeThreadResponse({
        id: "thr_new",
        createdAt,
        originKind: "fork",
        originPluginId: PLUGIN_ID,
        visibility: "hidden",
      });
      const fork = vi.fn(async () => thread);
      if (fallback)
        fork.mockRejectedValueOnce(
          Object.assign(new Error("unavailable"), {
            code: "fork_source_session_unavailable",
          }),
        );
      const list = vi.fn(
        async (): Promise<ReturnType<typeof makeThreadResponse>[]> => [],
      );
      const archive = vi.fn(async () => {
        list.mockResolvedValue([]);
        return { ok: true };
      });
      const { harness } = await loadPlugin({
        list,
        fork,
        archive,
        timeline: async () => timelineResult([]),
        queuedMessages: { list: async () => [] },
      });
      await harness.runSchedule("empty-fork-cleanup");
      await harness.callRpc("createSideChat", {
        sourceThreadId: "thr_source",
        sourceSeqEnd: 1,
        anchorText: "answer",
      });
      list.mockResolvedValue([thread]);
      vi.setSystemTime(createdAt + EMPTY_FORK_MAX_AGE_MS);
      await harness.runSchedule("empty-fork-cleanup");
      expect(archive).not.toHaveBeenCalled();
      vi.setSystemTime(createdAt + EMPTY_FORK_MAX_AGE_MS + 1);
      await harness.runSchedule("empty-fork-cleanup");
      await harness.runSchedule("empty-fork-cleanup");
      expect(archive).toHaveBeenCalledExactlyOnceWith({ threadId: "thr_new" });
      expect(list).toHaveBeenCalledTimes(1);
    },
  );

  it("bounds due work and defers failed candidates so the backlog can progress", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = Date.now();
    const threads: ReturnType<typeof makeThreadResponse>[] = [];
    const fork = vi.fn(async () => {
      const thread = makeThreadResponse({
        id: `thr_${fork.mock.calls.length}`,
        createdAt: now - EMPTY_FORK_MAX_AGE_MS - 1,
        originKind: "fork",
        originPluginId: PLUGIN_ID,
        visibility: "hidden",
      });
      threads.push(thread);
      return thread;
    });
    const timeline = vi.fn(async () => {
      throw new Error("unavailable");
    });
    const archive = vi.fn(async () => ({ ok: true }));
    const { harness } = await loadPlugin({
      list: async ({ offset = 0, limit = EMPTY_FORK_SWEEP_PAGE_SIZE }) =>
        threads.slice(offset, offset + limit),
      fork,
      timeline,
      archive,
    });
    await harness.runSchedule("empty-fork-cleanup");
    for (let i = 0; i <= EMPTY_FORK_SWEEP_PAGE_SIZE; i++) {
      await harness.callRpc("createSideChat", {
        sourceThreadId: "thr_source",
        anchorText: "answer",
      });
    }
    await harness.runSchedule("empty-fork-cleanup");
    expect(timeline).toHaveBeenCalledTimes(EMPTY_FORK_SWEEP_PAGE_SIZE);
    await harness.runSchedule("empty-fork-cleanup");
    expect(timeline).toHaveBeenCalledTimes(EMPTY_FORK_SWEEP_PAGE_SIZE + 1);
    await harness.runSchedule("empty-fork-cleanup");
    expect(timeline).toHaveBeenCalledTimes(EMPTY_FORK_SWEEP_PAGE_SIZE + 1);
    expect(archive).not.toHaveBeenCalled();
    vi.setSystemTime(now + 3_600_000);
    await harness.runSchedule("empty-fork-cleanup");
    expect(timeline).toHaveBeenCalledTimes(2 * EMPTY_FORK_SWEEP_PAGE_SIZE + 1);
  });

  it.each(["thread.archived", "thread.deleted"] as const)(
    "removes candidates on %s and tracks eligible unarchives",
    async (event) => {
      const thread = makeThreadResponse({
        id: "thr_removed",
        originKind: "fork",
        originPluginId: PLUGIN_ID,
        visibility: "hidden",
        createdAt: Date.now() - EMPTY_FORK_MAX_AGE_MS - 1,
      });
      const archive = vi.fn(async () => ({ ok: true }));
      const { bb, harness } = await loadPlugin({
        list: async () => [],
        fork: async () => thread,
        archive,
        timeline: async () => timelineResult([]),
        queuedMessages: { list: async () => [] },
      });
      await harness.runSchedule("empty-fork-cleanup");
      await harness.callRpc("createSideChat", {
        sourceThreadId: "thr_source",
        anchorText: "answer",
      });
      await bb.storage.kv.set(`kept-fork:${thread.id}`, true);
      expect(await harness.emitThreadEvent(event, { thread })).toEqual({
        errors: [],
      });
      await harness.runSchedule("empty-fork-cleanup");
      expect(archive).not.toHaveBeenCalled();
      expect(await bb.storage.kv.get(`kept-fork:${thread.id}`)).toBeUndefined();
      if (event === "thread.archived") {
        expect(
          await harness.emitThreadEvent("thread.unarchived", { thread }),
        ).toEqual({ errors: [] });
        await harness.runSchedule("empty-fork-cleanup");
        expect(archive).toHaveBeenCalledExactlyOnceWith({
          threadId: thread.id,
        });
      }
    },
  );

  it("archives only old forks without user messages and logs what it drops", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = Date.now();
    const old = now - EMPTY_FORK_MAX_AGE_MS - 60_000;
    const emptyOldFork = makeThreadResponse({
      id: "thr_empty_old",
      originKind: "fork",
      originPluginId: PLUGIN_ID,
      visibility: "hidden",
      createdAt: old,
    });
    const repliedOldFork = makeThreadResponse({
      id: "thr_replied_old",
      originKind: "fork",
      originPluginId: PLUGIN_ID,
      visibility: "hidden",
      createdAt: old,
    });
    const emptyYoungFork = makeThreadResponse({
      id: "thr_empty_young",
      originKind: "fork",
      originPluginId: PLUGIN_ID,
      visibility: "hidden",
      createdAt: now - 60_000,
    });
    const foreignFork = makeThreadResponse({
      id: "thr_foreign",
      originKind: "fork",
      originPluginId: "some-other-plugin",
      visibility: "hidden",
      createdAt: old,
    });
    const list = vi.fn(async () => [
      emptyOldFork,
      repliedOldFork,
      emptyYoungFork,
      foreignFork,
    ]);
    const timeline = vi.fn(async ({ threadId }: { threadId: string }) =>
      threadId === "thr_replied_old"
        ? timelineResult([turnRow([conversationRow("a reply", "user")])])
        : timelineResult([conversationRow("assistant only")]),
    );
    const archive = vi.fn(async (_args: { threadId: string }) => ({
      ok: true,
    }));
    const { harness } = await loadPlugin({
      list,
      timeline,
      archive,
      queuedMessages: { list: async () => [] },
    });

    await harness.runSchedule("empty-fork-cleanup");

    expect(list).toHaveBeenCalledWith({
      includeHidden: true,
      originKind: "fork",
      originPluginId: PLUGIN_ID,
      archived: false,
      limit: EMPTY_FORK_SWEEP_PAGE_SIZE,
      offset: 0,
    });
    expect(archive.mock.calls.map(([args]) => args)).toEqual([
      { threadId: "thr_empty_old" },
    ]);
    expect(timeline.mock.calls.map(([args]) => args.threadId)).toEqual([
      "thr_empty_old",
      "thr_replied_old",
    ]);

    vi.setSystemTime(now + EMPTY_FORK_MAX_AGE_MS);
    await harness.runSchedule("empty-fork-cleanup");
    expect(archive.mock.calls.map(([args]) => args.threadId)).toEqual([
      "thr_empty_old",
      "thr_empty_young",
    ]);
  });

  it("advances the page offset by the forks it left behind", async () => {
    const now = Date.now();
    const old = now - EMPTY_FORK_MAX_AGE_MS - 60_000;
    const firstPage = Array.from(
      { length: EMPTY_FORK_SWEEP_PAGE_SIZE },
      (_unused, index) =>
        makeThreadResponse({
          id: index === 0 ? "thr_replied" : `thr_empty_${index}`,
          originKind: "fork",
          originPluginId: PLUGIN_ID,
          visibility: "hidden",
          createdAt: old,
        }),
    );
    const list = vi.fn(async ({ offset }: { offset?: number }) =>
      offset === 0 ? firstPage : [],
    );
    const { harness } = await loadPlugin({
      list,
      timeline: async ({ threadId }: { threadId: string }) =>
        threadId === "thr_replied"
          ? timelineResult([turnRow([conversationRow("a reply", "user")])])
          : timelineResult([]),
      archive: async (_args: { threadId: string }) => ({ ok: true }),
      queuedMessages: { list: async () => [] },
    });

    await harness.runSchedule("empty-fork-cleanup");

    expect(list.mock.calls.map(([args]) => args.offset)).toEqual([0, 1]);
  });

  it("keeps an old empty-timeline fork that has queued-but-unsent input", async () => {
    const now = Date.now();
    const fork = makeThreadResponse({
      id: "thr_queued_only",
      originKind: "fork",
      originPluginId: PLUGIN_ID,
      visibility: "hidden",
      createdAt: now - EMPTY_FORK_MAX_AGE_MS - 60_000,
    });
    const archive = vi.fn(async (_args: { threadId: string }) => ({
      ok: true,
    }));
    const { harness } = await loadPlugin({
      list: async () => [fork],
      timeline: async () => timelineResult([]),
      archive,
      queuedMessages: {
        list: vi.fn(async () => [{ id: "qm_1" }]),
      },
    });

    await harness.runSchedule("empty-fork-cleanup");

    expect(archive).not.toHaveBeenCalled();
  });

  it("remembers a kept fork and stops re-reading its timeline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = Date.now();
    const fork = makeThreadResponse({
      id: "thr_has_work",
      originKind: "fork",
      originPluginId: PLUGIN_ID,
      visibility: "hidden",
      createdAt: now - 60_000,
    });
    const timeline = vi.fn(async () =>
      timelineResult([turnRow([conversationRow("a reply", "user")])]),
    );
    const archive = vi.fn(async (_args: { threadId: string }) => ({
      ok: true,
    }));
    const { harness } = await loadPlugin({
      list: async () => [fork],
      timeline,
      archive,
      queuedMessages: { list: async () => [] },
    });

    await harness.runSchedule("empty-fork-cleanup");
    expect(timeline).not.toHaveBeenCalled();
    vi.setSystemTime(now + EMPTY_FORK_MAX_AGE_MS);
    await harness.runSchedule("empty-fork-cleanup");
    await harness.runSchedule("empty-fork-cleanup");

    expect(timeline).toHaveBeenCalledTimes(1);
    expect(archive).not.toHaveBeenCalled();
  });

  it("retries a fork whose timeline read failed", async () => {
    const now = Date.now();
    const fork = makeThreadResponse({
      id: "thr_unreadable",
      originKind: "fork",
      originPluginId: PLUGIN_ID,
      visibility: "hidden",
      createdAt: now - EMPTY_FORK_MAX_AGE_MS - 60_000,
    });
    const timeline = vi.fn(async () => {
      throw new Error("timeline unavailable");
    });
    const { harness } = await loadPlugin({
      list: async () => [fork],
      timeline,
      archive: async (_args: { threadId: string }) => ({ ok: true }),
      queuedMessages: { list: async () => [] },
    });

    await harness.runSchedule("empty-fork-cleanup");
    await harness.runSchedule("empty-fork-cleanup");

    expect(timeline).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the queued-message read fails", async () => {
    const now = Date.now();
    const fork = makeThreadResponse({
      id: "thr_unreadable_queue",
      originKind: "fork",
      originPluginId: PLUGIN_ID,
      visibility: "hidden",
      createdAt: now - EMPTY_FORK_MAX_AGE_MS - 60_000,
    });
    const archive = vi.fn(async (_args: { threadId: string }) => ({
      ok: true,
    }));
    const { harness } = await loadPlugin({
      list: async () => [fork],
      timeline: async () => timelineResult([]),
      archive,
      queuedMessages: {
        list: vi.fn(async () => {
          throw new Error("queue read boom");
        }),
      },
    });

    await harness.runSchedule("empty-fork-cleanup");

    expect(archive).not.toHaveBeenCalled();
  });
});
