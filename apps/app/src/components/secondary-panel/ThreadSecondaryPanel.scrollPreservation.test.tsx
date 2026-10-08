// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelGroup } from "react-resizable-panels";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  createWorkspaceFilePreviewFixedPanelTab,
  type BrowserFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadSecondaryPanel } from "./ThreadSecondaryPanel";
import { WorkspaceFilePreviewTabContent } from "./ThreadSecondaryPanelTabContent";

const markdown =
  Array.from(
    { length: 80 },
    (_, index) => `## Section ${index + 1}\n\nParagraph ${index + 1}.`,
  ).join("\n\n") + "\n\n[Open a new tab](https://example.com/scroll-test)";

const previewState = vi.hoisted(() => ({ isLoading: false }));

vi.mock("@/hooks/queries/environment-queries", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/queries/environment-queries")
  >()),
  useEnvironment: () => ({ data: { path: "/workspace" } }),
  useEnvironmentFilePreview: (_environmentId: string, path: string) => ({
    data: previewState.isLoading
      ? undefined
      : {
          kind: "text",
          content: markdown,
          mimeType: "text/markdown",
          name: path,
          path,
          url: `/content/${path}`,
        },
    error: null,
    isLoading: previewState.isLoading,
    isFetching: previewState.isLoading,
    refetch: vi.fn(),
  }),
}));

const documentTab = createWorkspaceFilePreviewFixedPanelTab({
  environmentId: "env_scroll",
  projectId: "proj_scroll",
  tab: {
    path: "reading.md",
    lineRange: null,
    source: { kind: "working-tree" },
    statusLabel: null,
  },
});
const browserTab: BrowserFixedPanelTab = {
  id: "browser_scroll",
  kind: "browser",
  environmentId: "env_scroll",
  title: "Linked page",
  url: "https://example.com/scroll-test",
};
const secondDocumentTab = createWorkspaceFilePreviewFixedPanelTab({
  environmentId: "env_scroll",
  projectId: "proj_scroll",
  tab: {
    path: "notes.md",
    lineRange: null,
    source: { kind: "working-tree" },
    statusLabel: null,
  },
});
const noop = () => {};

function TestPanel({
  openBrowserInitially,
}: {
  openBrowserInitially: boolean;
}) {
  const [activeTab, setActiveTab] = useState<
    typeof documentTab | BrowserFixedPanelTab
  >(documentTab);
  const [browserOpen, setBrowserOpen] = useState(openBrowserInitially);
  const [documentOpen, setDocumentOpen] = useState(true);
  const openLink = () => {
    setBrowserOpen(true);
    setActiveTab(browserTab);
    return true;
  };
  const tabs = [
    ...(documentOpen
      ? [documentTab, secondDocumentTab]
      : [secondDocumentTab]
    ).map((tab) => ({
      tab,
      label: tab.path,
      leadingVisual: null,
      statusLabel: null,
      onClose: () => {
        setDocumentOpen(false);
        openLink();
      },
      onSelect: () => setActiveTab(tab),
      renderContent: () => (
        <WorkspaceFilePreviewTabContent
          activePath={tab.path}
          environmentId="env_scroll"
          isPanelOpen
          lineRange={null}
          source={{ kind: "working-tree" }}
          statusLabel={null}
          markdownLinkRouting={{ onOpenLink: openLink }}
        />
      ),
    })),
    ...(browserOpen
      ? [
          {
            tab: browserTab,
            label: "Linked page",
            leadingVisual: null,
            statusLabel: null,
            onClose: noop,
            onSelect: () => setActiveTab(browserTab),
            renderContent: () => null,
          },
        ]
      : []),
  ];
  return (
    <PanelGroup direction="horizontal">
      <ThreadSecondaryPanel
        activeTab={activeTab}
        canUseGitUi={false}
        fixedTabs={[]}
        tabs={tabs}
        isOpen
        metadataContent={null}
        onClose={noop}
        onCollapse={noop}
        onTabReorder={noop}
        onOpenNewTab={noop}
        onPanelFocus={noop}
        renderBrowserDeck={(id) =>
          id === browserTab.id ? (
            <div>
              Linked browser content
              <button
                onClick={() => {
                  setDocumentOpen(true);
                  setActiveTab(documentTab);
                }}
              >
                Reopen reading.md
              </button>
            </div>
          ) : null
        }
        renderAsDrawer={false}
        isConversationCollapsed={false}
        onToggleConversationCollapse={noop}
      />
    </PanelGroup>
  );
}

