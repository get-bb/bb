// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider as JotaiProvider, createStore } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalThreadContextCardProps } from "@get-bb/plugin-sdk";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { ThreadContextCardRow } from "./ThreadContextCardRow";
import { SurfaceInfoSection } from "./ThreadContextCardSection";
import {
  ThreadContextCard,
  ThreadContextCardHeaderButton,
  ThreadContextCardProvider,
  resolveThreadContextCardLayout,
  useThreadContextCardContentInset,
  useThreadContextKind,
  WithoutThreadContextCard,
  type CoreThreadContextCardRow,
  type CoreThreadContextCardSection,
} from "./PluginThreadContextCard";

function section(label: string) {
  return function Section({ threadId }: ExperimentalThreadContextCardProps) {
    return (
      <p data-testid="section">
        {label} for {threadId}
      </p>
    );
  };
}

function titledSection(label: string, body = label) {
  return function TitledSection({
    threadId,
  }: ExperimentalThreadContextCardProps) {
    return (
      <SurfaceInfoSection label={label}>
        <p data-testid="section">
          {body} for {threadId}
        </p>
      </SurfaceInfoSection>
    );
  };
}

function OpenDiffRow() {
  return (
    <ThreadContextCardRow
      icon="FileDiff"
      label="Open diff"
      onClick={() => {}}
    />
  );
}

function Empty() {
  return null;
}

function Inset() {
  return (
    <output aria-label="Inset">{useThreadContextCardContentInset()}</output>
  );
}

function Crashes(): never {
  throw new Error("plugin crashed");
}

const CORE: CoreThreadContextCardRow[] = [
  {
    id: "environment",
    group: "2_environment",
    order: 10,
    component: section("Core environment"),
  },
];

const CORE_SECTIONS: CoreThreadContextCardSection[] = [
  {
    id: "childThreads",
    group: "1_related",
    order: 10,
    component: titledSection("Child threads", "Core children"),
  },
];

function renderPane({
  store = createStore(),
  enabled = true,
  paneWidth = 1600,
  threadIds = ["thr_1"],
  coreRows = CORE,
  coreSections = CORE_SECTIONS,
}: {
  store?: ReturnType<typeof createStore>;
  enabled?: boolean;
  paneWidth?: number;
  threadIds?: readonly string[];
  coreRows?: readonly CoreThreadContextCardRow[];
  coreSections?: readonly CoreThreadContextCardSection[];
} = {}) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
    paneWidth,
  );
  return render(
    <JotaiProvider store={store}>
      <TooltipProvider>
        <MemoryRouter>
          {threadIds.map((threadId) => (
            <ThreadContextCardProvider
              key={threadId}
              enabled={enabled}
              coreRows={coreRows}
              coreSections={coreSections}
              threadId={threadId}
              projectId="proj_1"
              environment={null}
            >
              <header>
                <ThreadContextCardHeaderButton />
              </header>
              <Inset />
              <div data-scroll-overlay="">
                <ThreadContextCard />
              </div>
            </ThreadContextCardProvider>
          ))}
        </MemoryRouter>
      </TooltipProvider>
    </JotaiProvider>,
  );
}

