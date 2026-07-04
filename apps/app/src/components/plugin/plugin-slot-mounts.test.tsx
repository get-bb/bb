// @vitest-environment jsdom

import { MemoryRouter, Route, Routes } from "react-router-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  PluginComposerAccessoryProps,
  PluginHomepageSectionProps,
  PluginThreadPanelProps,
} from "@bb/plugin-sdk";
import { createPluginPanelFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginNavPanelSlot,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { PLUGIN_PANEL_ROUTE_PATH } from "@/lib/route-paths";
import { PluginPanelView } from "@/views/PluginPanelView";
import {
  PluginPanelHeaderActions,
  PluginPanelHeaderCenter,
} from "./PluginPanelHeader";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { PluginComposerAccessories } from "./PluginComposerAccessories";
import { PluginHomepageSections } from "./PluginHomepageSections";
import { PluginNavSidebarItems } from "./PluginNavSidebarItems";
import { useComposer } from "@/lib/plugin-sdk-hooks";
import { subscribeComposerFocusRequests } from "@/lib/composer-focus-requests";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import {
  PluginPanelTabContent,
  usePluginPanelActions,
  type OpenPluginPanelArgs,
} from "./PluginPanelActions";

function registrationSet(
  overrides: Partial<PluginRegistrationSet>,
): PluginRegistrationSet {
  return {
    homepageSections: [],
    navPanels: [],
    threadPanelActions: [],
    composerAccessories: [],
    fileOpeners: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetPluginLogoStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

describe("PluginHomepageSections", () => {
  it("renders nothing without registrations (and without a Router)", () => {
    const { container } = render(<PluginHomepageSections />);
    expect(container.innerHTML).toBe("");
  });

  it("renders registered sections with the route project id", () => {
    function SectionProbe({ projectId }: PluginHomepageSectionProps) {
      return <div>section projectId: {String(projectId)}</div>;
    }
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        homepageSections: [
          { id: "hello", title: "Demo section", component: SectionProbe },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/projects/proj_123"]}>
        <PluginHomepageSections />
      </MemoryRouter>,
    );
    expect(screen.getByText("Demo section")).toBeDefined();
    expect(screen.getByText("section projectId: proj_123")).toBeDefined();
  });

  it("contains a crashing section without hiding its sibling", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    function Crashes(): never {
      throw new Error("section crashed");
    }
    function Fine() {
      return <div>fine section body</div>;
    }
    setPluginSlotRegistrations(
      "broken",
      registrationSet({
        homepageSections: [{ id: "a", title: "Broken", component: Crashes }],
      }),
    );
    setPluginSlotRegistrations(
      "fine",
      registrationSet({
        homepageSections: [{ id: "b", title: "Fine", component: Fine }],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PluginHomepageSections />
      </MemoryRouter>,
    );
    expect(screen.getByText("plugin broken crashed")).toBeDefined();
    expect(screen.getByText("fine section body")).toBeDefined();
  });
});

describe("PluginComposerAccessories", () => {
  it("passes the route thread + project context", () => {
    function AccessoryProbe({
      projectId,
      threadId,
    }: PluginComposerAccessoryProps) {
      return (
        <div>
          accessory {String(projectId)} / {String(threadId)}
        </div>
      );
    }
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        composerAccessories: [{ id: "probe", component: AccessoryProbe }],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/threads/thr_9"]}>
        <PluginComposerAccessories />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(`accessory ${PERSONAL_PROJECT_ID} / thr_9`),
    ).toBeDefined();
  });
});


function ThreadDraftViewer({ threadId }: { threadId: string }) {
  const draft = usePromptDraftStorage({
    kind: "thread",
    projectId: PERSONAL_PROJECT_ID,
    threadId,
  });
  return (
    <div>
      <div data-testid="draft-key">{draft.storageKey}</div>
      <div data-testid="draft-text">{draft.text}</div>
      <div data-testid="draft-mentions">{JSON.stringify(draft.mentions)}</div>
    </div>
  );
}

function NewThreadDraftViewer() {
  const draft = usePromptDraftStorage({ kind: "new-thread" });
  return (
    <div>
      <div data-testid="draft-key">{draft.storageKey}</div>
      <div data-testid="draft-text">{draft.text}</div>
      <div data-testid="draft-mentions">{JSON.stringify(draft.mentions)}</div>
    </div>
  );
}

describe("useComposer", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  function registerComposerProbe(label: string) {
    function ComposerProbe() {
      const composer = useComposer();
      return (
        <div>
          <div>scope: {composer.scope.kind}</div>
          <button type="button" onClick={() => composer.addQuote("picked text")}>
            {label}-quote
          </button>
          <button
            type="button"
            onClick={() =>
              composer.insertMention({
                provider: "notes",
                id: "work/ideas.md",
                label: "ideas.md",
              })
            }
          >
            {label}-mention
          </button>
          <button
            type="button"
            onClick={() =>
              composer.insertMention({ provider: "bad:colon", id: "x", label: "x" })
            }
          >
            {label}-bad-mention
          </button>
        </div>
      );
    }
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        composerAccessories: [{ id: "probe", component: ComposerProbe }],
      }),
    );
  }

  it("writes quotes into the thread draft and fires the focus bus", () => {
    registerComposerProbe("t");
    render(
      <MemoryRouter initialEntries={["/threads/thr_comp1"]}>
        <PluginComposerAccessories />
        <ThreadDraftViewer threadId="thr_comp1" />
      </MemoryRouter>,
    );
    expect(screen.getByText("scope: thread")).toBeDefined();

    let focusRequests = 0;
    const storageKey = screen.getByTestId("draft-key").textContent ?? "";
    const unsubscribe = subscribeComposerFocusRequests(storageKey, () => {
      focusRequests += 1;
    });
    fireEvent.click(screen.getByText("t-quote"));
    expect(screen.getByTestId("draft-text").textContent).toBe(
      "> picked text\n",
    );
    expect(focusRequests).toBe(1);
    unsubscribe();
  });

  it("appends mention pills with offsets into the new-thread draft", () => {
    registerComposerProbe("n");
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PluginComposerAccessories />
        <NewThreadDraftViewer />
      </MemoryRouter>,
    );
    expect(screen.getByText("scope: new-thread")).toBeDefined();

    fireEvent.click(screen.getByText("n-mention"));
    expect(screen.getByTestId("draft-text").textContent).toBe("ideas.md ");
    const mentions = JSON.parse(
      screen.getByTestId("draft-mentions").textContent ?? "[]",
    ) as Array<{ start: number; end: number; resource: Record<string, unknown> }>;
    expect(mentions).toEqual([
      {
        start: 0,
        end: 8,
        resource: {
          kind: "plugin",
          pluginId: "demo",
          itemId: "notes:work/ideas.md",
          label: "ideas.md",
        },
      },
    ]);

    // A second mention lands after the first with a preserved gap.
    fireEvent.click(screen.getByText("n-mention"));
    expect(screen.getByTestId("draft-text").textContent).toBe(
      "ideas.md ideas.md ",
    );
  });

  it("rejects provider ids containing ':' without touching the draft", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerComposerProbe("b");
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PluginComposerAccessories />
        <NewThreadDraftViewer />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("b-bad-mention"));
    expect(screen.getByTestId("draft-text").textContent).toBe("");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("invalid provider id"),
    );
  });
});

