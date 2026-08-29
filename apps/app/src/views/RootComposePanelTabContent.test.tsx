// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHostFilePreviewFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing";
import { buildFileOpenerPanelTab } from "@/components/plugin/file-opener-tabs";
import { RootComposePanelTabContent } from "./RootComposePanelTabContent";

function resolveSiblingResource(
  markdownLinkRouting: MarkdownLinkRouting | undefined,
): string | null {
  const localImage = markdownLinkRouting?.localImage;
  const baseDir = localImage?.relativePaths?.baseDir;
  if (localImage === undefined || baseDir === undefined) {
    return null;
  }
  return localImage.resolveSrc({
    lineRange: null,
    path: `${baseDir}/asset space-资料%.png`,
  });
}

function PreviewRoutingProbe({
  activePath,
  markdownLinkRouting,
  prefix,
}: {
  activePath: string;
  markdownLinkRouting?: MarkdownLinkRouting;
  prefix: string;
}) {
  return (
    <div
      data-testid={`${prefix}-${activePath}`}
      data-resource-url={resolveSiblingResource(markdownLinkRouting)}
      data-root-path={markdownLinkRouting?.localFile?.relativeLinks?.rootPath}
    />
  );
}

vi.mock("@/components/secondary-panel/lazySecondaryPanelComponents", () => ({
  LazyFilePreview: () => null,
  LazyHostFilePreviewTabContent: ({
    activePath,
    markdownLinkRouting,
  }: {
    activePath: string;
    markdownLinkRouting?: MarkdownLinkRouting;
  }) => (
    <PreviewRoutingProbe
      activePath={activePath}
      markdownLinkRouting={markdownLinkRouting}
      prefix="host"
    />
  ),
  LazyNewTabPage: () => null,
  LazyProjectFilePreviewTabContent: ({
    activePath,
    environmentId,
    hostId,
    markdownLinkRouting,
    projectId,
  }: {
    activePath: string;
    environmentId: string | null;
    hostId: string | null;
    markdownLinkRouting?: MarkdownLinkRouting;
    projectId: string;
  }) => (
    <div>
      <PreviewRoutingProbe
        activePath={activePath}
        markdownLinkRouting={markdownLinkRouting}
        prefix="project"
      />
      <div
        data-testid={`project-context-${activePath}`}
        data-environment-id={environmentId}
        data-host-id={hostId}
        data-project-id={projectId}
      />
    </div>
  ),
  LazyThreadStorageFilePreviewTabContent: ({
    activePath,
    markdownLinkRouting,
  }: {
    activePath: string;
    markdownLinkRouting?: MarkdownLinkRouting;
  }) => (
    <PreviewRoutingProbe
      activePath={activePath}
      markdownLinkRouting={markdownLinkRouting}
      prefix="storage"
    />
  ),
  LazyThreadTerminalPanel: ({ terminalId }: { terminalId?: string }) => (
    <div data-testid={`terminal-${terminalId ?? "missing"}`} />
  ),
  LazyWorkspaceFilePreviewTabContent: ({
    activePath,
    environmentId,
    markdownLinkRouting,
  }: {
    activePath: string;
    environmentId: string;
    markdownLinkRouting?: MarkdownLinkRouting;
  }) => (
    <div>
      <PreviewRoutingProbe
        activePath={activePath}
        markdownLinkRouting={markdownLinkRouting}
        prefix="workspace"
      />
      <div
        data-testid={`workspace-context-${activePath}`}
        data-environment-id={environmentId}
      />
    </div>
  ),
}));

vi.mock("@/components/plugin/PluginPanelActions", () => ({
  PluginPanelTabContent: ({
    fileOpenerOriginal,
  }: {
    fileOpenerOriginal?: ReactNode;
  }) => fileOpenerOriginal ?? null,
}));

vi.mock("@/hooks/queries/environment-queries", () => ({
  useEnvironment: (environmentId: string | null) => ({
    data:
      environmentId === null
        ? undefined
        : {
            hostId: `host-${environmentId}`,
            path: `/workspace/${environmentId}`,
          },
  }),
}));

