// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelGroup } from "react-resizable-panels";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  createGitDiffFixedPanelTab,
  createThreadInfoFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadSecondaryPanel } from "./ThreadSecondaryPanel";

afterEach(cleanup);

const noop = () => {};

function renderPanel(args: {
  activeTab?:
    | ReturnType<typeof createThreadInfoFixedPanelTab>
    | ReturnType<typeof createGitDiffFixedPanelTab>;
  canUseGitUi?: boolean;
  hideChrome?: boolean;
  isConversationCollapsed: boolean;
  onToggleConversationCollapse: () => void;
}) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <Wrapper>
      <TooltipProvider>
        <PanelGroup direction="horizontal">
          <ThreadSecondaryPanel
            activeTab={args.activeTab ?? createThreadInfoFixedPanelTab()}
            canUseGitUi={args.canUseGitUi ?? false}
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

  it("keeps diff controls visible when the workspace hides navigation chrome", () => {
    const view = renderPanel({
      activeTab: createGitDiffFixedPanelTab(),
      canUseGitUi: true,
      hideChrome: true,
      isConversationCollapsed: false,
      onToggleConversationCollapse: noop,
    });

    expect(view.getByRole("tablist", { name: "Diff view mode" })).toBeTruthy();
    expect(
      view.getByTestId("thread-secondary-panel-top-chrome").className,
    ).toContain("hidden");
  });
});
