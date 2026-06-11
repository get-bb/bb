// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PromptInput,
  ThreadListEntry,
  ThreadWithRuntime,
} from "@bb/domain";
import type {
  PromptHistoryResponse,
  SendQueuedMessageResponse,
  ThreadQueuedMessageListResponse,
  ThreadTimelineResponse,
} from "@bb/server-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import * as api from "@/lib/api";
import {
  projectPromptHistoryQueryKey,
  projectSourceBranchesQueryKey,
  threadListQueryKey,
  threadQueryKey,
  threadQueuedMessagesQueryKey,
  threadPromptHistoryQueryKey,
  threadTimelineQueryKey,
} from "../queries/query-keys";
import {
  useCreateThread,
  useCreateThreadQueuedMessage,
  useReorderThreadQueuedMessage,
  useSendThreadMessage,
  useStopThread,
} from "./thread-runtime-mutations";

vi.mock("@/lib/api", () => ({
  HttpError: class HttpError extends Error {},
  createThread: vi.fn(),
  createThreadQueuedMessage: vi.fn(),
  reorderThreadQueuedMessage: vi.fn(),
  sendThreadQueuedMessage: vi.fn(),
  sendThreadMessage: vi.fn(),
  stopThread: vi.fn(),
}));

vi.mock("@/lib/ws", () => ({
  wsManager: {
    getConnectionState: vi.fn(() => "connected"),
  },
}));

interface TextInputArgs {
  text: string;
}

function textInput({ text }: TextInputArgs): PromptInput[] {
  return [{ type: "text", text, mentions: [] }];
}

const queuedMessage = {
  id: "queued-1",
  content: textInput({ text: "Continue" }),
  model: "gpt-5",
  reasoningLevel: "medium",
  permissionMode: "full",
  serviceTier: "default",
  createdAt: 1,
  updatedAt: 1,
} satisfies SendQueuedMessageResponse["queuedMessage"];

const secondQueuedMessage = {
  ...queuedMessage,
  id: "queued-2",
  content: textInput({ text: "Second queued message" }),
  createdAt: 2,
  updatedAt: 2,
} satisfies SendQueuedMessageResponse["queuedMessage"];

const createdThread = {
  id: "thread-created",
  projectId: "project-1",
  automationId: null,
  providerId: "codex",
  createdAt: 10,
  status: "idle",
  updatedAt: 10,
  lastReadAt: null,
  latestAttentionAt: 10,
  environmentId: "env-1",
  title: null,
  titleFallback: null,
  parentThreadId: null,
  archivedAt: null,
  pinnedAt: null,
  stopRequestedAt: null,
  deletedAt: null,
  runtime: {
    displayStatus: "idle",
    hostReconnectGraceExpiresAt: null,
  },
} satisfies ThreadWithRuntime;

function makeThreadWithRuntime(
  thread: Partial<ThreadWithRuntime> = {},
): ThreadWithRuntime {
  return {
    id: "thread-1",
    projectId: "project-1",
    automationId: null,
    providerId: "codex",
    createdAt: 1,
    status: "active",
    updatedAt: 1,
    lastReadAt: null,
    latestAttentionAt: 1,
    environmentId: "env-1",
    title: null,
    titleFallback: null,
    parentThreadId: null,
    archivedAt: null,
    pinnedAt: null,
    stopRequestedAt: null,
    deletedAt: null,
    runtime: {
      displayStatus: "waiting-for-host",
      hostReconnectGraceExpiresAt: null,
    },
    ...thread,
  };
}

function makeThreadListEntry(
  thread: ThreadWithRuntime = makeThreadWithRuntime(),
): ThreadListEntry {
  return {
    ...thread,
    hasPendingInteraction: false,
    environmentHostId: "host-1",
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "managed-worktree",
    pinSortKey: null,
  };
}

