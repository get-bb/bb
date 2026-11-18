// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ExperimentalMessageActionSurface } from "@get-bb/plugin-sdk";
import { Provider } from "jotai";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { makeEnvironment } from "@bb/test-helpers/domain-fixtures";
import type { UseThreadTimelineControllerResult } from "@/components/thread/timeline";
import { LazyPluginThreadChat } from "@/components/plugin/LazyPluginThreadChat";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  AppNavigationHostProvider,
  type AppFilePreviewIntent,
} from "@/lib/app-navigation-host";
import { resetFixedPanelTabsStateForTest } from "@/lib/fixed-panel-tabs";
import { markPluginFrontendsSettled } from "@/lib/plugin-frontend-boot-state";
import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { sdk } from "@/lib/sdk";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import {
  conversationRow,
  fileChangeRow,
} from "@/test/fixtures/thread-timeline-rows";
import {
  ContractStateProbe,
  snapshotFromState,
  type ContractStateSink,
} from "@/test/panel-controller-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { DefaultPaneContextProvider } from "./PaneContext";
import { ThreadDetailView } from "./ThreadDetailView";

await LazyPluginThreadChat.preload();

const mocks = vi.hoisted(() => ({
  promptAreaProps: [] as Array<Record<string, unknown>>,
}));

const ENVIRONMENT = makeEnvironment({
  id: "env_surface",
  projectId: "proj_surface",
  status: "ready",
  isGitRepo: true,
  path: "/workspace",
});

const THREAD = makeThreadResponse({
  id: "thr_surface",
  projectId: "proj_surface",
  environmentId: ENVIRONMENT.id,
  status: "idle",
  runtime: { displayStatus: "idle" },
});

const CONTEXT_WINDOW_USAGE = {
  usedTokens: 1200,
  maxTokens: 200000,
} as unknown as UseThreadTimelineControllerResult["contextWindowUsage"];

const TIMELINE: UseThreadTimelineControllerResult = {
  activeBackgroundCommands: [],
  activePromptMode: null,
  activeThinking: null,
  activeWorkflows: [],
  contextBoundarySeq: null,
  contextWindowUsage: CONTEXT_WINDOW_USAGE,
  hasOlderTimelineRows: false,
  isCatchingUpTimeline: false,
  isLoadingOlderTimelineRows: false,
  loadOlderTimelineRows: async () => {},
  modelFallback: null,
  pendingTodos: null,
  providerCommands: null,
  sessionOptions: null,
  timelineError: null,
  timelineLoading: false,
  timelineRows: [
    conversationRow({
      id: "assistant_row",
      role: "assistant",
      text: "An assistant answer.",
      threadId: THREAD.id,
    }),
    fileChangeRow({ id: "edit_row", path: "README.md", threadId: THREAD.id }),
  ],
};

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useHostListRealtimeSubscription: vi.fn(),
  useThreadDetailRealtimeSubscription: vi.fn(),
  useThreadTimelineRealtimeSubscription: vi.fn(),
  useThreadListRealtimeSubscription: vi.fn(),
  useEnvironmentDetailRealtimeSubscription: vi.fn(),
  useSystemRealtimeSubscription: vi.fn(),
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ isLocalDaemonHost: () => true }),
}));

vi.mock("@/hooks/queries/thread-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/queries/thread-queries")>()),
  useChildThreads: () => ({ data: [] }),
  useThreadPendingInteractions: () => ({ data: [] }),
}));

vi.mock("@/hooks/queries/child-thread-pending-interactions", () => ({
  useChildThreadPendingAttention: () => [],
}));

vi.mock("@/hooks/queries/environment-queries", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/queries/environment-queries")
  >()),
  useEnvironment: () => ({
    data: ENVIRONMENT,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/components/thread/timeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/thread/timeline")>()),
  useThreadTimelineController: () => TIMELINE,
}));

vi.mock("./ThreadDetailPromptArea", () => ({
  ThreadDetailPromptArea: (props: Record<string, unknown>) => {
    mocks.promptAreaProps.push(props);
    return <div data-testid="prompt-area" />;
  },
}));

