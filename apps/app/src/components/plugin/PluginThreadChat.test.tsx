// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";
import { ThreadTimelineNavigationProvider } from "@/components/thread/timeline/ThreadTimelineNavigationContext";
import { PluginSlotMount } from "./PluginSlotMount";
import * as embeddedChatModule from "@/components/thread/embedded-chat";
import * as timelineModule from "@/components/thread/timeline";
import * as realtimeSubscriptionModule from "@/hooks/useRealtimeSubscription";
import * as hostDaemonModule from "@/hooks/useHostDaemon";

type EmbeddedChatProps = Parameters<
  typeof embeddedChatModule.EmbeddedThreadChat
>[0];
type TimelinePanelProps = Parameters<
  typeof timelineModule.ThreadTimelinePanelContent
>[0];

interface PluginThreadChatTestMocks {
  embeddedChatProps: EmbeddedChatProps[];
  timelinePanelProps: TimelinePanelProps[];
}

const mocks: PluginThreadChatTestMocks = {
  embeddedChatProps: [],
  timelinePanelProps: [],
};

vi.spyOn(sdk.threads, "get");
vi.spyOn(sdk.providers, "list").mockResolvedValue([]);
vi.spyOn(
  realtimeSubscriptionModule,
  "useThreadDetailRealtimeSubscription",
).mockImplementation(() => {});
vi.spyOn(
  realtimeSubscriptionModule,
  "useThreadListRealtimeSubscription",
).mockImplementation(() => {});
vi.spyOn(
  realtimeSubscriptionModule,
  "useEnvironmentDetailRealtimeSubscription",
).mockImplementation(() => {});
vi.spyOn(
  realtimeSubscriptionModule,
  "useSystemRealtimeSubscription",
).mockImplementation(() => {});
vi.spyOn(hostDaemonModule, "useHostDaemon").mockReturnValue({
  localDaemonHostId: null,
  localHostId: null,
  hasDaemon: true,
  supportsNativeFolderPicker: false,
  platform: null,
  isLocalDaemonHost: () => true,
});
vi.spyOn(embeddedChatModule, "EmbeddedThreadChat").mockImplementation(
  (props) => {
    mocks.embeddedChatProps.push(props);
    return <div data-testid="embedded-thread-chat" />;
  },
);
vi.spyOn(timelineModule, "ThreadTimelinePanelContent").mockImplementation(
  (props) => {
    mocks.timelinePanelProps.push(props);
    return <div data-testid="timeline-panel-content" />;
  },
);

const THREAD_FIXTURE = {
  id: "thr_demo",
  projectId: "proj_demo",
  providerId: "provider_demo",
  environmentId: null,
  status: "active",
  runtime: { displayStatus: "idle" },
};

function DemoPluginPage({ threadId }: { threadId: string }) {
  const ThreadChat = pluginSdkAppImplementation.ThreadChat;
  return <ThreadChat threadId={threadId} variant="compact" />;
}

function DemoPluginPageWithExtensions({
  threadId,
  run,
}: {
  threadId: string;
  run: () => void;
}) {
  const ThreadChat = pluginSdkAppImplementation.ThreadChat;
  return (
    <ThreadChat
      threadId={threadId}
      variant="compact"
      leadingContent={<div data-testid="replying-to">Replying to</div>}
      messageActions={[
        {
          id: "send-to-main",
          title: "Send to main thread",
          icon: "ArrowTurnBackward",
          roles: ["assistant"],
          run,
        },
      ]}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mocks.embeddedChatProps = [];
  mocks.timelinePanelProps = [];
  vi.mocked(sdk.threads.get).mockResolvedValue(
    /* SAFETY: The test controls this fixture and verifies its behavior. */ THREAD_FIXTURE as never,
  );
});

function latestEmbeddedChatProps(): Extract<
  EmbeddedChatProps,
  { variant: "compact" }
> {
  const props = mocks.embeddedChatProps.at(-1);
  if (props === undefined || props.variant !== "compact") {
    throw new Error("Expected compact embedded chat props");
  }
  return props;
}

