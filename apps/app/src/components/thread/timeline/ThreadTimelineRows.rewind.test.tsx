// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  ThreadRewindPreviewResponse,
  TimelineConversationRow,
} from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conversationRow, turnRow } from "@/test/fixtures/thread-timeline-rows";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { sdk } from "@/lib/sdk";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      threads: {
        rewind: {
          branches: vi.fn(),
          commit: vi.fn(),
          preview: vi.fn(),
          restore: vi.fn(),
        },
      },
    },
  };
});

function eligiblePreview(turnId: string): ThreadRewindPreviewResponse {
  return {
    displacedTurnCount: 2,
    eligibility: { status: "eligible" },
    mode: "conversation-only",
    provider: "codex",
    revision: 5,
    sourceSequence: 42,
    startsFreshProviderSession: false,
    target: { branchId: "br_1", sourceSequence: 42, turnId },
  };
}

function userMessageRow(
  overrides: Partial<
    Parameters<typeof conversationRow>[0] & {
      turnRequest?: { kind: "message" | "steer"; status: "accepted" | "pending" };
    }
  > = {},
): TimelineConversationRow {
  return conversationRow({
    id: "user_msg",
    initiator: "user",
    role: "user",
    senderThreadId: null,
    sourceSeqStart: 42,
    sourceSeqEnd: 42,
    text: "Fix the sidebar overflow",
    threadId: "thr_main",
    turnId: "turn_1",
    turnRequest: { kind: "message", status: "accepted" },
    ...overrides,
  });
}

function renderTimeline(
  rows: TimelineConversationRow[],
  options: { onRewindMessage?: (target: unknown) => void } = {},
) {
  const harness = createQueryClientTestHarness();
  const onRewindMessage = options.onRewindMessage ?? vi.fn();
  render(
    <MemoryRouter>
      <ThreadTimelineRows
        initialExpanded={new Set(["turn"])}
        onRewindMessage={onRewindMessage}
        rewindBranchId="br_1"
        rewindStatusKey="idle"
        threadId="thr_main"
        threadRuntimeDisplayStatus="idle"
        timelineRows={[
          turnRow({
            id: "turn",
            sourceSeqStart: 40,
            sourceSeqEnd: 80,
            children: rows,
            threadId: "thr_main",
          }),
        ]}
        workspaceRootPath={undefined}
      />
    </MemoryRouter>,
    { wrapper: harness.wrapper },
  );
  return { onRewindMessage };
}

beforeEach(() => {
  vi.mocked(sdk.threads.rewind.preview).mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadTimelineRows rewind action", () => {
  it("shows the edit action only when the server preview resolves eligible", async () => {
    vi.mocked(sdk.threads.rewind.preview).mockResolvedValue(
      eligiblePreview("turn_1"),
    );
    renderTimeline([userMessageRow()]);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit and rewind" }),
      ).toBeTruthy(),
    );
    expect(sdk.threads.rewind.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: "br_1",
        sourceSequence: 42,
        threadId: "thr_main",
        turnId: "turn_1",
      }),
    );
  });

  it("never renders the edit action for ineligible messages", async () => {
    vi.mocked(sdk.threads.rewind.preview).mockResolvedValue({
      ...eligiblePreview("turn_1"),
      eligibility: {
        reason: "missing-provider-checkpoint",
        status: "ineligible",
      },
    });
    renderTimeline([userMessageRow()]);
    await waitFor(() =>
      expect(sdk.threads.rewind.preview).toHaveBeenCalled(),
    );
    expect(
      screen.queryByRole("button", { name: "Edit and rewind" }),
    ).toBeNull();
  });

  it("does not query or render the action for assistant messages", () => {
    renderTimeline([
      conversationRow({
        id: "assistant_msg",
        role: "assistant",
        text: "An answer.",
        sourceSeqStart: 50,
        sourceSeqEnd: 50,
        threadId: "thr_main",
        turnId: "turn_1",
      }),
    ]);
    expect(
      screen.queryByRole("button", { name: "Edit and rewind" }),
    ).toBeNull();
    expect(sdk.threads.rewind.preview).not.toHaveBeenCalled();
  });

  it("does not render the action for steers or side-chat rows", () => {
    renderTimeline([
      userMessageRow({
        id: "steer_msg",
        turnRequest: { kind: "steer", status: "accepted" },
      }),
      userMessageRow({
        id: "side_msg",
        senderThreadId: "thr_side",
      }),
    ]);
    expect(
      screen.queryByRole("button", { name: "Edit and rewind" }),
    ).toBeNull();
    expect(sdk.threads.rewind.preview).not.toHaveBeenCalled();
  });

  it("fires the host handler with the row's rewind target", async () => {
    vi.mocked(sdk.threads.rewind.preview).mockResolvedValue(
      eligiblePreview("turn_1"),
    );
    const onRewindMessage = vi.fn();
    renderTimeline([userMessageRow()], { onRewindMessage });
    const edit = await screen.findByRole("button", {
      name: "Edit and rewind",
    });
    fireEvent.click(edit);
    expect(onRewindMessage).toHaveBeenCalledWith({
      sourceSequence: 42,
      text: "Fix the sidebar overflow",
      mentions: [],
      turnId: "turn_1",
    });
  });

  it("stays hidden when no rewind host supplies a handler", () => {
    const harness = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <ThreadTimelineRows
          initialExpanded={new Set(["turn"])}
          rewindBranchId="br_1"
          rewindStatusKey="idle"
          threadId="thr_main"
          threadRuntimeDisplayStatus="idle"
          timelineRows={[
            turnRow({
              id: "turn",
              sourceSeqStart: 40,
              sourceSeqEnd: 80,
              children: [userMessageRow()],
              threadId: "thr_main",
            }),
          ]}
          workspaceRootPath={undefined}
        />
      </MemoryRouter>,
      { wrapper: harness.wrapper },
    );
    expect(
      screen.queryByRole("button", { name: "Edit and rewind" }),
    ).toBeNull();
    expect(sdk.threads.rewind.preview).not.toHaveBeenCalled();
  });
});
