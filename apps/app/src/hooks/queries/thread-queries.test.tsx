// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Environment, Host, ThreadWithRuntime } from "@bb/domain";
import type {
  ThreadComposerBootstrapResponse,
  ThreadListResponse,
  TimelineTurnSummaryDetailsResponse,
  ThreadTimelineResponse,
} from "@bb/server-contract";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installAbortableJsonRoute } from "@/test/abort-signal-test-utils";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { useEnvironment } from "./environment-queries";
import {
  useProjectThreadSubset,
  useThread,
  useThreadComposerBootstrap,
  useThreadDetailBootstrap,
  useThreadDefaultExecutionOptions,
  useThreadHostFilePreview,
  useThreadTimeline,
  useThreadTimelineTurnSummaryDetails,
  useThreadQueuedMessages,
  useThreadPendingInteractions,
  useThreadPromptHistory,
} from "./thread-queries";
import {
  hostsQueryKey,
  systemExecutionOptionsQueryKey,
  threadComposerBootstrapQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadHostFilePreviewQueryKey,
  threadQueuedMessagesQueryKey,
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadListQueryKey,
  threadQueryKey,
  threadTimelineQueryKey,
  threadTimelineTurnSummaryDetailsQueryKey,
} from "./query-keys";

interface TestWrapperProps {
  children: ReactNode;
}

interface TurnSummaryDetailsHookProps {
  sourceSeqEnd: number;
  sourceSeqStart: number;
  threadId: string;
  turnId: string;
}

type ThreadListEntryFixture = ThreadListResponse[number];
type ThreadListEntryFixtureOverrides = Partial<ThreadListEntryFixture>;

function makeThread(): ThreadWithRuntime {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "environment-1",
    id: "thread-1",
    lastReadAt: null,
    latestAttentionAt: 10,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "project-1",
    providerId: "provider-1",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    status: "idle",
    stopRequestedAt: null,
    title: "Thread title",
    titleFallback: "Thread title",
    updatedAt: 10,
  };
}

function makeThreadListEntry(
  overrides: ThreadListEntryFixtureOverrides = {},
): ThreadListEntryFixture {
  return {
    ...makeThread(),
    environmentBranchName: null,
    environmentHostId: null,
    environmentName: null,
    environmentWorkspaceDisplayKind: "other",
    hasPendingInteraction: false,
    pinSortKey: null,
    ...overrides,
  };
}

function makeEnvironment(): Environment {
  return {
    baseBranch: null,
    branchName: "bb/test",
    cleanupMode: null,
    cleanupRequestedAt: null,
    createdAt: 1,
    defaultBranch: "main",
    hostId: "host-1",
    id: "environment-1",
    name: null,
    isGitRepo: true,
    isWorktree: false,
    managed: false,
    mergeBaseBranch: null,
    path: "/tmp/thread-detail-bootstrap",
    projectId: "project-1",
    status: "ready",
    updatedAt: 1,
    workspaceProvisionType: "unmanaged",
  };
}

function makeHost(): Host {
  return {
    createdAt: 1,
    id: "host-1",
    lastSeenAt: 1,
    name: "Test Host",
    status: "connected",
    type: "persistent",
    updatedAt: 1,
  };
}