describe("PluginNavSidebarItems + PluginPanelView", () => {
  function Board() {
    return <div>board panel body</div>;
  }

  it("renders a sidebar entry that routes to the plugin panel", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        navPanels: [
          {
            id: "board",
            title: "Demo board",
            icon: "columns",
            path: "board",
            component: Board,
          },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PluginNavSidebarItems />
        <Routes>
          <Route path="/" element={<div>home</div>} />
          <Route path={PLUGIN_PANEL_ROUTE_PATH} element={<PluginPanelView />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Demo board"));
    expect(screen.getByText("board panel body")).toBeDefined();
  });

  it("passes the route splat to the panel as subPath ('' at the root)", () => {
    function SubPathProbe({ subPath }: { subPath: string }) {
      return <div>subPath: "{subPath}"</div>;
    }
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        navPanels: [
          {
            id: "board",
            title: "Demo board",
            icon: "columns",
            path: "board",
            component: SubPathProbe,
          },
        ],
      }),
    );
    const { unmount } = render(
      <MemoryRouter initialEntries={["/plugins/demo/board/work/ideas.md"]}>
        <Routes>
          <Route path={PLUGIN_PANEL_ROUTE_PATH} element={<PluginPanelView />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('subPath: "work/ideas.md"')).toBeDefined();
    unmount();

    render(
      <MemoryRouter initialEntries={["/plugins/demo/board"]}>
        <Routes>
          <Route path={PLUGIN_PANEL_ROUTE_PATH} element={<PluginPanelView />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('subPath: ""')).toBeDefined();
  });

  it("shows a placeholder for an unknown plugin panel route", () => {
    render(
      <MemoryRouter initialEntries={["/plugins/ghost/board"]}>
        <Routes>
          <Route path={PLUGIN_PANEL_ROUTE_PATH} element={<PluginPanelView />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/This plugin panel is not available/),
    ).toBeDefined();
  });

  it("renders the plugin's logo in the sidebar row when one is served, named icon otherwise", () => {
    setPluginLogoUrls(
      new Map([
        ["demo", { logoUrl: "/api/v1/plugins/demo/assets/logo?h=cafe", logoDarkUrl: null }],
      ]),
    );
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        navPanels: [
          { id: "board", title: "Demo board", icon: "Columns", path: "board", component: Board },
        ],
      }),
    );
    setPluginSlotRegistrations(
      "plain",
      registrationSet({
        navPanels: [
          { id: "list", title: "Plain list", icon: "Columns", path: "list", component: Board },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PluginNavSidebarItems />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId("plugin-logo-demo").getAttribute("src"),
    ).toBe("/api/v1/plugins/demo/assets/logo?h=cafe");
    // No logo → named-icon fallback (an svg, no img).
    expect(screen.queryByTestId("plugin-logo-plain")).toBeNull();
    const plainRow = screen.getByText("Plain list").closest("button");
    expect(plainRow?.querySelector("svg")).not.toBeNull();
  });
});

