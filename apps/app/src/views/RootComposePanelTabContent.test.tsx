// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTerminalFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { buildFileOpenerPanelTab } from "@/components/plugin/file-opener-tabs";
import { RootComposePanelTabContent } from "./RootComposePanelTabContent";
import * as environmentQueries from "@/hooks/queries/environment-queries";
import * as lazySecondaryPanelComponents from "@/components/secondary-panel/lazySecondaryPanelComponents";
import * as pluginPanelActions from "@/components/plugin/PluginPanelActions";
import * as threadStorageViewer from "@/components/secondary-panel/useThreadStorageViewer";
import * as hostDaemon from "@/hooks/useHostDaemon";
import * as localOpenTargets from "@/hooks/useLocalOpenTargets";

vi.spyOn(lazySecondaryPanelComponents, "LazyFilePreview").mockImplementation(
  () => <span />,
);
vi.spyOn(
  lazySecondaryPanelComponents,
  "LazyHostFilePreviewTabContent",
).mockImplementation(() => <span />);
vi.spyOn(lazySecondaryPanelComponents, "LazyNewTabPage").mockImplementation(
  () => <span />,
);
vi.spyOn(
  lazySecondaryPanelComponents,
  "LazyProjectFilePreviewTabContent",
).mockImplementation(({ activePath, environmentId, hostId, projectId }) => (
  <div
    data-testid={`project-${activePath}`}
    data-environment-id={environmentId}
    data-host-id={hostId}
    data-project-id={projectId}
  />
));
vi.spyOn(
  lazySecondaryPanelComponents,
  "LazyThreadStorageFilePreviewTabContent",
).mockImplementation(() => <span />);
vi.spyOn(
  lazySecondaryPanelComponents,
  "LazyThreadTerminalPanel",
).mockImplementation(({ terminalId }) => (
  <div data-testid={`terminal-${terminalId ?? "missing"}`} />
));
vi.spyOn(
  lazySecondaryPanelComponents,
  "LazyWorkspaceFilePreviewTabContent",
).mockImplementation(({ activePath, environmentId }) => (
  <div
    data-testid={`workspace-${activePath}`}
    data-environment-id={environmentId}
  />
));
vi.spyOn(pluginPanelActions, "PluginPanelTabContent").mockImplementation(
  ({ fileOpenerOriginal }) => <>{fileOpenerOriginal}</>,
);
vi.spyOn(environmentQueries, "useEnvironment").mockImplementation(
  (environmentId) => {
    /* SAFETY: This faithful hook fixture supplies only the data field consumed by the component. */
    return {
      data:
        environmentId === null
          ? undefined
          : {
              hostId: `host-${environmentId}`,
              path: `/workspace/${environmentId}`,
            },
    } as ReturnType<typeof environmentQueries.useEnvironment>;
  },
);
vi.spyOn(threadStorageViewer, "useThreadStorageViewer").mockImplementation(
  () => {
    /* SAFETY: This faithful hook fixture supplies only the data field consumed by the component. */
    return {
      threadStorageRootPath: null,
    } as ReturnType<typeof threadStorageViewer.useThreadStorageViewer>;
  },
);
vi.spyOn(hostDaemon, "useHostDaemon").mockImplementation(() => {
  return {
    localDaemonHostId: null,
    localHostId: null,
    hasDaemon: false,
    supportsNativeFolderPicker: false,
    platform: null,
    isLocalDaemonHost: () => true,
  };
});
vi.spyOn(localOpenTargets, "useLocalOpenTargets").mockImplementation(() => {
  return {
    canOpenPreferredDirectoryTarget: false,
    canOpenPreferredFileTarget: false,
    directoryOpenTargets: [],
    fileOpenTargets: [],
    isLoading: false,
    openPathInDirectoryTarget: async () => false,
    openPathInFileTarget: async () => false,
    openPathInPreferredDirectoryTarget: async () => false,
    openPathInPreferredFileTarget: async () => false,
    preferredDirectoryTarget: null,
    preferredFileTarget: null,
  };
});

type PanelContentProps = ComponentProps<typeof RootComposePanelTabContent>;