afterEach(() => {
  cleanup();
  removePluginSlotRegistrations("first");
  removePluginSlotRegistrations("second");
  removePluginSlotRegistrations("core");
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

describe("resolveThreadContextCardLayout", () => {
  it.each([
    [1384, "gutter"],
    [1383, "shift"],
    [1072, "shift"],
    [1071, "banner"],
    [390, "banner"],
  ] as const)("lays out a %ipx pane as %s", (width, layout) => {
    expect(resolveThreadContextCardLayout(width)).toBe(layout);
  });
});

describe("thread context card", () => {
  it("renders nothing while the experiment is off, even with plugin sections", () => {
    setPluginSlotRegistrations(
      "first",
      makePluginRegistrationSet({
        threadContextCardRows: [
          { id: "branch", group: "3_git", component: section("Branch") },
        ],
      }),
    );
    renderPane({ enabled: false });

    expect(screen.queryByRole("group", { name: "Thread context" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /thread details/i }),
    ).toBeNull();
  });

  it("orders rows by group, then order, core first on a tie, and puts titled sections below them", () => {
    setPluginSlotRegistrations(
      "first",
      makePluginRegistrationSet({
        threadContextCardRows: [
          { id: "pr", group: "4_pullRequest", component: section("PR") },
          {
            id: "tie",
            group: "2_environment",
            order: 10,
            component: section("Tie"),
          },
        ],
        threadContextCardSections: [
          {
            id: "deploys",
            group: "2_deploys",
            component: titledSection("Deploys", "Deploys body"),
            legacyTitle: null,
          },
        ],
      }),
    );
    setPluginSlotRegistrations(
      "second",
      makePluginRegistrationSet({
        threadContextCardRows: [
          { id: "git", group: "3_git", component: section("Git") },
        ],
      }),
    );
    renderPane();

    expect(
      screen.getAllByTestId("section").map((node) => node.textContent),
    ).toEqual([
      "Core environment for thr_1",
      "Tie for thr_1",
      "Git for thr_1",
      "PR for thr_1",
      "Core children for thr_1",
      "Deploys body for thr_1",
    ]);
    expect(
      screen.getByRole("region", { name: "Deploys" }).textContent,
    ).toContain("Deploys");
  });

  it("mounts one scoped instance per pane and drops only a crashing section", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    setPluginSlotRegistrations(
      "first",
      makePluginRegistrationSet({
        threadContextCardRows: [
          { id: "crash", group: "3_git", component: Crashes },
        ],
      }),
    );
    renderPane({ threadIds: ["thr_left", "thr_right"] });

    expect(
      screen.getAllByTestId("section").map((node) => node.textContent),
    ).toEqual([
      "Core environment for thr_left",
      "Core children for thr_left",
      "Core environment for thr_right",
      "Core children for thr_right",
    ]);
    expect(screen.queryByText(/crashed/)).toBeNull();
  });

  it("toggles the pinned card from the header in a wide pane", () => {
    renderPane({ paneWidth: 1600 });
    const toggle = screen.getByRole("button", { name: "Unpin thread context" });
    expect(screen.getByRole("group", { name: "Thread context" })).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.queryByRole("group", { name: "Thread context" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Pin thread context" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("shows an empty card from the header without changing the pin preference", async () => {
    renderPane({
      paneWidth: 1200,
      coreRows: CORE.map((row) => ({ ...row, component: Empty })),
      coreSections: CORE_SECTIONS.map((entry) => ({
        ...entry,
        component: Empty,
      })),
    });
    expect(screen.queryByRole("group", { name: "Thread context" })).toBeNull();
    expect(screen.getByLabelText("Inset").textContent).toBe("0");

    fireEvent.click(screen.getByRole("button", { name: "Pin thread context" }));
    expect(
      screen.getByRole("group", { name: "Thread context" }).textContent,
    ).toContain("Nothing to show yet");
    expect(screen.getByLabelText("Inset").textContent).not.toBe("0");

    fireEvent.click(
      screen.getByRole("button", { name: "Unpin thread context" }),
    );
    expect(screen.queryByRole("group", { name: "Thread context" })).toBeNull();

    act(() => {
      setPluginSlotRegistrations(
        "first",
        makePluginRegistrationSet({
          threadContextCardRows: [
            { id: "branch", group: "3_git", component: section("Branch") },
          ],
        }),
      );
    });
    expect(
      (await screen.findByRole("group", { name: "Thread context" }))
        .textContent,
    ).toContain("Branch for thr_1");
  });

  it("lays out the card and the transcript inset in the same frame as a resize", () => {
    const resize: Array<(entries: ResizeObserverEntry[]) => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: (entries: ResizeObserverEntry[]) => void) {
          resize.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get");
    renderPane({ paneWidth: 1600 });
    const resizeTo = (paneWidth: number) => {
      width.mockReturnValue(paneWidth);
      for (const callback of resize) callback([]);
    };
    const card = () => screen.queryByRole("group", { name: "Thread context" });
    const inset = () => screen.getByLabelText("Inset").textContent;

    resizeTo(1200);
    expect(card()).toBeTruthy();
    expect(inset()).toBe("312");

    resizeTo(900);
    expect(card()).toBeNull();
    expect(inset()).toBe("0");

    resizeTo(1200);
    expect(card()).toBeTruthy();
    expect(inset()).toBe("312");
    vi.unstubAllGlobals();
  });

  it("opens the card from the header in a narrow pane and closes it when a row runs", () => {
    setPluginSlotRegistrations(
      "first",
      makePluginRegistrationSet({
        threadContextCardRows: [
          { id: "diff", group: "3_git", component: OpenDiffRow },
        ],
      }),
    );
    renderPane({ paneWidth: 900 });
    expect(screen.queryByRole("group", { name: "Thread context" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Thread context" }));
    expect(screen.getByRole("group", { name: "Thread context" })).toBeTruthy();
    expect(
      screen.getAllByTestId("section").map((node) => node.textContent),
    ).toEqual(["Core environment for thr_1", "Core children for thr_1"]);

    fireEvent.click(screen.getByRole("button", { name: "Open diff" }));
    expect(screen.queryByRole("group", { name: "Thread context" })).toBeNull();
  });
});

type SectionStyle = "infoSection" | "legacyTitle";

function registerSections(
  style: SectionStyle,
  sections: Array<{ id: string; title: string }>,
  pluginId = "first",
) {
  setPluginSlotRegistrations(
    pluginId,
    makePluginRegistrationSet({
      threadContextCardSections: sections.map(({ id, title }, index) => ({
        id,
        group: "2_deploys",
        order: index,
        component:
          style === "infoSection"
            ? titledSection(title, `${title} body`)
            : section(`${title} body`),
        legacyTitle: style === "legacyTitle" ? title : null,
      })),
    }),
  );
}

function toggleFor(name: string, index = 0) {
  return screen.getAllByRole("button", { name })[index]!;
}

function expandedStates(name: string) {
  return screen
    .getAllByRole("button", { name })
    .map((node) => node.getAttribute("aria-expanded"));
}

function bodyShown(text: string) {
  const node = screen.queryByText(text);
  return node !== null && node.closest("[hidden]") === null;
}

describe.each<SectionStyle>(["infoSection", "legacyTitle"])(
  "thread context card sections drawn with %s",
  (style) => {
    it("start open and fold from their title", () => {
      registerSections(style, [{ id: "deploys", title: "Deploys" }]);
      renderPane();

      expect(expandedStates("Deploys")).toEqual(["true"]);
      expect(bodyShown("Deploys body for thr_1")).toBe(true);

      fireEvent.click(toggleFor("Deploys"));
      expect(expandedStates("Deploys")).toEqual(["false"]);
      expect(bodyShown("Deploys body for thr_1")).toBe(false);
      expect(expandedStates("Child threads")).toEqual(["true"]);

      fireEvent.click(toggleFor("Deploys"));
      expect(expandedStates("Deploys")).toEqual(["true"]);
      expect(bodyShown("Deploys body for thr_1")).toBe(true);
    });

    it("remember folded sections across a remount and in every thread", () => {
      registerSections(style, [{ id: "deploys", title: "Deploys" }]);
      const store = createStore();
      const first = renderPane({ store, threadIds: ["thr_1", "thr_2"] });

      fireEvent.click(toggleFor("Deploys", 0));
      expect(expandedStates("Deploys")).toEqual(["false", "false"]);
      expect(expandedStates("Child threads")).toEqual(["true", "true"]);

      first.unmount();
      renderPane({ store, threadIds: ["thr_3"] });
      expect(expandedStates("Deploys")).toEqual(["false"]);
    });

    it("key folds by owner and id, so plugins and bb can share an id", () => {
      registerSections(style, [{ id: "status", title: "First status" }]);
      registerSections(
        style,
        [{ id: "status", title: "Second status" }],
        "second",
      );
      registerSections(
        style,
        [{ id: "childThreads", title: "Plugin children" }],
        "core",
      );
      renderPane();

      fireEvent.click(toggleFor("First status"));
      fireEvent.click(toggleFor("Plugin children"));
      expect(expandedStates("First status")).toEqual(["false"]);
      expect(expandedStates("Second status")).toEqual(["true"]);
      expect(expandedStates("Plugin children")).toEqual(["false"]);
      expect(expandedStates("Child threads")).toEqual(["true"]);
    });
  },
);

describe("legacy titled thread context card sections", () => {
  it("keep a folded body mounted so an empty section stays hidden", () => {
    registerSections("legacyTitle", [{ id: "deploys", title: "Deploys" }]);
    renderPane();

    fireEvent.click(toggleFor("Deploys"));
    expect(
      screen.getByText("Deploys body for thr_1").closest("[hidden]"),
    ).not.toBeNull();
  });

  it("draw one title when the component also renders an InfoSection", () => {
    setPluginSlotRegistrations(
      "first",
      makePluginRegistrationSet({
        threadContextCardSections: [
          {
            id: "deploys",
            group: "2_deploys",
            component: titledSection("Inner deploys", "Deploys body"),
            legacyTitle: "Deploys",
          },
        ],
      }),
    );
    renderPane();

    expect(expandedStates("Deploys")).toEqual(["true"]);
    expect(screen.queryByText("Inner deploys")).toBeNull();
    expect(bodyShown("Deploys body for thr_1")).toBe(true);
  });
});

describe("useThreadContextKind", () => {
  function kindIn(wrap: (children: ReactNode) => ReactNode) {
    return renderHook(() => useThreadContextKind(), {
      wrapper: ({ children }) => wrap(children),
    }).result.current;
  }

  function pane(enabled: boolean, paneWidth: number, children: ReactNode) {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
      paneWidth,
    );
    return (
      <ThreadContextCardProvider
        enabled={enabled}
        coreRows={CORE}
        coreSections={CORE_SECTIONS}
        threadId="thr_1"
        projectId="proj_1"
        environment={null}
      >
        <div data-scroll-overlay="">
          <ThreadContextCard />
        </div>
        {children}
      </ThreadContextCardProvider>
    );
  }

  it.each([
    [
      "a wide pane with the card",
      (c: ReactNode) => pane(true, 1600, c),
      "card",
    ],
    [
      "a pane too narrow for the card",
      (c: ReactNode) => pane(true, 900, c),
      "banner",
    ],
    [
      "a pane with the card off",
      (c: ReactNode) => pane(false, 1600, c),
      "banner",
    ],
    [
      "a thread nested in a card pane's panel",
      (c: ReactNode) =>
        pane(
          true,
          1600,
          <WithoutThreadContextCard>{c}</WithoutThreadContextCard>,
        ),
      "banner",
    ],
    ["no thread pane", (c: ReactNode) => c, "banner"],
  ] as const)("reports the kind for %s", (_name, wrap, kind) => {
    expect(kindIn(wrap)).toBe(kind);
  });
});
