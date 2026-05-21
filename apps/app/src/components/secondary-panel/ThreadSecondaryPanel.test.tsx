// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactNode } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  type SecondaryPanelFileTab,
  ThreadSecondaryPanel,
} from "./ThreadSecondaryPanel";

interface RenderPanelArgs {
  fileTabContent?: ReactNode;
  fileTabs?: SecondaryPanelFileTab[];
  onOpenFileSearch: () => void;
  renderAsDrawer?: boolean;
}

interface ResizeDragEndScenario {
  name: string;
  finishDrag: () => void;
}

const noop = () => {};
const IFRAME_POINTER_EVENTS_NONE_CLASS = "[&_iframe]:pointer-events-none";

function renderPanel({
  fileTabContent,
  fileTabs,
  onOpenFileSearch,
  renderAsDrawer = true,
}: RenderPanelArgs) {
  const { wrapper } = createQueryClientTestHarness();
  const panel = (
    <ThreadSecondaryPanel
      activePanel="thread-info"
      canUseGitUi={false}
      environmentId={undefined}
      fileTabContent={fileTabContent}
      fileTabs={fileTabs}
      isOpen
      metadataContent={<div>Thread details</div>}
      onCollapse={noop}
      onClose={noop}
      onOpenFileSearch={onOpenFileSearch}
      onPanelChange={noop}
      onPanelFocus={noop}
      renderAsDrawer={renderAsDrawer}
      showGitDiffTab={false}
    />
  );

  return render(
    renderAsDrawer ? (
      panel
    ) : (
      <PanelGroup direction="horizontal" style={{ height: 400, width: 800 }}>
        <Panel id="test-main-panel" minSize={30}>
          Main panel
        </Panel>
        {panel}
      </PanelGroup>
    ),
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
});

describe("ThreadSecondaryPanel", () => {
  it("opens file search from the trailing plus menu", async () => {
    const onOpenFileSearch = vi.fn();

    renderPanel({ onOpenFileSearch });
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Add secondary panel tab" }),
      {
        button: 0,
        ctrlKey: false,
      },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open file" }));

    expect(onOpenFileSearch).toHaveBeenCalledTimes(1);
  });

  it.each<ResizeDragEndScenario>([
    {
      name: "pointerup",
      finishDrag: () => {
        fireEvent.pointerUp(document.body, {
          buttons: 0,
          clientX: 160,
          clientY: 0,
          isPrimary: true,
        });
      },
    },
    {
      name: "pointercancel",
      finishDrag: () => {
        fireEvent.pointerCancel(document.body, {
          buttons: 0,
          clientX: 160,
          clientY: 0,
          isPrimary: true,
        });
      },
    },
    {
      name: "window blur",
      finishDrag: () => {
        fireEvent.blur(window);
      },
    },
  ])(
    "keeps iframe previews interactable after secondary panel resize ends via $name",
    async ({ finishDrag }) => {
      const activeStatusTab: SecondaryPanelFileTab = {
        id: "storage:STATUS",
        filename: "STATUS",
        isActive: true,
        isPinned: true,
        statusLabel: null,
        onSelect: noop,
        onClose: noop,
      };

      renderPanel({
        fileTabs: [activeStatusTab],
        fileTabContent: <iframe title="Manager status" />,
        onOpenFileSearch: noop,
        renderAsDrawer: false,
      });

      const panel = document.querySelector<HTMLElement>(
        "#thread-detail-secondary-panel",
      );
      const aside = panel?.querySelector("aside");
      const iframe = screen.getByTitle("Manager status");
      const resizeHandle = screen.getByLabelText(
        "Resize thread and secondary panels",
      );

      expect(panel).not.toBeNull();
      expect(aside).not.toBeNull();

      fireEvent.pointerDown(resizeHandle, {
        buttons: 1,
        clientX: 0,
        clientY: 0,
        isPrimary: true,
      });

      await waitFor(() => {
        expect(aside?.className).toContain(IFRAME_POINTER_EVENTS_NONE_CLASS);
      });

      finishDrag();

      await waitFor(() => {
        expect(aside?.className).not.toContain(
          IFRAME_POINTER_EVENTS_NONE_CLASS,
        );
      });

      expect(panel?.style.pointerEvents).toBe("auto");
      expect(window.getComputedStyle(iframe).pointerEvents).toBe("auto");
    },
  );
});
