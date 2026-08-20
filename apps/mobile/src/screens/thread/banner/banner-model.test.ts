import { describe, expect, it } from "vitest";
import { threadListEntry } from "@/data/test/fixtures";
import {
  buildChildThreadsSection,
  buildParentThreadSection,
  resolveThreadBannerLayout,
  type ThreadBannerSections,
} from "./banner-model";

const SIDE_CHAT = "side-chat";

const baseThread = {
  id: "thr_1",
  projectId: "proj_1",
  parentThreadId: null,
  sourceThreadId: null,
  originKind: null,
  originPluginId: null,
};

const related = {
  id: "thr_parent",
  title: "Parent thread",
  titleFallback: null,
  projectId: "proj_1",
  archivedAt: null,
  deletedAt: null,
};

describe("buildParentThreadSection", () => {
  it("links the hierarchy parent even from another project, with an id fallback while loading", () => {
    const thread = { ...baseThread, parentThreadId: "thr_parent" };
    expect(
      buildParentThreadSection({
        thread,
        relatedThread: undefined,
        sideChatPluginId: SIDE_CHAT,
      }),
    ).toEqual({
      threadId: "thr_parent",
      title: "thr_pare",
      relationship: "parent",
    });
    expect(
      buildParentThreadSection({
        thread,
        relatedThread: { ...related, projectId: "proj_other" },
        sideChatPluginId: SIDE_CHAT,
      }),
    ).toEqual({
      threadId: "thr_parent",
      title: "Parent thread",
      relationship: "parent",
    });
  });

  it("describes forks and side chats by their source, dropping archived or cross-project sources", () => {
    const fork = {
      ...baseThread,
      sourceThreadId: "thr_parent",
      originKind: "fork" as const,
    };
    expect(
      buildParentThreadSection({
        thread: fork,
        relatedThread: related,
        sideChatPluginId: SIDE_CHAT,
      }),
    ).toMatchObject({ relationship: "fork", title: "Parent thread" });
    expect(
      buildParentThreadSection({
        thread: { ...fork, originPluginId: SIDE_CHAT },
        relatedThread: related,
        sideChatPluginId: SIDE_CHAT,
      }),
    ).toMatchObject({ relationship: "side-chat" });
    expect(
      buildParentThreadSection({
        thread: fork,
        relatedThread: { ...related, archivedAt: 5 },
        sideChatPluginId: SIDE_CHAT,
      }),
    ).toBeNull();
    expect(
      buildParentThreadSection({
        thread: fork,
        relatedThread: { ...related, projectId: "proj_other" },
        sideChatPluginId: SIDE_CHAT,
      }),
    ).toBeNull();
    expect(
      buildParentThreadSection({
        thread: baseThread,
        relatedThread: undefined,
        sideChatPluginId: SIDE_CHAT,
      }),
    ).toBeNull();
  });
});

describe("buildChildThreadsSection", () => {
  it("keeps running or blocked delegated children, blocked first, and skips forks", () => {
    const section = buildChildThreadsSection([
      threadListEntry({
        id: "c_idle",
        runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
      }),
      threadListEntry({
        id: "c_active",
        title: "Active child",
        runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
      }),
      threadListEntry({
        id: "c_blocked",
        title: "Blocked child",
        hasPendingInteraction: true,
      }),
      threadListEntry({
        id: "c_fork",
        originKind: "fork",
        runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
      }),
    ]);
    expect(section?.items.map((item) => item.id)).toEqual([
      "c_blocked",
      "c_active",
    ]);
    expect(section?.pendingCount).toBe(1);
    expect(section?.label).toBe("1 child thread needs input");
    expect(section?.primary.title).toBe("Blocked child");
  });

  it("returns null without active children", () => {
    expect(buildChildThreadsSection([threadListEntry({ id: "c" })])).toBeNull();
    expect(buildChildThreadsSection(undefined)).toBeNull();
    expect(
      buildChildThreadsSection([
        threadListEntry({
          id: "a",
          runtime: {
            displayStatus: "active",
            hostReconnectGraceExpiresAt: null,
          },
        }),
        threadListEntry({
          id: "b",
          runtime: {
            displayStatus: "active",
            hostReconnectGraceExpiresAt: null,
          },
        }),
      ])?.label,
    ).toBe("2 active child threads");
  });
});

describe("resolveThreadBannerLayout", () => {
  const empty: ThreadBannerSections = {
    archived: null,
    environmentGone: null,
    parent: null,
    children: null,
    pullRequest: null,
    git: null,
  };
  const parent = { threadId: "p", title: "P", relationship: "parent" as const };

  it("replaces live sections with the read-only row when archived or the environment is gone", () => {
    expect(
      resolveThreadBannerLayout(
        { ...empty, archived: { archivedAt: 1 }, parent },
        { gitSectionPending: false },
      ),
    ).toEqual({
      kind: "read-only",
      statusLabel: "Thread is archived",
      icon: "Archive",
      offerUnarchive: true,
      parent,
    });
    expect(
      resolveThreadBannerLayout(
        {
          ...empty,
          archived: { archivedAt: 1 },
          environmentGone: { status: "destroyed" },
        },
        { gitSectionPending: false },
      ),
    ).toMatchObject({
      kind: "read-only",
      statusLabel: "Environment archived",
      offerUnarchive: false,
    });
  });

  it("hides while the git section is pending and when nothing applies", () => {
    expect(
      resolveThreadBannerLayout(
        { ...empty, parent },
        { gitSectionPending: true },
      ),
    ).toEqual({ kind: "hidden" });
    expect(
      resolveThreadBannerLayout(empty, { gitSectionPending: false }),
    ).toEqual({ kind: "hidden" });
    expect(
      resolveThreadBannerLayout(
        { ...empty, parent },
        { gitSectionPending: false },
      ),
    ).toMatchObject({ kind: "live", parent });
  });
});