vi.mock("@/components/commands/AppCommandProvider", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/commands/AppCommandProvider")
  >()),
  useAppCommandHandler: () => undefined,
  useAppCommandShortcut: () => null,
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@bb/shared-ui/hooks/use-compact-viewport")
  >()),
  useIsCompactViewport: () => false,
}));

vi.mock("./ThreadDetailHeader", () => ({
  ThreadDetailHeader: () => <header data-testid="thread-header" />,
}));

vi.mock("./ThreadDetailSecondaryContent", () => ({
  ThreadDetailSecondaryContent: ({
    header,
    main,
  }: {
    header: ReactNode;
    main: ReactNode;
  }) => (
    <>
      {header}
      {main}
    </>
  ),
}));

vi.mock("./useThreadDetailThread", () => ({
  useThreadDetailThread: () => ({
    hasThreadDetailBootstrapSettled: true,
    threadDetailBootstrapQuery: { isFetching: false },
    threadQuery: {
      data: THREAD,
      isFetching: false,
      isLoadingError: false,
      error: null,
    },
    unreadDividerState: { ready: true, autoScroll: false, placement: null },
  }),
}));

interface ThreadScreenSurface {
  name: string;
  messageActionSurface: ExperimentalMessageActionSurface;
  hasComposer: boolean;
  contextEnvironmentId: string | null;
  render: (hosts: SurfaceHosts) => ReactNode;
  openedReadme: (hosts: SurfaceHosts) => boolean;
}

interface SurfaceHosts {
  openFilePreview: Mock<(intent: AppFilePreviewIntent) => boolean>;
  sink: ContractStateSink;
}

function pluginThreadChat(variant: "full" | "compact" | "timeline") {
  return ({ openFilePreview }: SurfaceHosts) => (
    <AppNavigationHostProvider capabilities={{ openFilePreview }}>
      <PluginSlotMount pluginId="host" slotKind="navPanel" slotId="page">
        <pluginSdkAppImplementation.ThreadChat
          threadId={THREAD.id}
          variant={variant}
        />
      </PluginSlotMount>
    </AppNavigationHostProvider>
  );
}

function pluginOpenedReadme({ openFilePreview }: SurfaceHosts) {
  return openFilePreview.mock.calls.some(
    ([intent]) =>
      intent.target.kind === "workspace" &&
      intent.target.environmentId === ENVIRONMENT.id &&
      intent.target.path === "README.md",
  );
}

const SURFACES: readonly ThreadScreenSurface[] = [
  {
    name: "thread page",
    messageActionSurface: "thread-view",
    hasComposer: true,
    contextEnvironmentId: ENVIRONMENT.id,
    render: ({ sink }) => (
      <DefaultPaneContextProvider
        paneId="main"
        onRequestClose={null}
        navigateInPane={() => {}}
      >
        <ContractStateProbe
          panelStateId={THREAD.id}
          syncThreadId={THREAD.id}
          sink={sink}
        />
        <ThreadDetailView
          surface="pane"
          projectId={THREAD.projectId}
          threadId={THREAD.id}
          timelineEnabled
        />
      </DefaultPaneContextProvider>
    ),
    openedReadme: ({ sink }) => {
      const snapshot = snapshotFromState(sink);
      return (
        snapshot.isOpen &&
        snapshot.activeTabId !== null &&
        snapshot.activeTabId.includes("README.md")
      );
    },
  },
  {
    name: "plugin ThreadChat full",
    messageActionSurface: "embedded-chat",
    hasComposer: true,
    contextEnvironmentId: null,
    render: pluginThreadChat("full"),
    openedReadme: pluginOpenedReadme,
  },
  {
    name: "plugin ThreadChat compact",
    messageActionSurface: "embedded-chat",
    hasComposer: true,
    contextEnvironmentId: null,
    render: pluginThreadChat("compact"),
    openedReadme: pluginOpenedReadme,
  },
  {
    name: "plugin ThreadChat timeline",
    messageActionSurface: "embedded-chat",
    hasComposer: false,
    contextEnvironmentId: null,
    render: pluginThreadChat("timeline"),
    openedReadme: pluginOpenedReadme,
  },
];