describe("PluginThreadChat", () => {
  it("gives a plugin page a working query client and sdk-backed thread context", async () => {
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    render(
      <Wrapper>
        <MemoryRouter>
          <PluginSlotMount pluginId="demo" slotKind="navPanel" slotId="page">
            <DemoPluginPage threadId="thr_demo" />
          </PluginSlotMount>
        </MemoryRouter>
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("embedded-thread-chat")).toBeTruthy(),
    );
    expect(sdk.threads.get).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thr_demo" }),
    );
    const props = latestEmbeddedChatProps();
    expect(props.projectId).toBe("proj_demo");
    expect(props.providerId).toBe("provider_demo");
    expect(props.variant).toBe("compact");
    expect(props.measure).toBe("panel");
    expect(props.surfaceTone).toBe("sidebar");
    expect(props.composer).toEqual(
      expect.objectContaining({
        permissionPolicy: "snapshot",
        draftScope: {
          kind: "thread",
          projectId: "proj_demo",
          threadId: "thr_demo",
        },
      }),
    );
  });

  it("hands the permission picker to the user only when asked", async () => {
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const ThreadChat = pluginSdkAppImplementation.ThreadChat;
    render(
      <Wrapper>
        <MemoryRouter>
          <ThreadChat threadId="thr_demo" permissionPolicy="editable" />
        </MemoryRouter>
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("embedded-thread-chat")).toBeTruthy(),
    );
    expect(latestEmbeddedChatProps().composer).toEqual(
      expect.objectContaining({ permissionPolicy: "editable" }),
    );
  });

  it("uses the surrounding thread detail navigation for timeline links", async () => {
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const onOpenLink = vi.fn(() => true);
    const onOpenLocalFileLink = vi.fn(() => true);
    const workspaceMentionHandler = vi.fn();
    const resolveMentionLink = vi.fn(() => workspaceMentionHandler);

    render(
      <Wrapper>
        <MemoryRouter>
          <ThreadTimelineNavigationProvider
            environmentId={null}
            onOpenLink={onOpenLink}
            onOpenLocalFileLink={onOpenLocalFileLink}
            resolveMentionLink={resolveMentionLink}
            workspaceRootPath="/workspace"
          >
            <DemoPluginPage threadId="thr_demo" />
          </ThreadTimelineNavigationProvider>
        </MemoryRouter>
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("embedded-thread-chat")).toBeTruthy(),
    );
    const props = latestEmbeddedChatProps();
    expect(props).toEqual(
      expect.objectContaining({
        onOpenLink,
        onOpenLocalFileLink,
        workspaceRootPath: "/workspace",
      }),
    );

    const embeddedResolveMentionLink = props.resolveMentionLink;
    const workspaceMention = {
      kind: "path" as const,
      source: "workspace" as const,
      entryKind: "file" as const,
      path: "README.md",
      label: "README.md",
    };
    expect(embeddedResolveMentionLink(workspaceMention)).toBe(
      workspaceMentionHandler,
    );
    expect(resolveMentionLink).toHaveBeenCalledWith(workspaceMention);
  });

  it("maps variant timeline to a composer-less transcript", async () => {
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const ThreadChat = pluginSdkAppImplementation.ThreadChat;
    render(
      <Wrapper>
        <MemoryRouter>
          <ThreadChat threadId="thr_demo" variant="timeline" />
        </MemoryRouter>
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("timeline-panel-content")).toBeTruthy(),
    );
    expect(mocks.embeddedChatProps).toHaveLength(0);
    expect(mocks.timelinePanelProps.at(-1)?.threadId).toBe("thr_demo");
  });

  it("forwards leadingContent and maps messageActions to consumer actions", async () => {
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const run = vi.fn();
    render(
      <Wrapper>
        <MemoryRouter>
          <PluginSlotMount pluginId="demo" slotKind="navPanel" slotId="page">
            <DemoPluginPageWithExtensions threadId="thr_demo" run={run} />
          </PluginSlotMount>
        </MemoryRouter>
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("embedded-thread-chat")).toBeTruthy(),
    );
    const props = latestEmbeddedChatProps();
    expect(props.leadingContent).toBeTruthy();
    const actions = props.consumerMessageActions;
    if (actions === undefined) throw new Error("Expected consumer actions");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual(
      expect.objectContaining({
        id: "send-to-main",
        pluginId: null,
        icon: "ArrowTurnBackward",
        label: "Send to main thread",
        roles: ["assistant"],
        run,
      }),
    );
  });

  it("maps variant full to the page measure and forwards focus requests", async () => {
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const ThreadChat = pluginSdkAppImplementation.ThreadChat;
    render(
      <Wrapper>
        <MemoryRouter>
          <ThreadChat threadId="thr_demo" layout="document" focusRequest={3} />
        </MemoryRouter>
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("embedded-thread-chat")).toBeTruthy(),
    );
    const props = latestEmbeddedChatProps();
    expect(props.measure).toBe("page");
    expect(props.layout).toBe("document");
    expect(props.composer).toEqual(
      expect.objectContaining({ focusRequestKey: 3 }),
    );
  });
});
