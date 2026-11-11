// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
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
    title: "Child threads",
    group: "1_related",
    order: 10,
    component: section("Core children"),
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
            title: "Deploys",
            group: "2_deploys",
            component: section("Deploys body"),
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

const CONTENT = "[data-thread-context-card-body] :not([data-bb-plugin-root])";
const MIRRORED_CARD_CSS = `
  [data-thread-context-card-section]:not(:has(${CONTENT})) { display: none; }
  :is([data-thread-context-card-rows], [data-thread-context-card-section]):has(${CONTENT}) ~ [data-thread-context-card-section] { border-top: 1px solid red; }
`;

function Summary({ threadId }: ExperimentalThreadContextCardProps) {
  return <span>6 PRs for {threadId}</span>;
}

function SummaryWithButton() {
  return (
    <button type="button" data-testid="summary-button">
      Review
    </button>
  );
}

function registerSections(
  sections: Array<{
    id: string;
    title: string;
    component?: ComponentType<ExperimentalThreadContextCardProps>;
    summary?: ComponentType<ExperimentalThreadContextCardProps>;
  }>,
  pluginId = "first",
) {
  setPluginSlotRegistrations(
    pluginId,
    makePluginRegistrationSet({
      threadContextCardSections: sections.map(
        ({ id, title, component, summary }, index) => ({
          id,
          title,
          group: "2_deploys",
          order: index,
          component: component ?? section(`${title} body`),
          ...(summary === undefined ? {} : { summary }),
        }),
      ),
    }),
  );
}

function toggleFor(name: string, index = 0) {
  return screen.getAllByRole("button", { name: new RegExp(`^${name}`) })[
    index
  ]!;
}

