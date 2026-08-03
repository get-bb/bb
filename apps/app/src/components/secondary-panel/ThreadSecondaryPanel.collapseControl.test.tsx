// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelGroup } from "react-resizable-panels";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { createThreadInfoFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
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

// The conversation-collapse control is the ONLY way back once the conversation
// is hidden — there is no standalone rail to click. If the panel ever stops
// rendering it in the collapsed state, the conversation becomes unrecoverable
// without a keyboard shortcut, so pin both halves of the disclosure pair.
describe("ThreadSecondaryPanel conversation collapse control", () => {
  it("expands the panel while the conversation is shown", () => {
    const onToggleConversationCollapse = vi.fn();
    const view = renderPanel({
      isConversationCollapsed: false,
      onToggleConversationCollapse,
    });

    const control = view.getByRole("button", { name: "Expand right panel" });
    expect(control.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(control);
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
  });

  it("restores the conversation from the same slot while it is collapsed", () => {
    const onToggleConversationCollapse = vi.fn();
    const view = renderPanel({
      isConversationCollapsed: true,
      onToggleConversationCollapse,
    });

    const control = view.getByRole("button", { name: "Restore conversation" });
    expect(control.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(control);
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
  });
});
