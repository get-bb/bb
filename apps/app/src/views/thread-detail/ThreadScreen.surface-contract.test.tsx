// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseThreadTimelineControllerResult } from "@/components/thread/timeline";
import { LazyPluginThreadChat } from "@/components/plugin/LazyPluginThreadChat";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { sdk } from "@/lib/sdk";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadScreen } from "./ThreadScreen";

await LazyPluginThreadChat.preload();

const mocks = vi.hoisted(() => ({
  promptAreaProps: [] as Array<Record<string, unknown>>,
}));

const THREAD = makeThreadResponse({
  id: "thr_surface",
  projectId: "proj_surface",
  environmentId: null,
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
  ],
};

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: { get: vi.fn() },
    environments: { get: vi.fn() },
    hosts: { list: vi.fn(async () => []) },
    providers: { list: vi.fn(async () => []) },
  },
  BbHttpError: class BbHttpError extends Error {
    status: number;
    constructor(status: number) {
      super(`http ${status}`);
      this.status = status;
    }
  },
}));

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

interface ThreadScreenSurface {
  name: string;
  hasComposer: boolean;
  element: ReactNode;
}

function pluginThreadChat(variant: "full" | "compact" | "timeline") {
  const ThreadChat = pluginSdkAppImplementation.ThreadChat;
  return (
    <PluginSlotMount pluginId="host" slotKind="navPanel" slotId="page">
      <ThreadChat threadId={THREAD.id} variant={variant} />
    </PluginSlotMount>
  );
}

const SURFACES: readonly ThreadScreenSurface[] = [
  {
    name: "thread page",
    hasComposer: true,
    element: (
      <ThreadScreen
        composer={{
          environmentCheckout: undefined,
          environmentChrome: undefined,
          contextEnvironmentId: null,
          permissionPolicy: "editable",
        }}
        environment={null}
        presentation={{ kind: "page" }}
        projectId={THREAD.projectId}
        resolveMentionLink={() => null}
        thread={THREAD}
        timelineEnabled
        timelineHost={{
          environmentHostName: null,
          unreadDividerAutoScroll: false,
          unreadDividerPlacement: null,
        }}
      />
    ),
  },
  {
    name: "plugin ThreadChat full",
    hasComposer: true,
    element: pluginThreadChat("full"),
  },
  {
    name: "plugin ThreadChat compact",
    hasComposer: true,
    element: pluginThreadChat("compact"),
  },
  {
    name: "plugin ThreadChat timeline",
    hasComposer: false,
    element: pluginThreadChat("timeline"),
  },
];

beforeEach(() => {
  mocks.promptAreaProps = [];
  vi.mocked(sdk.threads.get).mockResolvedValue(THREAD as never);
  setPluginSlotRegistrations(
    "provider",
    makePluginRegistrationSet({
      messageActions: [
        { id: "summarize", title: "Summarize", icon: "Zap", run: vi.fn() },
      ],
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetPluginSlotStoreForTest();
});

function renderSurface(surface: ThreadScreenSurface) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <Wrapper>
      <MemoryRouter>{surface.element}</MemoryRouter>
    </Wrapper>,
  );
}

describe.each(SURFACES)("ThreadScreen surface contract: $name", (surface) => {
  it("shows every registered plugin message action on the thread's messages", async () => {
    const { container } = renderSurface(surface);
    await waitFor(() =>
      expect(
        container.querySelector('[data-timeline-row-id="assistant_row"]'),
      ).not.toBeNull(),
    );
    const row = container.querySelector(
      '[data-timeline-row-id="assistant_row"]',
    );
    expect(row?.querySelector('[aria-label="Summarize"]')).not.toBeNull();
  });

  it.runIf(surface.hasComposer)(
    "gives the composer the thread's context window usage",
    async () => {
      renderSurface(surface);
      await waitFor(() =>
        expect(screen.getByTestId("prompt-area")).toBeTruthy(),
      );
      expect(mocks.promptAreaProps.at(-1)?.contextWindowUsage).toBe(
        CONTEXT_WINDOW_USAGE,
      );
    },
  );
});