describe("plugin panel chrome (shared header + body modes)", () => {
  function PanelBody() {
    return <div>panel body</div>;
  }

  function panelSlot(
    overrides: Partial<PluginNavPanelSlot>,
  ): PluginNavPanelSlot {
    return {
      id: "board",
      title: "Demo board",
      icon: "Columns",
      path: "board",
      component: PanelBody,
      pluginId: "demo",
      generation: 1,
      ...overrides,
    };
  }

  function renderPanelBody(route = "/plugins/demo/board") {
    return render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={PLUGIN_PANEL_ROUTE_PATH} element={<PluginPanelView />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("renders logo + title in the header center and headerContent in the actions", () => {
    setPluginLogoUrls(
      new Map([
        ["demo", { logoUrl: "/api/v1/plugins/demo/assets/logo?h=cafe", logoDarkUrl: null }],
      ]),
    );
    function HeaderAccessory() {
      return <button type="button">Sync now</button>;
    }
    const panel = panelSlot({ headerContent: HeaderAccessory });
    render(
      <>
        <PluginPanelHeaderCenter panel={panel} />
        <PluginPanelHeaderActions panel={panel} subPath="" />
      </>,
    );
    expect(screen.getByText("Demo board")).toBeDefined();
    expect(
      screen.getByTestId("plugin-logo-demo").getAttribute("src"),
    ).toBe("/api/v1/plugins/demo/assets/logo?h=cafe");
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDefined();
  });

  it("hides a throwing headerContent without breaking the header (no crash chip)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    function ExplodingAccessory(): never {
      throw new Error("accessory exploded");
    }
    const panel = panelSlot({ headerContent: ExplodingAccessory });
    render(
      <>
        <PluginPanelHeaderCenter panel={panel} />
        <PluginPanelHeaderActions panel={panel} subPath="" />
      </>,
    );
    // The header center survives; the accessory is hidden, not chip-ified.
    expect(screen.getByText("Demo board")).toBeDefined();
    expect(screen.queryByText(/plugin demo crashed/)).toBeNull();
  });

  it('suppresses headerContent in "none" mode (the plugin owns the body)', () => {
    function HeaderAccessory() {
      return <button type="button">ignored</button>;
    }
    const panel = panelSlot({
      chrome: "none",
      headerContent: HeaderAccessory,
    });
    const { container } = render(<PluginPanelHeaderActions panel={panel} subPath="" />);
    expect(container.innerHTML).toBe("");
  });

  it('renders the body full-bleed in "none" mode with no heading of its own', () => {
    function FullBleed() {
      return <div>full bleed body</div>;
    }
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        navPanels: [
          panelSlot({ component: FullBleed, chrome: "none" }),
        ],
      }),
    );
    renderPanelBody();
    expect(screen.getByText("full bleed body")).toBeDefined();
    // The view is body-only: the title lives in the shared app header.
    expect(screen.queryByRole("heading", { name: "Demo board" })).toBeNull();
  });

  it('still contains a crashing "none" panel inside the error boundary', () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    function Crashes(): never {
      throw new Error("panel crashed");
    }
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        navPanels: [panelSlot({ component: Crashes, chrome: "none" })],
      }),
    );
    renderPanelBody();
    expect(screen.getByText("plugin demo crashed")).toBeDefined();
  });
});