vi.mock("@/components/secondary-panel/useThreadStorageViewer", () => ({
  useThreadStorageViewer: ({ threadId }: { threadId?: string }) => ({
    threadStorageRootPath:
      threadId === undefined ? null : `/storage/${threadId}`,
  }),
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ isLocalDaemonHost: () => true }),
}));

vi.mock("@/hooks/useLocalOpenTargets", () => ({
  useLocalOpenTargets: () => ({
    canOpenPreferredFileTarget: false,
    openPathInPreferredFileTarget: vi.fn(),
  }),
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: () => undefined,
}));

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
  onOpenLocalFileLink: () => true,
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
        .getByTestId("workspace-context-src/first.ts")
        .getAttribute("data-environment-id"),
    ).toBe("env-first");
    expect(
      screen
        .getByTestId("workspace-context-src/second.ts")
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

    const preview = screen.getByTestId("project-context-persisted/readme.md");
    expect(preview.getAttribute("data-environment-id")).toBeNull();
    expect(preview.getAttribute("data-host-id")).toBe("host-opened");
    expect(preview.getAttribute("data-project-id")).toBe("project-opened");
  });

  it("routes Markdown links and sibling resources for every root compose file source", () => {
    const workspaceTab = createWorkspaceFilePreviewFixedPanelTab({
      environmentId: "env-current",
      projectId: "project-current",
      tab: {
        lineRange: null,
        path: "docs/workspace.md",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });
    const projectTab = createWorkspaceFilePreviewFixedPanelTab({
      environmentId: null,
      projectId: "project-current",
      tab: {
        lineRange: null,
        path: "docs/project.md",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });
    const hostTab = createHostFilePreviewFixedPanelTab({
      environmentId: "env-current",
      tab: {
        lineRange: null,
        path: "/workspace/env-current/docs/host.md",
      },
      threadId: "thread-current",
    });
    const storageTab = createThreadStorageFilePreviewFixedPanelTab({
      environmentId: "env-current",
      isPinned: false,
      tab: { lineRange: null, path: "docs/storage.md" },
      threadId: "thread-current",
    });
    const projectSources: PanelContentProps["projectSources"] = [
      {
        createdAt: 1,
        hostId: "host-current",
        id: "source-current",
        isDefault: true,
        path: "/project root/资料%",
        projectId: "project-current",
        type: "local_path",
        updatedAt: 1,
      },
    ];
    const sourceProps = {
      ...baseProps,
      projectSources,
    };

    render(
      <>
        {[workspaceTab, projectTab, hostTab, storageTab].map((tab) => (
          <RootComposePanelTabContent
            key={tab.id}
            {...sourceProps}
            pane={{ isFocused: true, onFocusPane: noop }}
            tab={tab}
          />
        ))}
      </>,
    );

    const cases = [
      {
        expectedRoot: "/workspace/env-current",
        expectedUrl:
          "/api/v1/threads/thread-current/worktree/files/docs/asset%20space-%E8%B5%84%E6%96%99%25.png",
        testId: "workspace-docs/workspace.md",
      },
      {
        expectedRoot: "/workspace/env-current",
        expectedUrl:
          "/api/v1/projects/project-current/files/content?path=docs%2Fasset+space-%E8%B5%84%E6%96%99%25.png&environmentId=env-current",
        testId: "project-docs/project.md",
      },
      {
        expectedRoot: "/workspace/env-current",
        expectedUrl:
          "/api/v1/threads/thread-current/host-files/content?path=%2Fworkspace%2Fenv-current%2Fdocs%2Fasset+space-%E8%B5%84%E6%96%99%25.png",
        testId: "host-/workspace/env-current/docs/host.md",
      },
      {
        expectedRoot: "/storage/thread-current",
        expectedUrl:
          "/api/v1/threads/thread-current/thread-storage/content?path=docs%2Fasset+space-%E8%B5%84%E6%96%99%25.png",
        testId: "storage-docs/storage.md",
      },
    ];
    for (const testCase of cases) {
      const preview = screen.getByTestId(testCase.testId);
      expect(preview.getAttribute("data-root-path")).toBe(
        testCase.expectedRoot,
      );
      expect(preview.getAttribute("data-resource-url")).toBe(
        testCase.expectedUrl,
      );
    }
  });
});
