// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadGitActionDialog } from "./ThreadGitActionDialog";

afterEach(cleanup);

describe("ThreadGitActionDialogContent", () => {
  it("renders off-page remote merge-base selections in the remote section", () => {
    render(
      <ThreadGitActionDialog
        target={{ kind: "squash_merge" }}
        showMergeBaseDetails
        mergeBaseBranch="upstream/main"
        mergeBaseBranchRef={{ name: "upstream/main", kind: "remote" }}
        mergeBaseBranchOptions={["main"]}
        mergeBaseRemoteBranchOptions={["origin/main"]}
        onMergeBaseBranchChange={vi.fn()}
        onOpenChange={vi.fn()}
        onCommit={async () => {}}
        onSquashMerge={async () => {}}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Branch" }));

    const remoteHeader = screen.getByText("Remote branches");
    const remoteOption = screen.getByRole("button", {
      name: "upstream/main",
    });

    expect(
      remoteHeader.compareDocumentPosition(remoteOption) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("blocks remote-only squash merge from exact selected-branch classification", () => {
    render(
      <ThreadGitActionDialog
        target={{ kind: "squash_merge" }}
        showMergeBaseDetails
        mergeBaseBranch="origin/main"
        mergeBaseBranchRef={{ name: "origin/main", kind: "remote" }}
        mergeBaseBranchOptions={["main"]}
        mergeBaseRemoteBranchOptions={[]}
        onMergeBaseBranchChange={vi.fn()}
        onOpenChange={vi.fn()}
        onCommit={async () => {}}
        onSquashMerge={async () => {}}
      />,
    );

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Squash merge" })
        .disabled,
    ).toBe(true);
    const submitButton = screen.getByRole<HTMLButtonElement>("button", {
      name: "Squash merge",
    });
    const alert = screen.getByRole("alert");
    expect(
      screen.getByText("Squash merge requires a local target branch."),
    ).not.toBeNull();
    expect(alert.parentElement).toBe(submitButton.parentElement);
    expect(
      alert.compareDocumentPosition(submitButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(alert.className).toContain("text-destructive");
    expect(alert.className).not.toContain("bg-surface-destructive");
    expect(alert.className).not.toContain("border");
  });

  it("renders pending merge-base classification as neutral status", () => {
    render(
      <ThreadGitActionDialog
        target={{ kind: "commit_and_squash_merge" }}
        showMergeBaseDetails
        mergeBaseBranch="main"
        mergeBaseBranchOptions={["main"]}
        mergeBaseRemoteBranchOptions={[]}
        mergeBaseBranchOptionsLoading
        onMergeBaseBranchChange={vi.fn()}
        onOpenChange={vi.fn()}
        onCommit={async () => {}}
        onSquashMerge={async () => {}}
      />,
    );

    const status = screen.getByRole("status");
    const submitButton = screen.getByRole<HTMLButtonElement>("button", {
      name: "Commit + squash merge",
    });
    const form = submitButton.closest("form");

    expect(status.textContent).toContain("Checking target branch");
    expect(status.parentElement).toBe(submitButton.parentElement);
    expect(
      status.compareDocumentPosition(submitButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(status.className).toContain("text-muted-foreground");
    expect(status.className).not.toContain("bg-surface-recessed");
    expect(status.className).not.toContain("bg-surface-destructive");
    expect(status.className).not.toContain("border");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(submitButton.disabled).toBe(true);
    expect(submitButton.title).toBe("Checking target branch");

    if (!form) {
      throw new Error("Expected git action dialog form.");
    }

    fireEvent.submit(form);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("allows local squash merge even when the selected branch is not in the current page", () => {
    render(
      <ThreadGitActionDialog
        target={{ kind: "squash_merge" }}
        showMergeBaseDetails
        mergeBaseBranch="release/1.2"
        mergeBaseBranchRef={{ name: "release/1.2", kind: "local" }}
        mergeBaseBranchOptions={["main"]}
        mergeBaseRemoteBranchOptions={[]}
        onMergeBaseBranchChange={vi.fn()}
        onOpenChange={vi.fn()}
        onCommit={async () => {}}
        onSquashMerge={async () => {}}
      />,
    );

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Squash merge" })
        .disabled,
    ).toBe(false);
  });
});