function createWrapper() {
  const harness = createQueryClientTestHarness();

  function Wrapper({ children }: TestWrapperProps) {
    return harness.wrapper({ children });
  }

  return {
    queryClient: harness.queryClient,
    wrapper: Wrapper,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("thread query bootstraps", () => {
  it("primes thread, environment, and host caches from the thread detail bootstrap", async () => {
    const thread = makeThread();
    const environment = makeEnvironment();
    const host = makeHost();
    let includeThreadRequestCount = 0;
    let leanThreadRequestCount = 0;
    let hostListRequestCount = 0;
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thread-1",
        handler: (request) => {
          const url = new URL(request.url);
          if (url.searchParams.get("include") === "environment,host") {
            includeThreadRequestCount += 1;
            return jsonResponse({
              ...thread,
              environment,
              host,
            });
          }
          leanThreadRequestCount += 1;
          return jsonResponse(thread);
        },
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => {
          hostListRequestCount += 1;
          return jsonResponse([host]);
        },
      },
    ]);
    const { queryClient, wrapper } = createWrapper();

    const { result } = renderHook(
      () => {
        const bootstrap = useThreadDetailBootstrap("thread-1");
        const canonicalEnabled = bootstrap.isSuccess || bootstrap.isError;
        const canonicalThread = useThread("thread-1", {
          enabled: canonicalEnabled,
          refetchOnMount: bootstrap.isSuccess ? true : "always",
        });
        const canonicalEnvironment = useEnvironment("environment-1", {
          enabled: canonicalEnabled,
          staleTime: 5_000,
        });
        return {
          bootstrap,
          canonicalEnvironment,
          canonicalThread,
        };
      },
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.bootstrap.status).toBe("success");
      expect(result.current.canonicalThread.data?.id).toBe(thread.id);
      expect(result.current.canonicalEnvironment.data?.id).toBe(environment.id);
    });
    expect(queryClient.getQueryData(hostsQueryKey())).toEqual([host]);
    expect(includeThreadRequestCount).toBe(1);
    expect(leanThreadRequestCount).toBe(0);
    expect(hostListRequestCount).toBe(0);

    await queryClient.invalidateQueries({
      queryKey: threadQueryKey(thread.id),
    });
    await waitFor(() => {
      expect(leanThreadRequestCount).toBe(1);
    });
    expect(includeThreadRequestCount).toBe(1);
  });

  it("falls back to the lean thread query when the detail bootstrap fails", async () => {
    const thread = makeThread();
    let includeThreadRequestCount = 0;
    let leanThreadRequestCount = 0;
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thread-1",
        handler: (request) => {
          const url = new URL(request.url);
          if (url.searchParams.get("include") === "environment,host") {
            includeThreadRequestCount += 1;
            return new Response("starting", { status: 503 });
          }
          leanThreadRequestCount += 1;
          return jsonResponse(thread);
        },
      },
    ]);
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => {
        const bootstrap = useThreadDetailBootstrap("thread-1");
        const canonicalThread = useThread("thread-1", {
          enabled: bootstrap.isSuccess || bootstrap.isError,
          refetchOnMount: bootstrap.isSuccess ? true : "always",
        });
        return { bootstrap, canonicalThread };
      },
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.bootstrap.status).toBe("error");
      expect(result.current.canonicalThread.data?.id).toBe(thread.id);
    });
    expect(includeThreadRequestCount).toBe(1);
    expect(leanThreadRequestCount).toBe(1);
  });

  it("prefetches thread timelines into the timeline cache", async () => {
    const thread = makeThread();
    const environment = makeEnvironment();
    const host = makeHost();
    const timeline: ThreadTimelineResponse = {
      activeThinking: null,
      pendingTodos: null,
      rows: [],
      timelinePage: {
        kind: "latest",
        segmentLimit: 20,
        returnedSegmentCount: 0,
        hasOlderRows: false,
        olderCursor: null,
      },
    };
    let includeThreadRequestCount = 0;
    let timelineRequestCount = 0;
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thread-1",
        handler: () => {
          includeThreadRequestCount += 1;
          return jsonResponse({
            ...thread,
            environment,
            host,
          });
        },
      },
      {
        pathname: "/api/v1/threads/thread-1/timeline",
        handler: () => {
          timelineRequestCount += 1;
          return jsonResponse(timeline);
        },
      },
    ]);
    const { queryClient, wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useThreadDetailBootstrap("thread-1", {
          timelinePrefetch: true,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.status).toBe("success");
      expect(timelineRequestCount).toBe(1);
    });
    expect(includeThreadRequestCount).toBe(1);
    expect(
      queryClient.getQueryData(threadTimelineQueryKey("thread-1")),
    ).toEqual(timeline);

    const timelineResult = renderHook(() => useThreadTimeline("thread-1"), {
      wrapper,
    });

    await waitFor(() => {
      expect(timelineResult.result.current.data).toEqual(timeline);
    });
    expect(timelineRequestCount).toBe(1);
  });

  it("keys turn summary details by thread, turn, and source range", async () => {
    const requestUrls: URL[] = [];
    const detailResponse: TimelineTurnSummaryDetailsResponse = { rows: [] };
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thread-1/timeline/turn-summary-details",
        handler: (request) => {
          requestUrls.push(new URL(request.url));
          return jsonResponse(detailResponse);
        },
      },
    ]);
    const { queryClient, wrapper } = createWrapper();
    const initialProps: TurnSummaryDetailsHookProps = {
      sourceSeqEnd: 10,
      sourceSeqStart: 5,
      threadId: "thread-1",
      turnId: "turn-1",
    };

    const { rerender, result } = renderHook(
      (props) => useThreadTimelineTurnSummaryDetails(props),
      {
        initialProps,
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(detailResponse);
      expect(requestUrls.length).toBe(1);
    });
    expect(requestUrls[0]?.searchParams.get("turnId")).toBe("turn-1");
    expect(requestUrls[0]?.searchParams.get("sourceSeqStart")).toBe("5");
    expect(requestUrls[0]?.searchParams.get("sourceSeqEnd")).toBe("10");
    expect(
      queryClient.getQueryData(
        threadTimelineTurnSummaryDetailsQueryKey(initialProps),
      ),
    ).toEqual(detailResponse);

    const nextRangeProps: TurnSummaryDetailsHookProps = {
      ...initialProps,
      sourceSeqEnd: 20,
    };
    rerender(nextRangeProps);
    await waitFor(() => {
      expect(requestUrls.length).toBe(2);
    });
    expect(requestUrls[1]?.searchParams.get("sourceSeqEnd")).toBe("20");
    expect(
      queryClient.getQueryData(
        threadTimelineTurnSummaryDetailsQueryKey(nextRangeProps),
      ),
    ).toEqual(detailResponse);
  });

  it("prefetches composer bootstrap from the thread detail bootstrap", async () => {
    const thread = makeThread();
    const environment = makeEnvironment();
    const host = makeHost();
    const composerBootstrap: ThreadComposerBootstrapResponse = {
      defaultExecutionOptions: {
        model: "gpt-5.5",
        permissionMode: "workspace-write",
        reasoningLevel: "medium",
        serviceTier: "default",
        source: "client/turn/requested",
      },
      executionOptions: {
        providers: [
          {
            id: "codex",
            displayName: "Codex",
            available: true,
            capabilities: {
              supportsArchive: true,
              supportsRename: true,
              supportsServiceTier: true,
              supportsUserQuestion: true,
              supportedPermissionModes: ["full", "workspace-write", "readonly"],
            },
          },
        ],
        models: [],
        selectedOnlyModels: [],
        modelLoadError: null,
      },
      pendingInteractions: [],
      promptHistory: [],
      queuedMessages: [],
    };
    let includeThreadRequestCount = 0;
    let composerBootstrapRequestCount = 0;
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thread-1",
        handler: () => {
          includeThreadRequestCount += 1;
          return jsonResponse({
            ...thread,
            environment,
            host,
          });
        },
      },
      {
        pathname: "/api/v1/threads/thread-1/composer-bootstrap",
        handler: () => {
          composerBootstrapRequestCount += 1;
          return jsonResponse(composerBootstrap);
        },
      },
    ]);
    const { queryClient, wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useThreadDetailBootstrap("thread-1", {
          composerBootstrapPrefetch: true,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.status).toBe("success");
      expect(composerBootstrapRequestCount).toBe(1);
    });
    expect(includeThreadRequestCount).toBe(1);
    expect(
      queryClient.getQueryData(
        threadComposerBootstrapQueryKey("thread-1", "environment-1"),
      ),
    ).toEqual(composerBootstrap);

    const composerResult = renderHook(
      () =>
        useThreadComposerBootstrap("thread-1", {
          environmentId: "environment-1",
          providerId: "provider-1",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(composerResult.result.current.data).toEqual(composerBootstrap);
    });
    expect(composerBootstrapRequestCount).toBe(1);
  });

  it("initializes composer caches from the thread composer bootstrap", async () => {
    const defaultExecutionOptions = {
      model: "gpt-5.5",
      permissionMode: "workspace-write",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };
    const queuedMessages = [
      {
        id: "qmsg-1",
        content: [{ type: "text", text: "queued message", mentions: [] }],
        createdAt: 1,
        model: "gpt-5.5",
        permissionMode: "workspace-write",
        reasoningLevel: "medium",
        serviceTier: "default",
        updatedAt: 1,
      },
    ];
    const promptHistory = [
      {
        id: "event-1",
        createdAt: 2,
        input: [{ type: "text", text: "accepted prompt", mentions: [] }],
      },
    ];
    const executionOptions = {
      providers: [
        {
          id: "codex",
          displayName: "Codex",
          available: true,
          capabilities: {
            supportsArchive: true,
            supportsRename: true,
            supportsServiceTier: true,
            supportedPermissionModes: ["full", "workspace-write", "readonly"],
          },
        },
        {
          id: "claude-code",
          displayName: "Claude Code",
          available: true,
          capabilities: {
            supportsArchive: true,
            supportsRename: true,
            supportsServiceTier: true,
            supportedPermissionModes: ["full", "workspace-write", "readonly"],
          },
        },
      ],
      models: [
        {
          id: "gpt-5.5",
          model: "gpt-5.5",
          displayName: "GPT-5.5",
          description: "Frontier model",
          supportedReasoningEfforts: [
            {
              reasoningEffort: "medium",
              description: "Balanced",
            },
          ],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
      selectedOnlyModels: [],
      modelLoadError: null,
    };
    let bootstrapRequestCount = 0;
    let fallbackRequestCount = 0;
    let executionOptionsHostlessRequestCount = 0;
    let executionOptionsScopedRequestCount = 0;
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thread-1/composer-bootstrap",
        handler: () => {
          bootstrapRequestCount += 1;
          return jsonResponse({
            defaultExecutionOptions,
            queuedMessages,
            executionOptions,
            pendingInteractions: [],
            promptHistory,
          });
        },
      },
      {
        pathname: "/api/v1/threads/thread-1/default-execution-options",
        handler: () => {
          fallbackRequestCount += 1;
          return jsonResponse(defaultExecutionOptions);
        },
      },
      {
        pathname: "/api/v1/threads/thread-1/queued-messages",
        handler: () => {
          fallbackRequestCount += 1;
          return jsonResponse(queuedMessages);
        },
      },
      {
        pathname: "/api/v1/threads/thread-1/prompt-history",
        handler: () => {
          fallbackRequestCount += 1;
          return jsonResponse(promptHistory);
        },
      },
      {
        pathname: "/api/v1/threads/thread-1/interactions",
        handler: () => {
          fallbackRequestCount += 1;
          return jsonResponse([]);
        },
      },
      {
        pathname: "/api/v1/system/execution-options",
        handler: (request) => {
          const environmentId = new URL(request.url).searchParams.get(
            "environmentId",
          );
          if (environmentId === "environment-1") {
            executionOptionsScopedRequestCount += 1;
          } else {
            executionOptionsHostlessRequestCount += 1;
          }
          return jsonResponse(executionOptions);
        },
      },
    ]);
    const { queryClient, wrapper } = createWrapper();

    const { result } = renderHook(
      () => {
        const bootstrap = useThreadComposerBootstrap("thread-1", {
          environmentId: "environment-1",
          providerId: "claude-code",
        });
        const canonicalEnabled =
          !bootstrap.isFetching && (bootstrap.isSuccess || bootstrap.isError);
        const canonicalThreadId = canonicalEnabled ? "thread-1" : "";
        const bootstrapInitialDataStaleTime = bootstrap.isSuccess
          ? 10_000
          : undefined;
        const defaultExecution = useThreadDefaultExecutionOptions(
          canonicalThreadId,
          {
            enabled: canonicalEnabled,
            staleTime: bootstrapInitialDataStaleTime,
          },
        );
        const queuedMessageList = useThreadQueuedMessages(canonicalThreadId, {
          enabled: canonicalEnabled,
          staleTime: bootstrapInitialDataStaleTime,
        });
        const history = useThreadPromptHistory(canonicalThreadId, {
          enabled: canonicalEnabled,
          staleTime: bootstrapInitialDataStaleTime,
        });
        const interactions = useThreadPendingInteractions(canonicalThreadId, {
          enabled: canonicalEnabled,
          staleTime: bootstrapInitialDataStaleTime,
        });
        const creationOptions = useThreadCreationOptions({
          enabled: canonicalEnabled,
          environmentId: "environment-1",
          initialModel: "gpt-5.5",
          initialProviderId: "claude-code",
          resetKey: "thread-1",
          scope: "component-local",
        });
        return {
          bootstrap,
          creationOptions,
          defaultExecution,
          queuedMessageList,
          history,
          interactions,
        };
      },
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.bootstrap.status).toBe("success");
      expect(result.current.defaultExecution.data?.model).toBe("gpt-5.5");
      expect(result.current.queuedMessageList.data).toEqual(queuedMessages);
      expect(result.current.creationOptions.selectedProviderId).toBe(
        "claude-code",
      );
      expect(result.current.creationOptions.modelOptions).toEqual([
        {
          label: "GPT-5.5",
          value: "gpt-5.5",
        },
      ]);
      expect(result.current.history.data).toEqual(promptHistory);
      expect(result.current.interactions.data).toEqual([]);
    });
    expect(
      queryClient.getQueryData(
        threadDefaultExecutionOptionsQueryKey("thread-1"),
      ),
    ).toEqual(defaultExecutionOptions);
    expect(
      queryClient.getQueryData(threadQueuedMessagesQueryKey("thread-1")),
    ).toEqual(queuedMessages);
    expect(
      queryClient.getQueryData(threadPromptHistoryQueryKey("thread-1")),
    ).toEqual(promptHistory);
    expect(
      queryClient.getQueryData(threadPendingInteractionsQueryKey("thread-1")),
    ).toEqual([]);
    expect(
      queryClient.getQueryData(
        systemExecutionOptionsQueryKey({
          environmentId: "environment-1",
          providerId: "claude-code",
        }),
      ),
    ).toEqual(executionOptions);
    expect(bootstrapRequestCount).toBe(1);
    expect(fallbackRequestCount).toBe(0);
    expect(executionOptionsHostlessRequestCount).toBe(0);
    expect(executionOptionsScopedRequestCount).toBe(0);

    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: systemExecutionOptionsQueryKey({
          environmentId: "environment-1",
          providerId: "claude-code",
        }),
      });
    });

    await waitFor(() => {
      expect(executionOptionsScopedRequestCount).toBe(1);
    });
    expect(executionOptionsHostlessRequestCount).toBe(0);
  });

  it("does not let cached composer bootstrap suppress canonical queue refetches", async () => {
    const staleQueuedMessages: ThreadComposerBootstrapResponse["queuedMessages"] =
      [
        {
          id: "qmsg-stale",
          content: [{ type: "text", text: "already sent", mentions: [] }],
          createdAt: 1,
          model: "gpt-5.5",
          permissionMode: "workspace-write",
          reasoningLevel: "medium",
          serviceTier: "default",
          updatedAt: 1,
        },
      ];
    const freshQueuedMessages: ThreadComposerBootstrapResponse["queuedMessages"] =
      [];
    let queuedMessagesRequestCount = 0;
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thread-1/queued-messages",
        handler: () => {
          queuedMessagesRequestCount += 1;
          return jsonResponse(freshQueuedMessages);
        },
      },
    ]);
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(
      threadComposerBootstrapQueryKey("thread-1", "environment-1"),
      {
        defaultExecutionOptions: null,
        queuedMessages: staleQueuedMessages,
        executionOptions: {
          providers: [],
          models: [],
          selectedOnlyModels: [],
          modelLoadError: null,
        },
        pendingInteractions: [],
        promptHistory: [],
      },
    );
    queryClient.setQueryData(
      threadQueuedMessagesQueryKey("thread-1"),
      staleQueuedMessages,
    );
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: threadQueuedMessagesQueryKey("thread-1"),
        refetchType: "none",
      });
    });

    const { result } = renderHook(
      () => {
        const bootstrap = useThreadComposerBootstrap("thread-1", {
          environmentId: "environment-1",
          providerId: "codex",
        });
        const canonicalEnabled =
          !bootstrap.isFetching && (bootstrap.isSuccess || bootstrap.isError);
        const queuedMessageList = useThreadQueuedMessages(
          canonicalEnabled ? "thread-1" : "",
          {
            enabled: canonicalEnabled,
            staleTime: bootstrap.isSuccess ? 10_000 : undefined,
          },
        );
        return { bootstrap, queuedMessageList };
      },
      { wrapper },
    );

    await waitFor(() => {
      expect(queuedMessagesRequestCount).toBe(1);
      expect(result.current.queuedMessageList.data).toEqual(
        freshQueuedMessages,
      );
    });
    expect(result.current.bootstrap.data?.queuedMessages).toEqual(
      staleQueuedMessages,
    );
    expect(
      queryClient.getQueryData(threadQueuedMessagesQueryKey("thread-1")),
    ).toEqual(freshQueuedMessages);
  });

  it("fetches provider-scoped execution options after switching providers from bootstrap data", async () => {
    const claudeExecutionOptions: ThreadComposerBootstrapResponse["executionOptions"] =
      {
        providers: [
          {
            id: "claude-code",
            displayName: "Claude Code",
            available: true,
            capabilities: {
              supportsArchive: true,
              supportsRename: true,
              supportsServiceTier: true,
              supportsUserQuestion: true,
              supportedPermissionModes: ["full", "workspace-write", "readonly"],
            },
          },
          {
            id: "codex",
            displayName: "Codex",
            available: true,
            capabilities: {
              supportsArchive: true,
              supportsRename: true,
              supportsServiceTier: true,
              supportsUserQuestion: true,
              supportedPermissionModes: ["full", "workspace-write", "readonly"],
            },
          },
        ],
        models: [
          {
            id: "claude-sonnet",
            model: "claude-sonnet",
            displayName: "Claude Sonnet",
            description: "Claude model",
            supportedReasoningEfforts: [
              {
                reasoningEffort: "medium",
                description: "Balanced",
              },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
        selectedOnlyModels: [],
        modelLoadError: null,
      };
    const codexExecutionOptions: ThreadComposerBootstrapResponse["executionOptions"] =
      {
        ...claudeExecutionOptions,
        models: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Codex model",
            supportedReasoningEfforts: [
              {
                reasoningEffort: "high",
                description: "High",
              },
            ],
            defaultReasoningEffort: "high",
            isDefault: true,
          },
        ],
      };
    let bootstrapRequestCount = 0;
    let codexExecutionOptionsRequestCount = 0;
    let claudeExecutionOptionsRequestCount = 0;
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thread-1/composer-bootstrap",
        handler: () => {
          bootstrapRequestCount += 1;
          return jsonResponse({
            defaultExecutionOptions: {
              model: "claude-sonnet",
              permissionMode: "workspace-write",
              reasoningLevel: "medium",
              serviceTier: "default",
              source: "client/turn/requested",
            },
            queuedMessages: [],
            executionOptions: claudeExecutionOptions,
            pendingInteractions: [],
            promptHistory: [],
          });
        },
      },
      {
        pathname: "/api/v1/system/execution-options",
        handler: (request) => {
          const providerId = new URL(request.url).searchParams.get(
            "providerId",
          );
          if (providerId === "codex") {
            codexExecutionOptionsRequestCount += 1;
            return jsonResponse(codexExecutionOptions);
          }
          if (providerId === "claude-code") {
            claudeExecutionOptionsRequestCount += 1;
            return jsonResponse(claudeExecutionOptions);
          }
          return jsonResponse(claudeExecutionOptions);
        },
      },
    ]);
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => {
        const bootstrap = useThreadComposerBootstrap("thread-1", {
          environmentId: "environment-1",
          providerId: "claude-code",
        });
        const creationOptions = useThreadCreationOptions({
          enabled: !bootstrap.isFetching && bootstrap.isSuccess,
          environmentId: "environment-1",
          initialModel: "claude-sonnet",
          initialProviderId: "claude-code",
          resetKey: "thread-1",
          scope: "component-local",
        });
        return {
          bootstrap,
          creationOptions,
        };
      },
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.bootstrap.status).toBe("success");
      expect(result.current.creationOptions.modelOptions).toEqual([
        {
          label: "Claude Sonnet",
          value: "claude-sonnet",
        },
      ]);
    });
    expect(bootstrapRequestCount).toBe(1);
    expect(claudeExecutionOptionsRequestCount).toBe(0);

    act(() => {
      result.current.creationOptions.setSelectedProviderId("codex");
    });

    await waitFor(() => {
      expect(codexExecutionOptionsRequestCount).toBe(1);
      expect(result.current.creationOptions.selectedProviderId).toBe("codex");
      expect(result.current.creationOptions.modelOptions).toEqual([
        {
          label: "GPT-5.5",
          value: "gpt-5.5",
        },
      ]);
    });
    expect(claudeExecutionOptionsRequestCount).toBe(0);
  });
});