describe("plugin thread panel actions", () => {
  function PanelProbe({ threadId, params }: PluginThreadPanelProps) {
    return (
      <div>
        panel body for {threadId} / {JSON.stringify(params)}
      </div>
    );
  }

  function ActionsProbe({
    threadId,
    openPluginPanel,
  }: {
    threadId: string | null;
    openPluginPanel: (args: OpenPluginPanelArgs) => void;
  }) {
    const entries = usePluginPanelActions({ openPluginPanel, threadId });
    return (
      <div>
        {entries.map((entry) => (
          <button key={entry.id} type="button" onClick={entry.onSelect}>
            {entry.title}
          </button>
        ))}
      </div>
    );
  }

  it("opens a panel tab with defaults when the action has no run", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        threadPanelActions: [
          { id: "issue", title: "Issue", component: PanelProbe },
        ],
      }),
    );
    const openPluginPanel = vi.fn();
    render(<ActionsProbe threadId="thr_9" openPluginPanel={openPluginPanel} />);
    fireEvent.click(screen.getByText("Issue"));
    expect(openPluginPanel).toHaveBeenCalledWith({
      pluginId: "demo",
      actionId: "issue",
      title: "Issue",
      paramsJson: null,
    });
  });

  it("passes ctx to run; openPanel serializes params and applies the title", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        threadPanelActions: [
          {
            id: "issue",
            title: "Issue",
            component: PanelProbe,
            run: ({ threadId, openPanel }) => {
              openPanel({ title: `Issue for ${threadId}`, params: { n: 1 } });
            },
          },
        ],
      }),
    );
    const openPluginPanel = vi.fn();
    render(<ActionsProbe threadId="thr_9" openPluginPanel={openPluginPanel} />);
    fireEvent.click(screen.getByText("Issue"));
    expect(openPluginPanel).toHaveBeenCalledWith({
      pluginId: "demo",
      actionId: "issue",
      title: "Issue for thr_9",
      paramsJson: JSON.stringify({ n: 1 }),
    });
  });

  it("contains a throwing run (sync) and non-serializable params (no open, no crash)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        threadPanelActions: [
          {
            id: "boom",
            title: "Boom",
            component: PanelProbe,
            run: () => {
              throw new Error("action exploded");
            },
          },
          {
            id: "cyclic",
            title: "Cyclic",
            component: PanelProbe,
            run: ({ openPanel }) => openPanel({ params: cyclic }),
          },
        ],
      }),
    );
    const openPluginPanel = vi.fn();
    render(<ActionsProbe threadId="thr_9" openPluginPanel={openPluginPanel} />);
    fireEvent.click(screen.getByText("Boom"));
    fireEvent.click(screen.getByText("Cyclic"));
    expect(openPluginPanel).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("offers no actions outside a thread context", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        threadPanelActions: [
          { id: "issue", title: "Issue", component: PanelProbe },
        ],
      }),
    );
    render(<ActionsProbe threadId={null} openPluginPanel={vi.fn()} />);
    expect(screen.queryByText("Issue")).toBeNull();
  });

  it("renders an open tab's component with the thread id and parsed params", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        threadPanelActions: [
          { id: "issue", title: "Issue", component: PanelProbe },
        ],
      }),
    );
    const tab = createPluginPanelFixedPanelTab({
      actionId: "issue",
      paramsJson: JSON.stringify({ n: 1 }),
      pluginId: "demo",
      title: "Issue #1",
    });
    render(<PluginPanelTabContent tab={tab} threadId="thr_9" />);
    expect(screen.getByText('panel body for thr_9 / {"n":1}')).toBeDefined();
  });

  it("degrades to a placeholder when the tab's action is gone", () => {
    const tab = createPluginPanelFixedPanelTab({
      actionId: "issue",
      paramsJson: null,
      pluginId: "ghost",
      title: "Issue",
    });
    render(<PluginPanelTabContent tab={tab} threadId="thr_9" />);
    expect(screen.getByText(/This plugin tab is not available/)).toBeDefined();
  });
});

