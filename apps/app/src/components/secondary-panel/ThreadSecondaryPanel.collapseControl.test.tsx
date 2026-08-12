// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelGroup } from "react-resizable-panels";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  createThreadInfoFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadSecondaryPanel } from "./ThreadSecondaryPanel";

afterEach(cleanup);

const noop = () => {};

function renderPanel(args: {
  isConversationCollapsed: boolean;
  onToggleConversationCollapse: () => void;
}) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <Wrapper>
      <TooltipProvider>
        <PanelGroup direction="horizontal">
          <ThreadSecondaryPanel
            activeTab={createThreadInfoFixedPanelTab()}
            canUseGitUi={false}
            isOpen
            metadataContent={null}
            onClose={noop}
            onCollapse={noop}
            onFileTabReorder={noop}
            onOpenNewTab={noop}
            onPanelChange={noop}
            onPanelFocus={noop}
            renderAsDrawer={false}
            {...args}
          />
        </PanelGroup>
      </TooltipProvider>
    </Wrapper>,
  );
}

describe("ThreadSecondaryPanel resize handle", () => {
  it("uses a real 12px hit target centered over the resize seam", () => {
    const view = renderPanel({
      isConversationCollapsed: false,
      onToggleConversationCollapse: noop,
    });

    const handle = view.getByRole("separator", {
      name: "Resize thread and right panel",
    });
    const hitTarget = handle.querySelector("[data-panel-resize-hit-target]");

    expect(handle.className.split(/\s+/u)).toContain("z-[25]");
    expect(hitTarget).not.toBeNull();
    expect(hitTarget?.className.split(/\s+/u)).toEqual(
      expect.arrayContaining([
        "left-1/2",
        "z-10",
        "w-3",
        "-translate-x-1/2",
        "cursor-col-resize",
      ]),
    );
  });
});

describe("ThreadSecondaryPanel compact file content", () => {
  it("retains the active file body after the persistent drawer closes", () => {
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const activeTab = createWorkspaceFilePreviewFixedPanelTab({
      environmentId: "env-test",
      projectId: "project-test",
      tab: {
        lineRange: null,
        path: "src/index.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });
    const renderDrawer = (isOpen: boolean) => (
      <Wrapper>
        <TooltipProvider>
          <ThreadSecondaryPanel
            activeTab={activeTab}
            canUseGitUi={false}
            fileTabs={[
              {
                id: activeTab.id,
                filename: "index.ts",
                isActive: true,
                leadingVisual: null,
                statusLabel: null,
                onSelect: noop,
                onClose: noop,
              },
            ]}
            fileTabContent={<input aria-label="Retained file content" />}
            isConversationCollapsed={false}
            isOpen={isOpen}
            metadataContent={null}
            onClose={noop}
            onCollapse={noop}
            onFileTabReorder={noop}
            onOpenNewTab={noop}
            onPanelChange={noop}
            onPanelFocus={noop}
            onToggleConversationCollapse={noop}
            renderAsDrawer
          />
        </TooltipProvider>
      </Wrapper>
    );
    const view = render(renderDrawer(true));
    const fileContent = screen.getByRole("textbox", {
      name: "Retained file content",
    });

    view.rerender(renderDrawer(false));

    expect(screen.getByLabelText("Retained file content")).toBe(fileContent);
  });
});

// The full-screen control is the ONLY way back once the conversation is hidden
// — there is no standalone rail to click. Pin both halves of the same-slot
// expansion pair so a full-screen tab can always restore its prior layout.
describe("ThreadSecondaryPanel full-screen control", () => {
  it("keeps Full Screen before Hide right panel in the trailing toolbar", () => {
    const view = renderPanel({
      isConversationCollapsed: false,
      onToggleConversationCollapse: noop,
    });

    const fullScreenControl = view.getByRole("button", {
      name: "Full Screen",
    });
    const hideControl = view.getByRole("button", {
      name: "Hide right panel",
    });
    expect(
      fullScreenControl.compareDocumentPosition(hideControl) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("expands the panel while the conversation is shown", () => {
    const onToggleConversationCollapse = vi.fn();
    const view = renderPanel({
      isConversationCollapsed: false,
      onToggleConversationCollapse,
    });

    const control = view.getByRole("button", { name: "Full Screen" });
    expect(control.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(control);
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
  });

  it("restores the conversation from the same slot while it is collapsed", () => {
    const onToggleConversationCollapse = vi.fn();
    const view = renderPanel({
      isConversationCollapsed: true,
      onToggleConversationCollapse,
    });

    const control = view.getByRole("button", { name: "Exit Full Screen" });
    expect(control.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(control);
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
  });
});