function renderTestPanel(openBrowserInitially: boolean) {
  const { wrapper: QueryWrapper } = createQueryClientTestHarness();
  const content = () => (
    <QueryWrapper>
      <TooltipProvider>
        <TestPanel openBrowserInitially={openBrowserInitially} />
      </TooltipProvider>
    </QueryWrapper>
  );
  const result = render(content());
  return { ...result, refresh: () => result.rerender(content()) };
}

function scrollContainer(): HTMLElement {
  const heading = screen.getByRole("heading", { name: "Section 1" });
  const container = heading.closest("[data-file-preview-scroll-container]");
  if (!(container instanceof HTMLElement))
    throw new Error("Missing preview scroll container");
  return container;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  previewState.isLoading = false;
});

describe("secondary-panel Markdown scroll position", () => {
  it("preserves the document position when switching to another open tab and back", () => {
    renderTestPanel(true);
    const original = scrollContainer();
    original.scrollTop = 960;
    fireEvent.scroll(original);
    fireEvent.click(screen.getByRole("button", { name: "Linked page" }));
    expect(screen.getByText("Linked browser content")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "reading.md" }));
    expect(scrollContainer().scrollTop).toBe(960);
  });

  it("preserves the document position after its hyperlink opens a new tab", () => {
    renderTestPanel(false);
    const original = scrollContainer();
    original.scrollTop = 960;
    fireEvent.scroll(original);
    fireEvent.click(screen.getByRole("link", { name: "Open a new tab" }));
    expect(screen.getByText("Linked browser content")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "reading.md" }));
    expect(scrollContainer().scrollTop).toBe(960);
  });

  it("keeps independent positions for two Markdown tabs", () => {
    renderTestPanel(true);
    scrollContainer().scrollTop = 960;
    fireEvent.scroll(scrollContainer());
    fireEvent.click(screen.getByRole("button", { name: "notes.md" }));
    expect(scrollContainer().scrollTop).toBe(0);
    scrollContainer().scrollTop = 1440;
    fireEvent.scroll(scrollContainer());
    fireEvent.click(screen.getByRole("button", { name: "reading.md" }));
    expect(scrollContainer().scrollTop).toBe(960);
    fireEvent.click(screen.getByRole("button", { name: "notes.md" }));
    expect(scrollContainer().scrollTop).toBe(1440);
  });

  it("restores after the returning document finishes loading", () => {
    const panel = renderTestPanel(true);
    scrollContainer().scrollTop = 960;
    fireEvent.scroll(scrollContainer());
    fireEvent.click(screen.getByRole("button", { name: "Linked page" }));
    previewState.isLoading = true;
    fireEvent.click(screen.getByRole("button", { name: "reading.md" }));
    expect(screen.queryByRole("heading", { name: "Section 1" })).toBeNull();
    previewState.isLoading = false;
    panel.refresh();
    expect(scrollContainer().scrollTop).toBe(960);
  });

  it("does not overwrite the saved position when the outgoing layout clamps the offset", () => {
    renderTestPanel(true);
    const original = scrollContainer();
    original.scrollTop = 960;
    fireEvent.scroll(original);
    original.scrollTop = 0;
    fireEvent.click(screen.getByRole("button", { name: "Linked page" }));
    fireEvent.click(screen.getByRole("button", { name: "reading.md" }));
    expect(scrollContainer().scrollTop).toBe(960);
  });

  it("starts at the top after the document tab is closed and reopened", () => {
    renderTestPanel(true);
    scrollContainer().scrollTop = 960;
    fireEvent.scroll(scrollContainer());
    fireEvent.click(screen.getByRole("button", { name: "Close reading.md" }));
    expect(screen.queryByRole("button", { name: "reading.md" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reopen reading.md" }));
    expect(scrollContainer().scrollTop).toBe(0);
  });
});
