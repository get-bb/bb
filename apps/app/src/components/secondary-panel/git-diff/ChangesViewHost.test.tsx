// @vitest-environment jsdom

import { Provider as JotaiProvider, createStore } from "jotai";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type {
  ExperimentalChangesViewProps,
  ExperimentalChangesViewTargetState,
} from "@get-bb/plugin-sdk";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { replacementProviderKey } from "@/lib/plugin-replacement-preference";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { changesViewProviderAtom } from "./changesViewProvider";
import { ChangesViewHost } from "./ChangesViewHost";

const ownerFixture = vi.hoisted(() => ({ renderDiff: false }));

vi.mock("@/hooks/queries/environment-queries", () => {
  const diffFilesResult = {
    data: {
      outcome: "available",
      files: [
        {
          path: "src/demo.ts",
          previousPath: null,
          changeKind: "modified",
          additions: 1,
          deletions: 1,
          binary: false,
          origin: "tracked",
          loadMode: "auto",
        },
      ],
      initialPatches: {},
      mergeBaseRef: "main",
      truncated: false,
    },
    dataUpdatedAt: 1,
    error: null,
    isLoading: false,
    isPlaceholderData: false,
  };
  const workStatusResult = {
    data: {
      outcome: "available",
      workspace: {
        mergeBase: { commits: [] },
        workingTree: { files: [] },
      },
    },
  };
  return {
    useEnvironmentDiffFiles: () => diffFilesResult,
    useEnvironmentWorkStatus: () => workStatusResult,
  };
});

vi.mock("./useDiffFileContentsRequester", () => ({
  useDiffFileContentsRequester: () => vi.fn(),
}));

vi.mock("./DiffFilesPanel", async () => {
  const { PluginDiff } = await import("@/components/plugin/PluginDiff");
  return {
    DiffFilesPanel: () => (
      <div data-testid="bb-changes-owner">
        Native virtualized Changes body
        {ownerFixture.renderDiff ? (
          <PluginDiff
            patch={[
              "diff --git a/src/demo.ts b/src/demo.ts",
              "--- a/src/demo.ts",
              "+++ b/src/demo.ts",
              "@@ -1 +1 @@",
              "-old",
              "+new",
            ].join("\n")}
            path="src/demo.ts"
          />
        ) : null}
      </div>
    ),
  };
});

function registrationSet(
  overrides: Partial<PluginRegistrationSet> = {},
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    composerCustomizations: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    ...overrides,
  };
}

function target(
  sequence: number,
  value: ExperimentalChangesViewTargetState["target"],
): ExperimentalChangesViewTargetState {
  return { sequence, target: value, clear: vi.fn() };
}

function renderHost({
  experimental_target = null,
  instanceId = "pane-a",
  store = createStore(),
  threadId = "thread-a",
}: {
  experimental_target?: ExperimentalChangesViewTargetState | null;
  instanceId?: string;
  store?: ReturnType<typeof createStore>;
  threadId?: string;
} = {}) {
  return render(
    <JotaiProvider store={store}>
      <ChangesViewHost
        displayMode="unified"
        environmentId={`env-${threadId}`}
        experimental_target={experimental_target}
        instanceId={instanceId}
        isPanelOpen
        onDisplayModeChange={() => undefined}
        requestedMergeBaseBranch="main"
        threadId={threadId}
      />
    </JotaiProvider>,
  );
}

function registerChangesView(
  pluginId: string,
  component: (props: ExperimentalChangesViewProps) => ReactNode,
) {
  setPluginSlotRegistrations(
    pluginId,
    registrationSet({
      experimentalChangesViews: [
        {
          id: "changes",
          title: `${pluginId} Changes`,
          component,
        },
      ],
    }),
  );
}

