// Backend tests: reply-anchor seed policy, archive cascade, empty-fork sweep.
import { describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@bb/plugin-sdk/testing";
import plugin, {
  EMPTY_FORK_MAX_AGE_MS,
  REPLY_SEED_PREFIX,
  lastConversationMessageText,
  resolveReplySeedText,
  shouldSweepEmptyFork,
  timelineRowsContainUserMessage,
  type SideChatForkCandidate,
  type SideChatTimelineRowLike,
} from "./server";

const PLUGIN_ID = "side-chat";

function conversationRow(text: string, role = "assistant") {
  return { kind: "conversation", role, text };
}

function turnRow(children: SideChatTimelineRowLike[] | null) {
  return { kind: "turn", children };
}

function timelineResult(rows: SideChatTimelineRowLike[]) {
  return { rows };
}

async function loadPlugin(sdkThreads: Record<string, unknown>) {
  const host = createFakePluginHost({
    pluginId: PLUGIN_ID,
    sdk: { threads: sdkThreads },
  });
  await plugin(host.bb);
  return host;
}

describe("lastConversationMessageText", () => {
  it("returns the last non-empty conversation text, recursing into turns", () => {
    expect(
      lastConversationMessageText([
        conversationRow("first"),
        turnRow([{ kind: "work" }, conversationRow("nested last")]),
        { kind: "system" },
      ]),
    ).toBe("nested last");
  });

  it("ignores empty conversation rows and returns null with none", () => {
    expect(lastConversationMessageText([conversationRow("   ")])).toBeNull();
    expect(lastConversationMessageText([turnRow(null)])).toBeNull();
  });
});

describe("resolveReplySeedText", () => {
  const rows = [conversationRow("earlier answer"), conversationRow("latest answer")];

  it("returns null when the anchor IS the source's last conversation message", () => {
    expect(
      resolveReplySeedText({
        anchorText: "  latest answer  ",
        sourceTimelineRows: rows,
      }),
    ).toBeNull();
  });

  it("returns the trimmed anchor for an earlier message", () => {
    expect(
      resolveReplySeedText({
        anchorText: " earlier answer ",
        sourceTimelineRows: rows,
      }),
    ).toBe("earlier answer");
  });

  it("returns null for an empty anchor (tip forks carry no seed)", () => {
    expect(
      resolveReplySeedText({ anchorText: "  ", sourceTimelineRows: rows }),
    ).toBeNull();
  });

  it("returns the anchor when the source has no conversation messages", () => {
    expect(
      resolveReplySeedText({ anchorText: "anchor", sourceTimelineRows: [] }),
    ).toBe("anchor");
  });
});

describe("createSideChat rpc", () => {
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
      anchorText: "earlier answer",
    });

    expect(result).toEqual({ threadId: "thr_fork" });
    expect(fork).toHaveBeenCalledWith({
      sourceThreadId: "thr_src",
      sourceSeqEnd: 42,
      visibility: "hidden",
      workspace: "isolated",
      agentContextSeed: [
        {
          type: "text",
          text: `${REPLY_SEED_PREFIX}earlier answer`,
          mentions: [],
          visibility: "agent-only",
        },
      ],
    });
  });

  it("forks without a seed when the anchor is the last conversation message", async () => {
    const fork = vi.fn(async () => makeThreadResponse({ id: "thr_fork" }));
    const { harness } = await loadPlugin({
      timeline: async () => timelineResult([conversationRow("latest answer")]),
      fork,
    });

    await harness.callRpc("createSideChat", {
      sourceThreadId: "thr_src",
      sourceSeqEnd: 7,
      anchorText: "latest answer",
    });

    expect(fork).toHaveBeenCalledWith({
      sourceThreadId: "thr_src",
      sourceSeqEnd: 7,
      visibility: "hidden",
      workspace: "isolated",
    });
  });

  it("forks from the tip without a seed or sourceSeqEnd for empty anchors", async () => {
    const fork = vi.fn(async () => makeThreadResponse({ id: "thr_fork" }));
    const { harness } = await loadPlugin({
      timeline: async () => timelineResult([conversationRow("latest answer")]),
      fork,
    });

    await harness.callRpc("createSideChat", {
      sourceThreadId: "thr_src",
      anchorText: "",
    });

    expect(fork).toHaveBeenCalledWith({
      sourceThreadId: "thr_src",
      visibility: "hidden",
      workspace: "isolated",
    });
  });
});