describe("project thread subset query", () => {
  it("derives from the cached active project thread list without fetching a targeted list", async () => {
    const fetchMock = installFetchRoutes([]);
    const parent = makeThreadListEntry({
      id: "parent-1",
    });
    const child = makeThreadListEntry({
      id: "child-1",
      parentThreadId: "parent-1",
    });
    const otherChild = makeThreadListEntry({
      id: "child-2",
      parentThreadId: "parent-2",
    });
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData<ThreadListResponse>(
      threadListQueryKey({ archived: false, projectId: "project-1" }),
      [parent, child, otherChild],
    );

    const { result } = renderHook(
      () =>
        useProjectThreadSubset({
          filters: { parentThreadId: "parent-1" },
          projectId: "project-1",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([child]);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the targeted list when the active project thread list is not cached", async () => {
    const parent = makeThreadListEntry({
      id: "parent-1",
      parentThreadId: null,
    });
    const requestUrlRef: { current: URL | null } = { current: null };
    installFetchRoutes([
      {
        pathname: "/api/v1/threads",
        handler: (request) => {
          requestUrlRef.current = new URL(request.url);
          return jsonResponse([parent]);
        },
      },
    ]);
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useProjectThreadSubset({
          filters: { hasParent: false },
          projectId: "project-1",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([parent]);
    });
    expect(requestUrlRef.current?.searchParams.get("projectId")).toBe(
      "project-1",
    );
    expect(requestUrlRef.current?.searchParams.get("archived")).toBe("false");
    expect(requestUrlRef.current?.searchParams.get("hasParent")).toBe("false");
  });
});

describe("thread prompt history query", () => {
  it("passes AbortSignal through thread prompt history requests", async () => {
    const route = installAbortableJsonRoute({
      pathname: "/api/v1/threads/thread-1/prompt-history",
      body: [],
    });
    const { wrapper } = createWrapper();
    const { unmount } = renderHook(() => useThreadPromptHistory("thread-1"), {
      wrapper,
    });

    await waitFor(() => {
      expect(route.getSignal()).toBeInstanceOf(AbortSignal);
    });

    unmount();

    await waitFor(() => {
      expect(route.getSignal()?.aborted).toBe(true);
    });
  });
});

describe("thread host file preview query", () => {
  it("loads host file content lazily through the thread-scoped route", async () => {
    const hostPath = "/Users/me/notes/plan.md";
    // Use an object holder so TS doesn't narrow the outer variable away
    // (the assignment lives inside the fetch callback, which TS can't
    // follow back into the test body).
    const requestUrlRef: { current: URL | null } = { current: null };
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thread-1/host-files/content",
        handler: (request) => {
          requestUrlRef.current = new URL(request.url);
          return new Response("# Plan\n", {
            headers: { "content-type": "text/markdown" },
          });
        },
      },
    ]);
    const { queryClient, wrapper } = createWrapper();

    const { result } = renderHook(
      () => useThreadHostFilePreview("thread-1", "env-1", hostPath),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(requestUrlRef.current?.searchParams.get("path")).toBe(hostPath);
    expect(result.current.data).toMatchObject({
      kind: "text",
      path: hostPath,
      name: "plan.md",
      content: "# Plan\n",
    });
    expect(
      queryClient.getQueryData(
        threadHostFilePreviewQueryKey("thread-1", "env-1", hostPath),
      ),
    ).toEqual(result.current.data);
  });

  it("does not fetch host file content until enabled with a path", () => {
    const fetchMock = installFetchRoutes([
      {
        pathname: "/api/v1/threads/thread-1/host-files/content",
        handler: () => new Response("unused"),
      },
    ]);
    const { wrapper } = createWrapper();

    renderHook(
      () =>
        useThreadHostFilePreview("thread-1", "env-1", null, {
          enabled: true,
        }),
      { wrapper },
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch host file content without a thread environment", () => {
    const fetchMock = installFetchRoutes([
      {
        pathname: "/api/v1/threads/thread-1/host-files/content",
        handler: () => new Response("unused"),
      },
    ]);
    const { wrapper } = createWrapper();

    renderHook(
      () =>
        useThreadHostFilePreview("thread-1", null, "/Users/me/notes/plan.md", {
          enabled: true,
        }),
      { wrapper },
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
