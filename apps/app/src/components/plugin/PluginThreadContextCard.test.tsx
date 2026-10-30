// @vitest-environment jsdom
import {
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
import {
  ThreadContextCard,
  ThreadContextCardHeaderButton,
  ThreadContextCardProvider,
  resolveThreadContextCardLayout,
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
  enabled = true,
  paneWidth = 1600,
  threadIds = ["thr_1"],
}: {
  enabled?: boolean;
  paneWidth?: number;
  threadIds?: readonly string[];
} = {}) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
    paneWidth,
  );
  return render(
    <JotaiProvider store={createStore()}>
      <TooltipProvider>
        <MemoryRouter>
          {threadIds.map((threadId) => (
            <ThreadContextCardProvider
              key={threadId}
              enabled={enabled}
              coreRows={CORE}
              coreSections={CORE_SECTIONS}
              threadId={threadId}
              projectId="proj_1"
              environment={null}
            >
              <header>
                <ThreadContextCardHeaderButton />
              </header>
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
    [1071, "overlay"],
    [390, "overlay"],
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

describe("useThreadContextKind", () => {
  function kindIn(wrap: (children: ReactNode) => ReactNode) {
    return renderHook(() => useThreadContextKind(), {
      wrapper: ({ children }) => wrap(children),
    }).result.current;
  }

  function pane(enabled: boolean, children: ReactNode) {
    return (
      <ThreadContextCardProvider
        enabled={enabled}
        coreRows={CORE}
        coreSections={CORE_SECTIONS}
        threadId="thr_1"
        projectId="proj_1"
        environment={null}
      >
        {children}
      </ThreadContextCardProvider>
    );
  }

  it.each([
    ["a pane with the card", (c: ReactNode) => pane(true, c), "card"],
    ["a pane with the card off", (c: ReactNode) => pane(false, c), "banner"],
    [
      "a thread nested in a card pane's panel",
      (c: ReactNode) =>
        pane(true, <WithoutThreadContextCard>{c}</WithoutThreadContextCard>),
      "banner",
    ],
    ["no thread pane", (c: ReactNode) => c, "banner"],
  ] as const)("reports the kind for %s", (_name, wrap, kind) => {
    expect(kindIn(wrap)).toBe(kind);
  });
});