beforeEach(() => {
  markPluginFrontendsSettled();
  window.localStorage.clear();
  resetFixedPanelTabsStateForTest();
  mocks.promptAreaProps = [];
  vi.spyOn(sdk.threads, "get").mockResolvedValue(THREAD as never);
  vi.spyOn(sdk.hosts, "list").mockResolvedValue([] as never);
  setPluginSlotRegistrations(
    "provider",
    makePluginRegistrationSet({
      messageActions: [
        {
          id: "summarize",
          title: "Summarize",
          icon: "Zap",
          experimental_surfaces: ["thread-view", "embedded-chat"],
          run: vi.fn(),
        },
        {
          id: "thread-view-only",
          title: "Thread view only",
          icon: "Zap",
          experimental_surfaces: ["thread-view"],
          run: vi.fn(),
        },
        {
          id: "thread-chat-only",
          title: "ThreadChat only",
          icon: "Zap",
          experimental_surfaces: ["embedded-chat"],
          run: vi.fn(),
        },
      ],
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetPluginSlotStoreForTest();
});

function renderSurface(surface: ThreadScreenSurface) {
  const hosts: SurfaceHosts = {
    openFilePreview: vi.fn((_intent: AppFilePreviewIntent) => true),
    sink: { current: null },
  };
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  const view = render(
    <Wrapper>
      <Provider>
        <MemoryRouter>{surface.render(hosts)}</MemoryRouter>
      </Provider>
    </Wrapper>,
  );
  return { ...view, hosts };
}

async function findRow(container: HTMLElement, rowId: string) {
  await waitFor(() =>
    expect(
      container.querySelector(`[data-timeline-row-id="${rowId}"]`),
    ).not.toBeNull(),
  );
  return container.querySelector<HTMLElement>(
    `[data-timeline-row-id="${rowId}"]`,
  )!;
}

describe.each(SURFACES)("ThreadScreen surface contract: $name", (surface) => {
  it("shows every registered plugin message action on the thread's messages", async () => {
    const { container } = renderSurface(surface);
    const row = await findRow(container, "assistant_row");
    expect(row.querySelector('[aria-label="Summarize"]')).not.toBeNull();
  });

  it("shows a message action only on the surfaces it declares", async () => {
    const { container } = renderSurface(surface);
    const row = await findRow(container, "assistant_row");
    await waitFor(() =>
      expect(row.querySelector('[aria-label="Summarize"]')).not.toBeNull(),
    );
    expect(row.querySelector('[aria-label="Thread view only"]') !== null).toBe(
      surface.messageActionSurface === "thread-view",
    );
    expect(row.querySelector('[aria-label="ThreadChat only"]') !== null).toBe(
      surface.messageActionSurface === "embedded-chat",
    );
  });

  it("opens a changed file from its timeline title", async () => {
    const { container, hosts } = renderSurface(surface);
    const row = await findRow(container, "edit_row");
    const title = [...row.querySelectorAll('[role="link"]')].find((element) =>
      element.textContent?.includes("README.md"),
    );
    expect(title).toBeDefined();
    fireEvent.click(title!);
    await waitFor(() => expect(surface.openedReadme(hosts)).toBe(true));
  });

  it.runIf(surface.hasComposer)(
    "gives the composer the thread's context usage, context environment and new-thread action",
    async () => {
      renderSurface(surface);
      await waitFor(() =>
        expect(screen.getByTestId("prompt-area")).toBeTruthy(),
      );
      const props = mocks.promptAreaProps.at(-1)!;
      expect(props.contextWindowUsage).toBe(CONTEXT_WINDOW_USAGE);
      expect(props.contextEnvironmentId).toBe(surface.contextEnvironmentId);
      expect(typeof props.onCreateNewThreadInEnvironment).toBe("function");
    },
  );
});
