// @vitest-environment jsdom

import type { ImperativePanelHandle } from "react-resizable-panels";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadWorkspaceShell } from "./ThreadWorkspaceShell";

vi.mock("react-resizable-panels", async () => {
  const React = await import("react");

  const PanelGroup = ({ children }: { children?: ReactNode }) => (
    <div data-testid="panel-group">{children}</div>
  );
  const Panel = React.forwardRef<
    ImperativePanelHandle,
    {
      children?: ReactNode;
      defaultSize?: number;
      id?: string;
      onCollapse?: () => void;
      onExpand?: () => void;
      onResize?: (size: number) => void;
    }
  >(
    (
      {
        children,
        defaultSize = 0,
        id = "panel",
        onCollapse,
        onExpand,
        onResize,
      },
      ref,
    ) => {
      const sizeRef = React.useRef(defaultSize);
      React.useImperativeHandle(
        ref,
        () => ({
          collapse: () => {
            sizeRef.current = 0;
            onCollapse?.();
          },
          expand: (size = defaultSize) => {
            sizeRef.current = size;
            onExpand?.();
            onResize?.(size);
          },
          getId: () => id,
          getSize: () => sizeRef.current,
          isCollapsed: () => sizeRef.current === 0,
          isExpanded: () => sizeRef.current > 0,
          resize: (size) => {
            sizeRef.current = size;
            onResize?.(size);
          },
        }),
        [defaultSize, id, onCollapse, onExpand, onResize],
      );
      return <div data-panel-id={id}>{children}</div>;
    },
  );
  Panel.displayName = "MockPanel";
  const PanelResizeHandle = ({
    "aria-label": ariaLabel,
    disabled,
  }: {
    "aria-label"?: string;
    disabled?: boolean;
  }) => (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
    />
  );

  return { Panel, PanelGroup, PanelResizeHandle };
});

const MAIN_TABS = [
  { id: "chat", label: "Chat" },
  {
    id: "file:README.md",
    label: "README.md",
    closeLabel: "Close README.md",
    isDirty: true,
  },
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

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderShell(isCompact = false) {
  const onCreateChat = vi.fn();
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
      onCreateChat={onCreateChat}
      onSelectLowerTab={vi.fn()}
      onSelectMainTab={onSelectMainTab}
      onSelectUpperTab={vi.fn()}
      upperTrailingContent={<button type="button">Open GitHub</button>}
      upperContent={<div>repository content</div>}
      upperTabs={UPPER_TABS}
    />,
  );
  return { onCreateChat, onSelectMainTab };
}

describe("ThreadWorkspaceShell", () => {
  it("keeps repository and terminal tabs inside the resizable sidebar", () => {
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
      screen
        .getByRole("tablist", { name: "Worktree terminal tabs" })
        .parentElement?.contains(
          screen.getByTestId("workspace-terminal-toolbar-host"),
        ),
    ).toBe(true);
    expect(
      sidebar.contains(screen.getByTestId("thread-workspace-terminal-region")),
    ).toBe(true);
    expect(
      sidebar.contains(screen.getByRole("button", { name: "Open GitHub" })),
    ).toBe(true);
    expect(
      screen.getByRole("separator", {
        name: "Resize thread workspace sidebar",
      }),
    ).not.toBeNull();
  });

  it("places the sidebar control in the main workspace and toggles visibility", () => {
    renderShell();

    const sidebar = screen.getByTestId("thread-workspace-sidebar");
    const workspaceTabs = screen.getByRole("tablist", {
      name: "Workspace tabs",
    });
    const hideButton = screen.getByRole("button", {
      name: "Hide workspace sidebar",
    });
    expect(sidebar.contains(hideButton)).toBe(false);
    expect(workspaceTabs.parentElement?.contains(hideButton)).toBe(true);

    fireEvent.click(hideButton);
    fireEvent.click(
      screen.getByRole("button", { name: "Show workspace sidebar" }),
    );
    expect(
      screen.getByRole("button", { name: "Hide workspace sidebar" }),
    ).not.toBeNull();
  });

  it("selects a main workspace tab", () => {
    const { onSelectMainTab } = renderShell();
    fireEvent.click(
      screen.getByRole("tab", { name: "README.md, unsaved changes" }),
    );
    expect(onSelectMainTab).toHaveBeenCalledWith("file:README.md");
  });

  it("creates a chat from the workspace tab strip", () => {
    const { onCreateChat } = renderShell();
    const workspaceTabs = screen.getByRole("tablist", {
      name: "Workspace tabs",
    });
    const createButton = screen.getByRole("button", {
      name: "Create new chat in this worktree",
    });

    expect(workspaceTabs.contains(createButton)).toBe(true);
    fireEvent.click(createButton);
    expect(onCreateChat).toHaveBeenCalledOnce();
  });

  it("moves between workspace tabs with the keyboard", () => {
    const { onSelectMainTab } = renderShell();
    const chatTab = screen.getByRole("tab", { name: "Chat" });
    fireEvent.keyDown(chatTab, { key: "ArrowRight" });
    expect(onSelectMainTab).toHaveBeenCalledWith("file:README.md");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "README.md, unsaved changes" }),
    );
  });

  it("shows the unsaved indicator before the file name", () => {
    renderShell();
    const tab = screen.getByRole("tab", {
      name: "README.md, unsaved changes",
    });
    expect(tab.textContent).toBe("README.md");
    expect(
      tab.querySelector("span > span")?.nextElementSibling?.textContent,
    ).toBe("README.md");
  });

  it("does not force the split sidebar into compact layouts", () => {
    renderShell(true);
    expect(screen.queryByTestId("thread-workspace-sidebar")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Show workspace sidebar" }),
    ).toBeNull();
    expect(screen.getByText("conversation")).not.toBeNull();
  });
});