describe("plugin file opener tabs", () => {
  function MarkdownEditorProbe({
    path,
    source,
  }: {
    path: string;
    source: { kind: string; environmentId: string | null };
  }) {
    return (
      <div>
        editor {path} @ {source.kind}:{String(source.environmentId)}
      </div>
    );
  }

  it("renders the opener component with parsed path + source", () => {
    setPluginSlotRegistrations(
      "notes",
      registrationSet({
        fileOpeners: [
          {
            id: "editor",
            title: "Notes editor",
            extensions: ["md"],
            component: MarkdownEditorProbe,
          },
        ],
      }),
    );
    const tab = createPluginPanelFixedPanelTab({
      actionId: "file-opener:editor",
      paramsJson: JSON.stringify({
        path: "notes/todo.md",
        source: {
          kind: "workspace",
          threadId: null,
          environmentId: "env_1",
          projectId: null,
        },
      }),
      pluginId: "notes",
      title: "todo.md",
    });
    render(<PluginPanelTabContent tab={tab} threadId={null} />);
    expect(
      screen.getByText("editor notes/todo.md @ workspace:env_1"),
    ).toBeDefined();
  });

  it("degrades to a placeholder when the opener is gone or params are junk", () => {
    const orphanTab = createPluginPanelFixedPanelTab({
      actionId: "file-opener:gone",
      paramsJson: JSON.stringify({ path: "a.md", source: { kind: "workspace" } }),
      pluginId: "ghost",
      title: "a.md",
    });
    const { unmount } = render(
      <PluginPanelTabContent tab={orphanTab} threadId={null} />,
    );
    expect(screen.getByText(/file opener is not available/)).toBeDefined();
    unmount();

    setPluginSlotRegistrations(
      "notes",
      registrationSet({
        fileOpeners: [
          {
            id: "editor",
            title: "Notes editor",
            extensions: ["md"],
            component: MarkdownEditorProbe,
          },
        ],
      }),
    );
    const junkParamsTab = createPluginPanelFixedPanelTab({
      actionId: "file-opener:editor",
      paramsJson: "not json",
      pluginId: "notes",
      title: "junk",
    });
    render(<PluginPanelTabContent tab={junkParamsTab} threadId={null} />);
    expect(screen.getByText(/file opener is not available/)).toBeDefined();
  });
});