describe("sendToMain rpc", () => {
  it("queues the text on the source thread with the fork as sender", async () => {
    const create = vi.fn(async () => ({ id: "qm_1" }));
    const { harness } = await loadPlugin({ queuedMessages: { create } });

    const result = await harness.callRpc("sendToMain", {
      sourceThreadId: "thr_src",
      senderThreadId: "thr_fork",
      text: "the answer",
    });

    expect(result).toEqual({ ok: true });
    expect(create).toHaveBeenCalledWith({
      threadId: "thr_src",
      input: [{ type: "text", text: "the answer", mentions: [] }],
      senderThreadId: "thr_fork",
    });
  });
});

describe("openAsFullThread rpc", () => {
  it("promotes the fork to visible", async () => {
    const update = vi.fn(async () => ({ ok: true }));
    const { harness } = await loadPlugin({ update });

    const result = await harness.callRpc("openAsFullThread", {
      threadId: "thr_fork",
    });

    expect(result).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({
      threadId: "thr_fork",
      visibility: "visible",
    });
  });
});

describe("archive cascade", () => {
  it("archives only this plugin's live hidden forks of the archived source", async () => {
    const ownFork = makeThreadResponse({
      id: "thr_own",
      sourceThreadId: "thr_src",
      originKind: "fork",
      originPluginId: PLUGIN_ID,
      visibility: "hidden",
    });
    const otherPluginFork = makeThreadResponse({
      id: "thr_other",
      sourceThreadId: "thr_src",
      originKind: "fork",
      originPluginId: "some-other-plugin",
      visibility: "hidden",
    });
    const promotedFork = makeThreadResponse({
      id: "thr_promoted",
      sourceThreadId: "thr_src",
      originKind: "fork",
      originPluginId: PLUGIN_ID,
      visibility: "visible",
    });
    const alreadyArchived = makeThreadResponse({
      id: "thr_archived",
      sourceThreadId: "thr_src",
      originKind: "fork",
      originPluginId: PLUGIN_ID,
      visibility: "hidden",
      archivedAt: 123,
    });
    const list = vi.fn(async () => [
      ownFork,
      otherPluginFork,
      promotedFork,
      alreadyArchived,
    ]);
    const archive = vi.fn(async (_args: { threadId: string }) => ({
      ok: true,
    }));
    const { harness } = await loadPlugin({ list, archive });

    const { errors } = await harness.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ id: "thr_src", archivedAt: 456 }),
    });

    expect(errors).toEqual([]);
    expect(list).toHaveBeenCalledWith({
      sourceThreadId: "thr_src",
      includeHidden: true,
    });
    expect(archive.mock.calls.map(([args]) => args)).toEqual([
      { threadId: "thr_own" },
    ]);
  });
});

describe("empty-fork sweep", () => {
  it("shouldSweepEmptyFork requires an old, empty, live hidden own fork", () => {
    const now = 10 * EMPTY_FORK_MAX_AGE_MS;
    const base: SideChatForkCandidate = {
      originKind: "fork",
      originPluginId: PLUGIN_ID,
      visibility: "hidden",
      archivedAt: null,
      createdAt: now - EMPTY_FORK_MAX_AGE_MS - 1,
    };
    const sweep = (
      thread: Partial<SideChatForkCandidate>,
      hasUserMessage = false,
    ): boolean =>
      shouldSweepEmptyFork({
        thread: { ...base, ...thread },
        pluginId: PLUGIN_ID,
        hasUserMessage,
        now,
      });

    expect(sweep({})).toBe(true);
    expect(sweep({}, true)).toBe(false);
    expect(sweep({ createdAt: now - EMPTY_FORK_MAX_AGE_MS })).toBe(false);
    expect(sweep({ visibility: "visible" })).toBe(false);
    expect(sweep({ originPluginId: "other" })).toBe(false);
    expect(sweep({ originKind: "side-chat" })).toBe(false);
    expect(sweep({ archivedAt: 1 })).toBe(false);
  });

  it("timelineRowsContainUserMessage finds nested user rows", () => {
    expect(
      timelineRowsContainUserMessage([
        turnRow([conversationRow("hi", "user")]),
      ]),
    ).toBe(true);
    expect(
      timelineRowsContainUserMessage([conversationRow("reply", "assistant")]),
    ).toBe(false);
  });

  it("archives only old forks without user messages and logs what it drops", async () => {
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
    const { harness } = await loadPlugin({ list, timeline, archive });

    await harness.runSchedule("empty-fork-cleanup");

    expect(list).toHaveBeenCalledWith({
      includeHidden: true,
      originKind: "fork",
    });
    expect(archive.mock.calls.map(([args]) => args)).toEqual([
      { threadId: "thr_empty_old" },
    ]);
    // Only candidates past the age cutoff pay for a timeline read.
    expect(timeline.mock.calls.map(([args]) => args.threadId)).toEqual([
      "thr_empty_old",
      "thr_replied_old",
    ]);
  });
});