function makeTimelineResponse(
  rows: ThreadTimelineResponse["rows"] = [],
): ThreadTimelineResponse {
  return {
    rows,
    activeThinking: null,
    pendingTodos: null,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: rows.length > 0 ? 1 : 0,
      hasOlderRows: false,
      olderCursor: null,
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("thread runtime mutations", () => {
  it("adds project create history immediately after thread creation succeeds", async () => {
    vi.mocked(api.createThread).mockResolvedValue(createdThread);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useCreateThread(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        input: textInput({ text: "Open a debugging thread" }),
        projectId: "project-1",
        providerId: "codex",
        environment: {
          type: "host",
          hostId: "host-1",
          workspace: {
            type: "managed-worktree",
            baseBranch: { kind: "default" },
          },
        },
      });
    });

    expect(
      queryClient.getQueryData<PromptHistoryResponse>(
        projectPromptHistoryQueryKey("project-1"),
      ),
    ).toEqual([
      {
        id: expect.stringMatching(/^optimistic-prompt-history:/u),
        createdAt: 10,
        input: textInput({ text: "Open a debugging thread" }),
      },
    ]);
    expect(
      queryClient.getQueryState(projectPromptHistoryQueryKey("project-1"))
        ?.isInvalidated,
    ).toBe(true);
  });

  it("invalidates project source checkout observations after unmanaged checkout intent", async () => {
    vi.mocked(api.createThread).mockResolvedValue(createdThread);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const projectSourceBranchesKey = projectSourceBranchesQueryKey(
      "project-1",
      "host-1",
    );
    queryClient.setQueryData(projectSourceBranchesKey, {
      branches: ["main", "release/1.2"],
      branchesTruncated: false,
      checkout: { kind: "branch", branchName: "main", headSha: "abc123" },
      defaultBranch: "main",
      hasUncommittedChanges: false,
      operation: { kind: "none" },
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: null,
    });
    const { result } = renderHook(() => useCreateThread(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        input: textInput({ text: "Open a release thread" }),
        projectId: "project-1",
        providerId: "codex",
        environment: {
          type: "host",
          hostId: "host-1",
          workspace: {
            type: "unmanaged",
            path: null,
            branch: { kind: "existing", name: "release/1.2" },
          },
        },
      });
    });

    expect(
      queryClient.getQueryState(projectSourceBranchesKey)?.isInvalidated,
    ).toBe(true);
  });

  it("optimistically inserts a user message row into the timeline cache", async () => {
    let resolveSend: (() => void) | null = null;
    vi.mocked(api.sendThreadMessage).mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolveSend = () => resolve(undefined);
        }),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("thread-1"),
      makeTimelineResponse(),
    );
    const { result } = renderHook(() => useSendThreadMessage(), { wrapper });

    let mutationPromise: Promise<void> | undefined;
    act(() => {
      mutationPromise = result.current.mutateAsync({
        id: "thread-1",
        input: textInput({ text: "Hello there" }),
        mode: "auto",
      });
    });

    await waitFor(() => {
      const timeline = queryClient.getQueryData<ThreadTimelineResponse>(
        threadTimelineQueryKey("thread-1"),
      );
      expect(timeline?.rows).toHaveLength(1);
    });
    const optimisticTimeline = queryClient.getQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("thread-1"),
    );
    const onlyRow = optimisticTimeline?.rows[0];
    expect(onlyRow?.kind).toBe("conversation");
    if (onlyRow?.kind === "conversation") {
      expect(onlyRow.role).toBe("user");
      expect(onlyRow.text).toBe("Hello there");
    }

    await act(async () => {
      resolveSend?.();
      await mutationPromise;
    });
  });

  it("optimistically flips displayStatus to active for an idle thread", async () => {
    let resolveSend: (() => void) | null = null;
    vi.mocked(api.sendThreadMessage).mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolveSend = () => resolve(undefined);
        }),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("thread-1"),
      makeThreadWithRuntime({
        status: "idle",
        runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
      }),
    );
    const { result } = renderHook(() => useSendThreadMessage(), { wrapper });

    let mutationPromise: Promise<void> | undefined;
    act(() => {
      mutationPromise = result.current.mutateAsync({
        id: "thread-1",
        input: textInput({ text: "Hello there" }),
        mode: "auto",
      });
    });

    await waitFor(() => {
      const thread = queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey("thread-1"),
      );
      expect(thread?.runtime.displayStatus).toBe("active");
    });

    await act(async () => {
      resolveSend?.();
      await mutationPromise;
    });
  });

  it("preserves host-reconnecting runtime state during optimistic send", async () => {
    let resolveSend: (() => void) | null = null;
    vi.mocked(api.sendThreadMessage).mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolveSend = () => resolve(undefined);
        }),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("thread-1"),
      makeThreadWithRuntime({
        runtime: {
          displayStatus: "host-reconnecting",
          hostReconnectGraceExpiresAt: null,
        },
      }),
    );
    const { result } = renderHook(() => useSendThreadMessage(), { wrapper });

    let mutationPromise: Promise<void> | undefined;
    act(() => {
      mutationPromise = result.current.mutateAsync({
        id: "thread-1",
        input: textInput({ text: "Hello there" }),
        mode: "auto",
      });
    });

    await waitFor(() => {
      const thread = queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey("thread-1"),
      );
      expect(thread?.runtime.displayStatus).toBe("host-reconnecting");
    });

    await act(async () => {
      resolveSend?.();
      await mutationPromise;
    });
  });

  it("preserves unavailable-host runtime state during optimistic send", async () => {
    let resolveSend: (() => void) | null = null;
    vi.mocked(api.sendThreadMessage).mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolveSend = () => resolve(undefined);
        }),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("thread-1"),
      makeThreadWithRuntime(),
    );
    const { result } = renderHook(() => useSendThreadMessage(), { wrapper });

    let mutationPromise: Promise<void> | undefined;
    act(() => {
      mutationPromise = result.current.mutateAsync({
        id: "thread-1",
        input: textInput({ text: "Hello there" }),
        mode: "auto",
      });
    });

    await waitFor(() => {
      const thread = queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey("thread-1"),
      );
      expect(thread?.runtime.displayStatus).toBe("waiting-for-host");
    });

    await act(async () => {
      resolveSend?.();
      await mutationPromise;
    });
  });

  it("optimistically appends an active-turn steer to timeline rows", async () => {
    let resolveSend: (() => void) | null = null;
    vi.mocked(api.sendThreadMessage).mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolveSend = () => resolve(undefined);
        }),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("thread-1"),
      makeThreadWithRuntime({ status: "active" }),
    );
    queryClient.setQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("thread-1"),
      makeTimelineResponse(),
    );
    const { result } = renderHook(() => useSendThreadMessage(), { wrapper });

    let mutationPromise: Promise<void> | undefined;
    act(() => {
      mutationPromise = result.current.mutateAsync({
        id: "thread-1",
        input: textInput({ text: "Keep this in mind" }),
        mode: "auto",
      });
    });

    await waitFor(() => {
      const timeline = queryClient.getQueryData<ThreadTimelineResponse>(
        threadTimelineQueryKey("thread-1"),
      );
      expect(timeline?.rows).toHaveLength(1);
    });
    const timeline = queryClient.getQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("thread-1"),
    );
    expect(timeline?.rows[0]).toMatchObject({
      kind: "conversation",
      role: "user",
      text: "Keep this in mind",
      turnRequest: {
        kind: "steer",
        status: "pending",
      },
    });

    await act(async () => {
      resolveSend?.();
      await mutationPromise;
    });
  });

  it("optimistically appends pending steers to thread timelines", async () => {
    let resolveSend: (() => void) | null = null;
    vi.mocked(api.sendThreadMessage).mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolveSend = () => resolve(undefined);
        }),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("thread-1"),
      makeThreadWithRuntime({ status: "active" }),
    );
    queryClient.setQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("thread-1"),
      makeTimelineResponse(),
    );
    const { result } = renderHook(() => useSendThreadMessage(), { wrapper });

    let mutationPromise: Promise<void> | undefined;
    act(() => {
      mutationPromise = result.current.mutateAsync({
        id: "thread-1",
        input: textInput({ text: "Keep this in mind" }),
        mode: "auto",
      });
    });

    await waitFor(() => {
      const timeline = queryClient.getQueryData<ThreadTimelineResponse>(
        threadTimelineQueryKey("thread-1"),
      );
      expect(timeline?.rows).toHaveLength(1);
    });

    await act(async () => {
      resolveSend?.();
      await mutationPromise;
    });
  });

  it("does not insert an accepted turn when queue-if-active queues for an active thread", async () => {
    vi.mocked(api.sendThreadMessage).mockResolvedValue(undefined);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const queuedMessagesKey = threadQueuedMessagesQueryKey("thread-1");
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("thread-1"),
      makeThreadWithRuntime({ status: "active" }),
    );
    queryClient.setQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("thread-1"),
      makeTimelineResponse(),
    );
    queryClient.setQueryData<ThreadQueuedMessageListResponse>(
      queuedMessagesKey,
      [],
    );
    const { result } = renderHook(() => useSendThreadMessage(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: "thread-1",
        input: textInput({ text: "Queue this instead" }),
        mode: "queue-if-active",
      });
    });

    expect(
      queryClient.getQueryData<ThreadTimelineResponse>(
        threadTimelineQueryKey("thread-1"),
      )?.rows,
    ).toEqual([]);
    expect(
      queryClient.getQueryData<PromptHistoryResponse>(
        threadPromptHistoryQueryKey("thread-1"),
      ),
    ).toBeUndefined();
    expect(queryClient.getQueryState(queuedMessagesKey)?.isInvalidated).toBe(
      true,
    );
  });

  it("adds optimistic pending steer timeline rows when thread detail data is missing", async () => {
    let resolveSend: (() => void) | null = null;
    vi.mocked(api.sendThreadMessage).mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolveSend = () => resolve(undefined);
        }),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("thread-1"),
      makeTimelineResponse(),
    );
    const { result } = renderHook(() => useSendThreadMessage(), { wrapper });

    let mutationPromise: Promise<void> | undefined;
    act(() => {
      mutationPromise = result.current.mutateAsync({
        id: "thread-1",
        input: textInput({ text: "Keep this in mind" }),
        mode: "steer",
      });
    });

    await waitFor(() => {
      expect(api.sendThreadMessage).toHaveBeenCalled();
    });
    expect(
      queryClient.getQueryData<ThreadTimelineResponse>(
        threadTimelineQueryKey("thread-1"),
      )?.rows,
    ).toHaveLength(1);
    await act(async () => {
      resolveSend?.();
      await mutationPromise;
    });
  });

  it("rolls back the optimistic timeline row when send fails", async () => {
    vi.mocked(api.sendThreadMessage).mockRejectedValue(new Error("boom"));
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("thread-1"),
      makeTimelineResponse(),
    );
    const { result } = renderHook(() => useSendThreadMessage(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          id: "thread-1",
          input: textInput({ text: "Hello there" }),
          mode: "auto",
        }),
      ).rejects.toThrow("boom");
    });

    const finalTimeline = queryClient.getQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("thread-1"),
    );
    expect(finalTimeline?.rows).toHaveLength(0);
  });

  it("rolls back the optimistic pending steer when send fails", async () => {
    vi.mocked(api.sendThreadMessage).mockRejectedValue(new Error("boom"));
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("thread-1"),
      makeThreadWithRuntime({ status: "active" }),
    );
    queryClient.setQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("thread-1"),
      makeTimelineResponse(),
    );
    const { result } = renderHook(() => useSendThreadMessage(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          id: "thread-1",
          input: textInput({ text: "Keep this in mind" }),
          mode: "auto",
        }),
      ).rejects.toThrow("boom");
    });

    const finalTimeline = queryClient.getQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("thread-1"),
    );
    expect(finalTimeline?.rows).toHaveLength(0);
  });

  it("adds thread follow-up history immediately after sending succeeds", async () => {
    vi.mocked(api.sendThreadMessage).mockResolvedValue(undefined);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useSendThreadMessage(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: "thread-1",
        input: textInput({ text: "Continue" }),
        mode: "auto",
      });
    });

    expect(
      queryClient.getQueryData<PromptHistoryResponse>(
        threadPromptHistoryQueryKey("thread-1"),
      ),
    ).toEqual([
      {
        id: expect.stringMatching(/^optimistic-prompt-history:/u),
        createdAt: expect.any(Number),
        input: textInput({ text: "Continue" }),
      },
    ]);
  });

  it("does not create thread follow-up history when sending fails", async () => {
    vi.mocked(api.sendThreadMessage).mockRejectedValue(new Error("boom"));
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useSendThreadMessage(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          id: "thread-1",
          input: textInput({ text: "Continue" }),
          mode: "auto",
        }),
      ).rejects.toThrow("boom");
    });

    expect(
      queryClient.getQueryData<PromptHistoryResponse>(
        threadPromptHistoryQueryKey("thread-1"),
      ),
    ).toBeUndefined();
  });

  it("optimistically marks stop requested while the stop request is in flight", async () => {
    let resolveStop: (() => void) | null = null;
    vi.mocked(api.stopThread).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStop = () => resolve();
        }),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const thread = makeThreadWithRuntime({
      runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
    });
    const threadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("thread-1"),
      thread,
    );
    queryClient.setQueryData<ThreadListEntry[]>(threadListKey, [
      makeThreadListEntry(thread),
    ]);
    const { result } = renderHook(() => useStopThread(), { wrapper });

    let mutationPromise: Promise<void> | undefined;
    act(() => {
      mutationPromise = result.current.mutateAsync("thread-1");
    });

    await waitFor(() => {
      const stoppedThread = queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey("thread-1"),
      );
      expect(stoppedThread?.stopRequestedAt).toEqual(expect.any(Number));
    });

    const stoppedThread = queryClient.getQueryData<ThreadWithRuntime>(
      threadQueryKey("thread-1"),
    );
    const stoppedList =
      queryClient.getQueryData<ThreadListEntry[]>(threadListKey);
    expect(stoppedList?.[0]?.stopRequestedAt).toBe(
      stoppedThread?.stopRequestedAt,
    );

    await act(async () => {
      resolveStop?.();
      await mutationPromise;
    });
  });

  it("rolls back optimistic stop requested state when stopping fails", async () => {
    vi.mocked(api.stopThread).mockRejectedValue(new Error("boom"));
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const thread = makeThreadWithRuntime({
      runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
    });
    const threadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("thread-1"),
      thread,
    );
    queryClient.setQueryData<ThreadListEntry[]>(threadListKey, [
      makeThreadListEntry(thread),
    ]);
    const { result } = renderHook(() => useStopThread(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync("thread-1")).rejects.toThrow(
        "boom",
      );
    });

    expect(
      queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey("thread-1"))
        ?.stopRequestedAt,
    ).toBeNull();
    expect(
      queryClient.getQueryData<ThreadListEntry[]>(threadListKey)?.[0]
        ?.stopRequestedAt,
    ).toBeNull();
  });

  it("adds queued message history immediately after queued message creation succeeds", async () => {
    vi.mocked(api.createThreadQueuedMessage).mockResolvedValue(queuedMessage);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useCreateThreadQueuedMessage(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: "thread-1",
        input: textInput({ text: "Continue" }),
      });
    });

    expect(
      queryClient.getQueryData<PromptHistoryResponse>(
        threadPromptHistoryQueryKey("thread-1"),
      ),
    ).toEqual([
      {
        id: "queued-message:queued-1",
        createdAt: 1,
        input: textInput({ text: "Continue" }),
      },
    ]);
  });

  it("optimistically reorders queued messages and reconciles with the server response", async () => {
    let resolveReorder:
      | ((queuedMessages: ThreadQueuedMessageListResponse) => void)
      | null = null;
    vi.mocked(api.reorderThreadQueuedMessage).mockImplementation(
      () =>
        new Promise<ThreadQueuedMessageListResponse>((resolve) => {
          resolveReorder = resolve;
        }),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const queryKey = threadQueuedMessagesQueryKey("thread-1");
    queryClient.setQueryData<ThreadQueuedMessageListResponse>(queryKey, [
      queuedMessage,
      secondQueuedMessage,
    ]);
    const { result } = renderHook(() => useReorderThreadQueuedMessage(), {
      wrapper,
    });

    let mutationPromise: Promise<ThreadQueuedMessageListResponse> | undefined;
    act(() => {
      mutationPromise = result.current.mutateAsync({
        id: "thread-1",
        queuedMessageId: secondQueuedMessage.id,
        previousQueuedMessageId: null,
        nextQueuedMessageId: queuedMessage.id,
      });
    });

    await waitFor(() => {
      expect(
        queryClient
          .getQueryData<ThreadQueuedMessageListResponse>(queryKey)
          ?.map((message) => message.id),
      ).toEqual([secondQueuedMessage.id, queuedMessage.id]);
    });
    expect(api.reorderThreadQueuedMessage).toHaveBeenCalledWith(
      "thread-1",
      secondQueuedMessage.id,
      {
        previousQueuedMessageId: null,
        nextQueuedMessageId: queuedMessage.id,
      },
    );

    await act(async () => {
      resolveReorder?.([secondQueuedMessage, queuedMessage]);
      await mutationPromise;
    });

    expect(
      queryClient
        .getQueryData<ThreadQueuedMessageListResponse>(queryKey)
        ?.map((message) => message.id),
    ).toEqual([secondQueuedMessage.id, queuedMessage.id]);
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  it("rolls back optimistic queued message reorder failures", async () => {
    vi.mocked(api.reorderThreadQueuedMessage).mockRejectedValue(
      new Error("stale order"),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const queryKey = threadQueuedMessagesQueryKey("thread-1");
    queryClient.setQueryData<ThreadQueuedMessageListResponse>(queryKey, [
      queuedMessage,
      secondQueuedMessage,
    ]);
    const { result } = renderHook(() => useReorderThreadQueuedMessage(), {
      wrapper,
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          id: "thread-1",
          queuedMessageId: secondQueuedMessage.id,
          previousQueuedMessageId: null,
          nextQueuedMessageId: queuedMessage.id,
        }),
      ).rejects.toThrow("stale order");
    });

    expect(
      queryClient
        .getQueryData<ThreadQueuedMessageListResponse>(queryKey)
        ?.map((message) => message.id),
    ).toEqual([queuedMessage.id, secondQueuedMessage.id]);
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });
});
