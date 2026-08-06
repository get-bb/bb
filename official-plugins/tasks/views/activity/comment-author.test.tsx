// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DisplayComment } from "../../shared/contract.js";
import { CommentAuthor } from "./comment-author.js";

afterEach(cleanup);

const base: DisplayComment = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZC1",
  taskId: "01HZZZZZZZZZZZZZZZZZZZZZT1",
  kind: "agent",
  authorName: "agent (thr_worker)",
  presetName: null,
  threadId: "thr_worker",
  threadTitle: "Fix the login bug",
  provider: { id: "codex", name: "Codex", logoUrl: null },
  body: "Done",
  notifiedCount: 0,
  createdAt: "2026-07-15T00:00:00.000Z",
  actor: {
    principalId: "system:legacy",
    principalKind: "system",
    displayName: "System (legacy)",
  },
};

describe("CommentAuthor", () => {
  it("renders an agent thread title as a link that opens the chat", () => {
    const onOpenThread = vi.fn();
    render(<CommentAuthor comment={base} onOpenThread={onOpenThread} />);

    const link = screen.getByRole("button", { name: "Fix the login bug" });
    fireEvent.click(link);

    expect(onOpenThread).toHaveBeenCalledTimes(1);
    expect(onOpenThread).toHaveBeenCalledWith("thr_worker");
  });

  it("renders legacy authorName when the title is unresolved", () => {
    const onOpenThread = vi.fn();
    render(
      <CommentAuthor
        comment={{ ...base, threadTitle: null }}
        onOpenThread={onOpenThread}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("agent (thr_worker)")).toBeTruthy();
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it("labels unresolved modern agents with an Agent prefix", () => {
    render(
      <CommentAuthor
        comment={{
          ...base,
          threadTitle: null,
          authorName: "should-not-win",
          actor: {
            principalId: "agent:thread/thr_worker",
            principalKind: "agent",
            displayName: "Thread agent",
          },
        }}
        onOpenThread={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Agent · Thread agent")).toBeTruthy();
  });

  it("renders modern human actor display names", () => {
    render(
      <CommentAuthor
        comment={{
          ...base,
          kind: "user",
          authorName: "legacy",
          threadTitle: null,
          actor: {
            principalId: "user_alice",
            principalKind: "human",
            displayName: "Alice",
          },
        }}
        onOpenThread={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Alice")).toBeTruthy();
  });

  it("never links a user comment even when a thread id and title are present", () => {
    render(
      <CommentAuthor
        comment={{
          ...base,
          kind: "user",
          authorName: "You",
          threadTitle: "Should be ignored",
          actor: {
            principalId: "local-owner",
            principalKind: "human",
            displayName: "Local Owner",
          },
        }}
        onOpenThread={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Local Owner")).toBeTruthy();
  });
});
