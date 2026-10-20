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
  useEnvironmentDiffViewed: () => ({ data: undefined }),
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

function Harness({
  panelStateId,
  browserOnly = false,
  contentFillsRegion = false,
}: {
  panelStateId?: string;
  browserOnly?: boolean;
  contentFillsRegion?: boolean;
}) {
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
    .filter(
      (document) => !browserOnly && (!closed || document.path !== "reading.md"),
    )
    .map((document) => ({
      tab: document,
      contentFillsRegion,
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
          splitPanelStateId={panelStateId}
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

function renderHarness(props: Parameters<typeof Harness>[0] = {}) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  const content = (nextProps = props) => (
    <Wrapper>
      <TooltipProvider>
        <Harness {...nextProps} />
      </TooltipProvider>
    </Wrapper>
  );
  return { ...render(content()), content };
}

function scrollContainer() {
  const containers = document.querySelectorAll<HTMLDivElement>(
    "[data-file-preview-scroll-container]",
  );
  const container = containers[containers.length - 1];
  if (!container) throw new Error("Missing file scroll container");
  return container;
}

function scrollTo(position: number) {
  scrollContainer().scrollTop = position;
  fireEvent.scroll(scrollContainer());
}

function clampScrollTopToContent(container: HTMLElement) {
  let scrollTop = 0;
  const maxScrollTop = () =>
    container.querySelector("a") === null ? 0 : Number.MAX_SAFE_INTEGER;
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    get: () => {
      scrollTop = Math.min(scrollTop, maxScrollTop());
      return scrollTop;
    },
    set: (value: number) => {
      scrollTop = Math.min(value, maxScrollTop());
    },
  });
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
  it("provides a bounded scroll container inside a full-height file opener", () => {
    renderHarness({ contentFillsRegion: true });
    const container = scrollContainer();
    expect(container.classList.contains("overflow-y-auto")).toBe(true);
    expect(container.classList.contains("h-full")).toBe(true);
    expect(container.classList.contains("min-h-0")).toBe(true);
    scrollTo(780);
    selectTab("short.md");
    selectTab("reading.md");
    expect(scrollContainer().scrollTop).toBe(780);
  });

  it.each(["different tabs", "shared tab ids", "panel remount"])(
    "restores the originating thread after %s",
    (transition) => {
      const panelStateId = `reading-origin-${transition}`;
      const harness = renderHarness({ panelStateId });
      scrollTo(640);
      if (transition === "panel remount") {
        harness.unmount();
        renderHarness({ panelStateId });
      } else {
        harness.rerender(
          harness.content({
            panelStateId: `reading-other-${transition}`,
            browserOnly: transition === "different tabs",
          }),
        );
        if (transition === "shared tab ids") {
          expect(scrollContainer().scrollTop).toBe(0);
          scrollTo(160);
        } else {
          expect(
            document.querySelector("[data-file-preview-scroll-container]"),
          ).toBeNull();
        }
        harness.rerender(harness.content());
      }
      expect(scrollContainer().scrollTop).toBe(640);
    },
  );

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
    clampScrollTopToContent(scrollContainer());
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

  it.each([undefined, "reading-close"])(
    "forgets a closed document even when reopening uses the same tab id (%s)",
    (panelStateId) => {
      renderHarness({ panelStateId });
      scrollTo(780);
      fireEvent.click(screen.getByRole("button", { name: "Close document" }));
      fireEvent.click(screen.getByRole("button", { name: "Reopen document" }));
      expect(scrollContainer().scrollTop).toBe(0);
    },
  );
});