const noop = () => {};
const baseProps = {
  activeTabId: null,
  canCreateTerminal: true,
  currentProjectId: "project-current",
  isPanelOpen: true,
  isPanelPersistedOpen: true,
  isProjectless: false,
  onActivateTab: noop,
  onAutoFocusNewTabHandled: noop,
  onAutoFocusTerminalHandled: noop,
  onOpenBrowser: noop,
  onOpenPanelLink: () => false,
  onSelectFileSearchResult: noop,
  onSelectionAddToChat: noop,
  onStartTerminal: noop,
  primaryHostId: "host-primary",
  pluginActions: [],
  projectSources: [],
  projects: [],
  rootPanelEnvironmentId: "env-current",
  rootPanelThreadId: "thread-current",
  rootProjectHostId: "host-current",
  shouldAutoFocusNewTab: false,
  shouldAutoFocusTerminal: false,
  terminalTarget: {
    kind: "environment",
    environmentId: "env-current",
  },
} satisfies Omit<PanelContentProps, "pane" | "tab">;

afterEach(cleanup);

describe("RootComposePanelTabContent", () => {
  it("renders each visible split pane from its own file tab model", () => {
    const firstTab = createWorkspaceFilePreviewFixedPanelTab({
      environmentId: "env-first",
      projectId: "project-current",
      tab: {
        lineRange: null,
        path: "src/first.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });
    const secondTab = createWorkspaceFilePreviewFixedPanelTab({
      environmentId: "env-second",
      projectId: "project-current",
      tab: {
        lineRange: null,
        path: "src/second.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });

    render(
      <>
        <RootComposePanelTabContent
          {...baseProps}
          pane={{ isFocused: false, onFocusPane: noop }}
          tab={firstTab}
        />
        <RootComposePanelTabContent
          {...baseProps}
          activeTabId={secondTab.id}
          pane={{ isFocused: true, onFocusPane: noop }}
          tab={secondTab}
        />
      </>,
    );

    expect(
      screen
        .getByTestId("workspace-src/first.ts")
        .getAttribute("data-environment-id"),
    ).toBe("env-first");
    expect(
      screen
        .getByTestId("workspace-src/second.ts")
        .getAttribute("data-environment-id"),
    ).toBe("env-second");
  });

  it("binds each split terminal body to its own terminal id", () => {
    const firstTab = createTerminalFixedPanelTab({ terminalId: "term-first" });
    const secondTab = createTerminalFixedPanelTab({
      terminalId: "term-second",
    });

    render(
      <>
        <RootComposePanelTabContent
          {...baseProps}
          pane={{ isFocused: false, onFocusPane: noop }}
          tab={firstTab}
        />
        <RootComposePanelTabContent
          {...baseProps}
          activeTabId={secondTab.id}
          pane={{ isFocused: true, onFocusPane: noop }}
          tab={secondTab}
        />
      </>,
    );

    expect(screen.getByTestId("terminal-term-first")).toBeTruthy();
    expect(screen.getByTestId("terminal-term-second")).toBeTruthy();
  });

  it("keeps a persisted plugin opener route after compose context changes", () => {
    const tab = buildFileOpenerPanelTab(
      { id: "markdown", pluginId: "docs" },
      {
        path: "persisted/readme.md",
        source: {
          kind: "workspace",
          environmentId: null,
          experimental_hostId: "host-opened",
          projectId: "project-opened",
          threadId: null,
        },
      },
      {
        environmentId: null,
        kind: "workspace-file-preview",
        projectId: "project-stale",
        tab: {
          lineRange: null,
          path: "stale/readme.md",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
        threadId: null,
      },
    );

    render(
      <RootComposePanelTabContent
        {...baseProps}
        pane={{ isFocused: true, onFocusPane: noop }}
        tab={tab}
      />,
    );

    const preview = screen.getByTestId("project-persisted/readme.md");
    expect(preview.getAttribute("data-environment-id")).toBeNull();
    expect(preview.getAttribute("data-host-id")).toBe("host-opened");
    expect(preview.getAttribute("data-project-id")).toBe("project-opened");
  });
});
