// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type {
  ApprovalPendingInteractionPayload,
  PendingInteraction,
} from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { ThreadPendingInteractionBanner } from "./ThreadPendingInteractionBanner";

vi.mock("@/hooks/mutations/thread-interaction-mutations", () => ({
  useResolveThreadPendingInteraction: () => ({
    error: null,
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

function makeInteraction(
  payload: ApprovalPendingInteractionPayload,
): PendingInteraction {
  return {
    id: "pi_test",
    threadId: "thr_test",
    turnId: "turn_test",
    providerId: "codex",
    providerThreadId: "provider-thread-test",
    providerRequestId: "request-test",
    status: "pending",
    payload,
    resolution: null,
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
  };
}

function renderInteraction(interaction: PendingInteraction) {
  return render(
    <ThreadPendingInteractionBanner
      interaction={interaction}
      threadId={interaction.threadId}
    />,
  );
}

describe("ThreadPendingInteractionBanner", () => {
  it("keeps command approval details selectable", () => {
    const interaction = makeInteraction({
      kind: "approval",
      subject: {
        kind: "command",
        itemId: "item_command",
        command: "pnpm test",
        cwd: "/workspace/project",
        actions: [],
        sessionGrant: null,
      },
      reason: "Run the tests?",
      availableDecisions: ["allow_once", "deny"],
    });

    renderInteraction(interaction);

    expect(
      screen.getByText("/workspace/project").closest(".select-text"),
    ).not.toBeNull();
  });

  it("keeps file-change approval details selectable", () => {
    const interaction = makeInteraction({
      kind: "approval",
      subject: {
        kind: "file_change",
        itemId: "item_file",
        writeScope: "/workspace/write",
        sessionGrant: null,
      },
      reason: "Write files?",
      availableDecisions: ["allow_once", "deny"],
    });

    renderInteraction(interaction);

    expect(
      screen.getByText("Write root: /workspace/write").closest(".select-text"),
    ).not.toBeNull();
  });

  it("keeps permission-grant approval details selectable", () => {
    const interaction = makeInteraction({
      kind: "approval",
      subject: {
        kind: "permission_grant",
        itemId: "item_permission",
        toolName: "WebFetch",
        permissions: {
          network: { enabled: true },
          fileSystem: null,
        },
      },
      reason: "Use the network?",
      availableDecisions: ["allow_once", "deny"],
    });

    renderInteraction(interaction);

    expect(
      screen.getByText("Permission: Network access").closest(".select-text"),
    ).not.toBeNull();
  });

  it("keeps plan file paths selectable", () => {
    const interaction = makeInteraction({
      kind: "approval",
      subject: {
        kind: "plan",
        itemId: "item_plan",
        plan: "# Plan\n\nShip it.",
        planFilePath: "/workspace/plan.md",
      },
      reason: "Start coding?",
      availableDecisions: ["allow_once", "deny"],
    });

    renderInteraction(interaction);

    expect(
      screen.getByText("/workspace/plan.md").closest(".select-text"),
    ).not.toBeNull();
  });
});