describe("thread context card sections fold", () => {
  const NO_ROWS = { coreRows: [] as CoreThreadContextCardRow[] };

  it("starts every section closed, bb's own included, with the body kept mounted", () => {
    registerSections([{ id: "deploys", title: "Deploys" }]);
    renderPane();

    for (const title of ["Child threads", "Deploys"]) {
      const toggle = toggleFor(title);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      const body = document.getElementById(
        toggle.getAttribute("aria-controls") ?? "",
      );
      expect(body?.hasAttribute("hidden")).toBe(true);
      expect(body?.textContent).toContain(
        `${title === "Deploys" ? "Deploys body" : "Core children"} for thr_1`,
      );
    }
  });

  it("opens and closes a section from its title, with aria-controls on the body", () => {
    registerSections([{ id: "deploys", title: "Deploys" }]);
    renderPane();
    const toggle = toggleFor("Deploys");
    const body = document.getElementById(
      toggle.getAttribute("aria-controls") ?? "",
    );

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body?.hasAttribute("hidden")).toBe(false);
    expect(toggleFor("Child threads").getAttribute("aria-expanded")).toBe(
      "false",
    );

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(body?.hasAttribute("hidden")).toBe(true);
  });

  it("opens a core section the same way", () => {
    renderPane();
    fireEvent.click(toggleFor("Child threads"));
    expect(toggleFor("Child threads").getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("remembers open sections across a remount and in every thread", () => {
    registerSections([{ id: "deploys", title: "Deploys" }]);
    const store = createStore();
    const first = renderPane({ store, threadIds: ["thr_1", "thr_2"] });
    expect(
      screen
        .getAllByRole("button", { name: /^Deploys/ })
        .map((node) => node.getAttribute("aria-expanded")),
    ).toEqual(["false", "false"]);

    fireEvent.click(toggleFor("Deploys", 0));
    expect(
      screen
        .getAllByRole("button", { name: /^Deploys/ })
        .map((node) => node.getAttribute("aria-expanded")),
    ).toEqual(["true", "true"]);
    expect(toggleFor("Child threads").getAttribute("aria-expanded")).toBe(
      "false",
    );

    first.unmount();
    renderPane({ store, threadIds: ["thr_3"] });
    expect(toggleFor("Deploys").getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggleFor("Deploys"));
    cleanup();
    renderPane({ store });
    expect(toggleFor("Deploys").getAttribute("aria-expanded")).toBe("false");
  });

  it("keys a plugin's section by plugin and id, so two plugins can share an id", () => {
    registerSections([{ id: "status", title: "First status" }], "first");
    registerSections([{ id: "status", title: "Second status" }], "second");
    renderPane();

    fireEvent.click(toggleFor("First status"));
    expect(toggleFor("First status").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(toggleFor("Second status").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("shows the summary beside the title only while the section is closed", () => {
    registerSections([
      { id: "prs", title: "Pull requests", summary: Summary },
      { id: "plain", title: "Plain" },
    ]);
    renderPane();
    const toggle = toggleFor("Pull requests");

    expect(toggle.textContent).toContain("6 PRs for thr_1");
    expect(toggleFor("Plain").textContent).toBe("Plain");

    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("Pull requests");
    expect(screen.queryByText("6 PRs for thr_1")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.textContent).toContain("6 PRs for thr_1");
  });

  it("draws a text summary as inert phrasing content inside the toggle", () => {
    registerSections([{ id: "prs", title: "Pull requests", summary: Summary }]);
    renderPane();
    const toggle = toggleFor("Pull requests");
    const summary = toggle.querySelector("[inert]");
    const root = summary?.querySelector("[data-bb-plugin-root]");

    expect(toggle.getAttribute("aria-describedby")).toBe(summary?.id);
    expect(summary?.className).toContain("truncate");
    expect(summary?.className).toContain("whitespace-nowrap");
    expect(root?.tagName).toBe("SPAN");
    expect(root?.getAttribute("data-bb-plugin")).toBe("first");
    expect(root?.className).toBe("contents");
    expect(root?.textContent).toBe("6 PRs for thr_1");
    expect(toggle.querySelector("div")).toBeNull();
  });

  it("keeps a summary that breaks the text-only contract inert", () => {
    registerSections([
      { id: "prs", title: "Pull requests", summary: SummaryWithButton },
    ]);
    renderPane();
    const toggle = toggleFor("Pull requests");
    const summary = toggle.querySelector("[inert]");

    expect(summary?.contains(screen.getByTestId("summary-button"))).toBe(true);
    expect(summary?.className).toContain("pointer-events-none");
  });

  it("leaves the section usable when its summary crashes", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerSections([{ id: "prs", title: "Pull requests", summary: Crashes }]);
    renderPane();
    const toggle = toggleFor("Pull requests");

    expect(toggle.textContent).toBe("Pull requests");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByText("Pull requests body for thr_1").closest("[hidden]"),
    ).toBeNull();
  });

  it("keeps a section whose component renders nothing hidden, closed or open", () => {
    const style = document.createElement("style");
    style.textContent = MIRRORED_CARD_CSS;
    document.head.append(style);
    try {
      registerSections([
        { id: "empty", title: "Nothing", component: Empty },
        { id: "full", title: "Something" },
      ]);
      renderPane(NO_ROWS);
      const display = (title: string) =>
        getComputedStyle(
          document.querySelector(`section[aria-label="${title}"]`)!,
        ).display;

      expect(display("Nothing")).toBe("none");
      expect(display("Something")).not.toBe("none");

      fireEvent.click(toggleFor("Something"));
      expect(display("Something")).not.toBe("none");
      expect(display("Nothing")).toBe("none");
    } finally {
      style.remove();
    }
  });

  it("draws a divider only between visible sections", () => {
    const style = document.createElement("style");
    style.textContent = MIRRORED_CARD_CSS;
    document.head.append(style);
    try {
      registerSections([
        { id: "empty-first", title: "Empty first", component: Empty },
        { id: "a", title: "A" },
        { id: "empty-middle", title: "Empty middle", component: Empty },
        { id: "b", title: "B" },
      ]);
      renderPane({
        ...NO_ROWS,
        coreSections: [],
      });
      const divider = (title: string) =>
        getComputedStyle(screen.getByRole("region", { name: title }))
          .borderTopStyle;

      expect(divider("A")).not.toBe("solid");
      expect(divider("B")).toBe("solid");
      fireEvent.click(toggleFor("B"));
      expect(divider("B")).toBe("solid");
    } finally {
      style.remove();
    }
  });

  it("uses the card's emptiness selectors on the folded layout", () => {
    registerSections([{ id: "deploys", title: "Deploys" }]);
    renderPane();
    const className = screen.getByRole("region", { name: "Deploys" }).className;
    expect(className).toContain(`:has(${CONTENT.replaceAll(" ", "_")})`);
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
