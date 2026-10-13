// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelGroup } from "react-resizable-panels";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  createBrowserFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  ThreadSecondaryPanel,
  type SecondaryPanelRenderableTab,
} from "./ThreadSecondaryPanel";
import { WorkspaceFilePreviewTabContent } from "./ThreadSecondaryPanelTabContent";

const loading = vi.hoisted(() => ({ current: false }));

vi.mock("@/hooks/queries/environment-queries", () => ({
  useEnvironment: () => ({ data: { path: "/workspace" } }),
  useEnvironmentDiffFiles: () => ({ data: undefined, isLoading: false }),
  useEnvironmentWorkStatus: () => ({ data: undefined }),
  useEnvironmentFilePreview: (_environmentId: string, path: string) => ({
    data: loading.current
      ? undefined
      : {
          kind: "text",
          content:
            path === "short.md"
              ? "# Short"
              : "# Reading\n\n[Visit](https://example.invalid/)\n\n".repeat(60),
          mimeType: "text/markdown",
          name: path,
          path,
          url: `/content/${path}`,
        },
    isLoading: loading.current,
    isFetching: false,
    error: null,
    refetch: () => {},
  }),
}));

const noop = () => {};

function Harness() {
  const documents = ["reading.md", "short.md"].map((path) =>
    createWorkspaceFilePreviewFixedPanelTab({
      environmentId: "env_scroll",
      projectId: "proj_scroll",
      tab: {
        path,
        lineRange: null,
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    }),
  );
  const [browserTab] = useState(() =>
    createBrowserFixedPanelTab({ environmentId: null, url: "about:blank" }),
  );
  const [activeId, setActiveId] = useState(documents[0].id);
  const [closed, setClosed] = useState(false);
  const tabs: SecondaryPanelRenderableTab[] = documents
    .filter((document) => !closed || document.path !== "reading.md")
    .map((document) => ({
      tab: document,
      label: document.path,
      leadingVisual: null,
      statusLabel: null,
      onClose: () => {
        setClosed(true);
        setActiveId(browserTab.id);
      },
      onSelect: () => setActiveId(document.id),
      renderContent: () => (
        <WorkspaceFilePreviewTabContent
          activePath={document.path}
          environmentId={document.environmentId}
          isPanelOpen
          lineRange={null}
          source={document.source}
          statusLabel={null}
          markdownLinkRouting={{
            onOpenLink: () => {
              setActiveId(browserTab.id);
              return true;
            },
          }}
        />
      ),
    }));
  tabs.push({
    tab: browserTab,
    label: "Browser",
    leadingVisual: null,
    statusLabel: null,
    onClose: noop,
    onSelect: () => setActiveId(browserTab.id),
    renderContent: () => null,
  });
  return (
    <>
      <button
        onClick={() => {
          setClosed(true);
          setActiveId(browserTab.id);
        }}
      >
        Close document
      </button>
      <button
        onClick={() => {
          setClosed(false);
          setActiveId(documents[0].id);
        }}
      >
        Reopen document
      </button>
      <PanelGroup direction="horizontal">
        <ThreadSecondaryPanel
          activeTab={tabs.find((tab) => tab.tab.id === activeId)?.tab ?? null}
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
          onToggleConversationCollapse={noop}
          isConversationCollapsed={false}
          renderAsDrawer={false}
          renderBrowserDeck={(active) =>
            active ? <div>Browser content</div> : null
          }
        />
      </PanelGroup>
    </>
  );
}

function renderHarness() {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  const content = () => (
    <Wrapper>
      <TooltipProvider>
        <Harness />
      </TooltipProvider>
    </Wrapper>
  );
  return { ...render(content()), content };
}

function scrollContainer() {
  const container = document.querySelector<HTMLDivElement>(
    "[data-file-preview-scroll-container]",
  );
  if (!container) throw new Error("Missing file scroll container");
  return container;
}

function scrollTo(position: number) {
  scrollContainer().scrollTop = position;
  fireEvent.scroll(scrollContainer());
}

function selectTab(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

afterEach(() => {
  cleanup();
  loading.current = false;
  window.localStorage.clear();
});

describe("Markdown reading position in open secondary-panel tabs", () => {
  it.each(["tab", "hyperlink"])(
    "retains position after leaving through a %s",
    (navigation) => {
      renderHarness();
      scrollTo(780);
      if (navigation === "tab") selectTab("Browser");
      else fireEvent.click(screen.getAllByRole("link", { name: "Visit" })[0]);
      expect(
        document.querySelector("[data-file-preview-scroll-container]"),
      ).toBeNull();
      selectTab("reading.md");
      expect(scrollContainer().scrollTop).toBe(780);
    },
  );

  it("retains separate document positions when the outgoing layout clamps", () => {
    renderHarness();
    scrollTo(780);
    selectTab("short.md");
    scrollTo(0);
    selectTab("reading.md");
    expect(scrollContainer().scrollTop).toBe(780);
    scrollTo(920);
    selectTab("short.md");
    expect(scrollContainer().scrollTop).toBe(0);
    selectTab("reading.md");
    expect(scrollContainer().scrollTop).toBe(920);
  });

  it("waits for ready Markdown content before restoring", () => {
    const harness = renderHarness();
    scrollTo(780);
    selectTab("Browser");
    loading.current = true;
    selectTab("reading.md");
    scrollTo(0);
    loading.current = false;
    harness.rerender(harness.content());
    expect(scrollContainer().scrollTop).toBe(780);
  });

  it("forgets a closed document even when reopening uses the same tab id", () => {
    renderHarness();
    scrollTo(780);
    fireEvent.click(screen.getByRole("button", { name: "Close document" }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen document" }));
    expect(scrollContainer().scrollTop).toBe(0);
  });
});