afterEach(() => {
  cleanup();
  ownerFixture.renderDiff = false;
  resetAllCrashedPluginSlotsForTest();
  resetPluginSlotStoreForTest();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("ChangesViewHost", () => {
  it("uses deterministic automatic precedence and honors a named provider pin", () => {
    registerChangesView("zeta", () => <div>Zeta Changes</div>);
    registerChangesView("alpha", () => <div>Alpha Changes</div>);

    const automatic = renderHost();
    expect(screen.getByText("Alpha Changes")).toBeDefined();
    automatic.unmount();

    const store = createStore();
    store.set(
      changesViewProviderAtom,
      replacementProviderKey({ pluginId: "zeta", id: "changes" }),
    );
    renderHost({ store });
    expect(screen.getByText("Zeta Changes")).toBeDefined();
  });

  it("renders experimental_Original once without re-entering replacement resolution", () => {
    let replacementRenders = 0;
    registerChangesView("alpha", ({ experimental_Original: Original }) => {
      replacementRenders += 1;
      return <Original />;
    });

    renderHost();

    const [toolbar] = screen.getAllByTestId("git-diff-toolbar-layout");
    expect(toolbar?.parentElement?.parentElement?.classList).toContain(
      "select-none",
    );
    expect(screen.getAllByTestId("bb-changes-owner")).toHaveLength(1);
    expect(replacementRenders).toBe(1);
  });

  it("delivers file and commit targets independently to two pane instances", () => {
    registerChangesView("alpha", ({ experimental_target, threadId }) => (
      <div>
        {threadId}:
        {experimental_target === null
          ? "none"
          : experimental_target.target.kind === "file"
            ? experimental_target.target.path
            : experimental_target.target.sha}
      </div>
    ));

    render(
      <JotaiProvider store={createStore()}>
        <ChangesViewHost
          displayMode="unified"
          environmentId="env-left"
          experimental_target={target(1, {
            kind: "file",
            path: "left.ts",
          })}
          instanceId="pane-left"
          isPanelOpen
          onDisplayModeChange={() => undefined}
          requestedMergeBaseBranch="main"
          threadId="thread-left"
        />
        <ChangesViewHost
          displayMode="unified"
          environmentId="env-right"
          experimental_target={target(1, {
            kind: "commit",
            sha: "right-sha",
          })}
          instanceId="pane-right"
          isPanelOpen
          onDisplayModeChange={() => undefined}
          requestedMergeBaseBranch="main"
          threadId="thread-right"
        />
      </JotaiProvider>,
    );

    expect(screen.getByText("thread-left:left.ts")).toBeDefined();
    expect(screen.getByText("thread-right:right-sha")).toBeDefined();
  });

  it("falls back only the crashing pane instance", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerChangesView("alpha", ({ threadId }) => {
      if (threadId === "thread-left") throw new Error("left failed");
      return <div>Plugin {threadId}</div>;
    });

    render(
      <JotaiProvider store={createStore()}>
        <ChangesViewHost
          displayMode="unified"
          environmentId="env-left"
          experimental_target={null}
          instanceId="pane-left"
          isPanelOpen
          onDisplayModeChange={() => undefined}
          requestedMergeBaseBranch="main"
          threadId="thread-left"
        />
        <ChangesViewHost
          displayMode="unified"
          environmentId="env-right"
          experimental_target={null}
          instanceId="pane-right"
          isPanelOpen
          onDisplayModeChange={() => undefined}
          requestedMergeBaseBranch="main"
          threadId="thread-right"
        />
      </JotaiProvider>,
    );

    expect(screen.getByTestId("git-diff-toolbar-layout")).toBeDefined();
    expect(screen.getByTestId("bb-changes-owner")).toBeDefined();
    expect(screen.getByText("Plugin thread-right")).toBeDefined();
  });

  it("keeps the global diff renderer active inside experimental_Original", () => {
    ownerFixture.renderDiff = true;
    registerChangesView("alpha", ({ experimental_Original: Original }) => (
      <Original />
    ));
    setPluginSlotRegistrations(
      "diff-theme",
      registrationSet({
        diffRenderers: [
          {
            id: "global-diff",
            title: "Global diff",
            component: ({ path }) => <div>Global diff for {path}</div>,
          },
        ],
      }),
    );

    renderHost();

    expect(screen.getByTestId("bb-changes-owner")).toBeDefined();
    expect(screen.getByText("Global diff for src/demo.ts")).toBeDefined();
  });
});
