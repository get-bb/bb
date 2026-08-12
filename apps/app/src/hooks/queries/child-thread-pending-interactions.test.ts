import type { PendingInteraction } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { collectChildThreadPendingAttention } from "./child-thread-pending-interactions";

function makeApproval(id: string, createdAt: number): PendingInteraction {
  return {
    id,
    threadId: "thr_child",
    turnId: "turn_1",
    providerId: "codex",
    providerThreadId: "provider-thread",
    providerRequestId: `request-${id}`,
    origin: {
      kind: "provider",
      providerId: "codex",
      providerThreadId: "provider-thread",
      providerRequestId: `request-${id}`,
    },
    status: "pending",
    resolution: null,
    statusReason: null,
    createdAt,
    resolvedAt: null,
    payload: {
      kind: "approval",
      subject: {
        kind: "command",
        itemId: "item_cmd",
        command: "ls",
        cwd: "/tmp",
        actions: [],
        sessionGrant: null,
      },
      reason: "Run a command",
      availableDecisions: ["allow_once", "deny"],
    },
  };
}

describe("collectChildThreadPendingAttention", () => {
  it("keeps only delegated children that still have a pending interaction", () => {
    const latest = makeApproval("pi_new", 20);
    const items = collectChildThreadPendingAttention(
      [
        {
          id: "thr_blocked",
          title: "Install tools",
          href: "/threads/thr_blocked",
          hasPendingInteraction: true,
        },
        {
          id: "thr_working",
          title: "Run tests",
          href: "/threads/thr_working",
          hasPendingInteraction: false,
        },
        {
          id: "thr_stale",
          title: "Old blocker",
          href: "/threads/thr_stale",
          hasPendingInteraction: true,
        },
      ],
      new Map([
        ["thr_blocked", [makeApproval("pi_old", 10), latest]],
        ["thr_working", [makeApproval("pi_ignored", 30)]],
        ["thr_stale", []],
      ]),
    );

    expect(items).toEqual([
      {
        childThreadId: "thr_blocked",
        childTitle: "Install tools",
        href: "/threads/thr_blocked",
        interaction: latest,
      },
    ]);
  });
});
