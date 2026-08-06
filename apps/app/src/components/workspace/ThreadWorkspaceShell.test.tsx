// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadWorkspaceShell } from "./ThreadWorkspaceShell";

const MAIN_TABS = [
  { id: "chat", label: "Chat" },
  { id: "file:README.md", label: "README.md", closeLabel: "Close README.md" },
];
const UPPER_TABS = [
  { id: "all-files", label: "All files" },
  { id: "changes", label: "Changes" },
  { id: "checks", label: "Checks" },
];
const LOWER_TABS = [
  { id: "setup", label: "Setup" },
  { id: "run", label: "Run" },
  { id: "terminal", label: "Terminal" },
];

afterEach(cleanup);

function renderShell(isCompact = false) {
  const onSelectMainTab = vi.fn();
  render(
    <ThreadWorkspaceShell
      activeLowerTabId="terminal"
      activeMainTabId="chat"
      activeUpperTabId="all-files"
      isCompact={isCompact}
      lowerContent={<div>terminal viewport</div>}
      lowerTabs={LOWER_TABS}
      mainContent={<div>conversation</div>}
      mainTabs={MAIN_TABS}
      onSelectLowerTab={vi.fn()}
      onSelectMainTab={onSelectMainTab}
      onSelectUpperTab={vi.fn()}
      upperContent={<div>repository content</div>}
      upperTabs={UPPER_TABS}
    />,
  );
  return { onSelectMainTab };
}

describe("ThreadWorkspaceShell", () => {
  it("keeps repository and terminal tabs inside the fixed sidebar", () => {
    renderShell();

    const sidebar = screen.getByTestId("thread-workspace-sidebar");
    expect(
      sidebar.contains(
        screen.getByRole("tablist", { name: "Repository tabs" }),
      ),
    ).toBe(true);
    expect(
      sidebar.contains(
        screen.getByRole("tablist", { name: "Worktree terminal tabs" }),
      ),
    ).toBe(true);
    expect(
      sidebar.contains(screen.getByTestId("thread-workspace-terminal-region")),
    ).toBe(true);
  });

  it("selects a main workspace tab", () => {
    const { onSelectMainTab } = renderShell();
    fireEvent.click(screen.getByRole("tab", { name: "README.md" }));
    expect(onSelectMainTab).toHaveBeenCalledWith("file:README.md");
  });

  it("does not force the split sidebar into compact layouts", () => {
    renderShell(true);
    expect(screen.queryByTestId("thread-workspace-sidebar")).toBeNull();
    expect(screen.getByText("conversation")).not.toBeNull();
  });
});
