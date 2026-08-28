// @vitest-environment jsdom

import type {
  PendingInteraction,
  ResolvedThreadExecutionOptions,
  ThreadQueuedMessage,
  ThreadTimelineActivePromptMode,
  ThreadTimelineGoal,
  ThreadTimelineModelFallback,
  ThreadWithRuntime,
} from "@bb/domain";
import {
  cleanup,
  fireEvent,
  act,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import { memo, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { workflowRow } from "@/test/fixtures/thread-timeline-rows";
import { THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY } from "@bb/client-core";
import { BbHttpError } from "@/lib/sdk";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { setComposerTextEffect } from "@/lib/composer-text-effects";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import type { ChildThreadPendingAttention } from "@/hooks/queries/child-thread-pending-interactions";
import {
  defaultThreadDetailPromptAreaDependencies,
  ThreadDetailPromptArea,
  type ThreadDetailPromptAreaDependencies,
  type ThreadDetailSentMessageEdit,
} from "./ThreadDetailPromptArea";

const mocks = vi.hoisted(() => ({
  cancelThreadPlanMutate: vi.fn(),
  clearThreadGoalMutate: vi.fn(),
  createQueuedMessageMutateAsync: vi.fn(),
  defaultExecutionOptions:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ null as ResolvedThreadExecutionOptions | null,
  deleteQueuedMessageMutateAsync: vi.fn(),
  pluginComposerHost:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ null as PluginComposerHost | null,
  promptDraft: {
    addAttachment: vi.fn(),
    addQuote: vi.fn(),
    attachments: [],
    clear: vi.fn(),
    clearIfCurrentMatches: vi.fn(),
    getCurrent: vi.fn(),
    mentions: [],
    removeAttachment: vi.fn(),
    restoreIfEmpty: vi.fn(),
    setAttachments: vi.fn(),
    setDraft: vi.fn(),
    setTextAndMentions: vi.fn(),
    storageKey: "bb.promptbox.contents-proj_1-thr_1-3",
    subscribe: vi.fn(() => () => {}),
    text: "",
    value: "",
  },
  queuedMessages:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ [] as ThreadQueuedMessage[],
  reorderQueuedMessageMutateAsync: vi.fn(),
  sendQueuedMessageMutateAsync: vi.fn(),
  setQueuedMessageGroupBoundaryMutateAsync: vi.fn(),
  stopThreadMutate: vi.fn(),
  toastError: vi.fn(),
  unarchiveThreadMutate: vi.fn(),
  uploadPromptAttachmentMutateAsync: vi.fn(),
  updateQueuedMessageMutateAsync: vi.fn(),
  useThreadDefaultExecutionOptions: vi.fn(),
  useThreadCreationOptions: vi.fn(),
  useThreadPromptHistory: vi.fn(),
  useThreadQueuedMessages: vi.fn(),
}));

const followUpPromptBoxModule =
  await import("@/components/promptbox/FollowUpPromptBox");
const pluginComposerBannersModule =
  await import("@/components/plugin/PluginComposerBanners");
const { ComposerBannersSlot } = pluginComposerBannersModule;
const FollowUpPromptBoxFixture = ({
  attachments,
  composer,
  execution,
  executionReadOnly,
  pendingInteraction,
  permission,
  permissionReadOnly,
  pluginComposerHost,
  showScrollToBottomButton,
  stack,
  suppressPluginComposerCustomizations,
  textEffects,
}: Parameters<typeof followUpPromptBoxModule.FollowUpPromptBox>[0]) => (
  <div data-testid="follow-up-prompt-box">
    {}
    <div data-testid="prompt-stack">
      {pluginComposerHost ? (
        <ComposerBannersSlot
          view={{
            scope: pluginComposerHost.scope,
            layout: "expanded",
            draft: { text: "", isEmpty: true, attachmentCount: 0 },
            run: { isRunning: false, isSubmitting: false },
          }}
        >
          {stack}
        </ComposerBannersSlot>
      ) : (
        stack
      )}
      {pendingInteraction}
    </div>
    <div data-testid="composer-boundary" />
    <div data-testid="composer-hidden">
      {pendingInteraction ? "true" : "false"}
    </div>
    <div data-testid="submit-mode">
      {composer?.submitMode.kind}:
      {composer?.submitMode.kind === "blocked"
        ? composer.submitMode.reason
        : ""}
    </div>
    <div data-testid="submit-title">{composer?.submitTitle ?? "Submit"}</div>
    <div data-testid="plugin-customizations-suppressed">
      {suppressPluginComposerCustomizations ? "true" : "false"}
    </div>
    <div data-testid="selected-model">{execution.model.active?.model}</div>
    <div data-testid="selected-reasoning">{execution.reasoning.value}</div>
    <div data-testid="selected-service-tier">
      {execution.serviceTier?.value}
    </div>
    <div data-testid="selected-permission">{permission.value}</div>
    <div data-testid="execution-read-only">
      {executionReadOnly ? "true" : "false"}
    </div>
    <div data-testid="permission-read-only">
      {permissionReadOnly ? "true" : "false"}
    </div>
    <div data-testid="attachment-count">{attachments.items?.length ?? 0}</div>
    <div data-testid="composer-text-effect">
      {textEffects && textEffects.length > 0
        ? textEffects.map(({ effect }) => effect.className).join(",")
        : "none"}
    </div>
    <div data-testid="composer-location">
      {showScrollToBottomButton === false ? "inline" : "bottom"}
    </div>
    <div data-testid="plugin-composer-scope">
      {pluginComposerHost
        ? `${pluginComposerHost.scope.kind}:${
            pluginComposerHost.scope.kind === "queued-message"
              ? pluginComposerHost.scope.queuedMessageId
              : pluginComposerHost.scope.kind === "thread"
                ? pluginComposerHost.scope.threadId
                : (pluginComposerHost.scope.projectId ?? "null")
          }`
        : "route"}
    </div>
    {pluginComposerHost ? (
      <>
        <button
          type="button"
          onClick={() =>
            pluginComposerHost.setDraft({
              ...pluginComposerHost.getCurrent(),
              text: "Plugin-enhanced queued message",
            })
          }
        >
          Simulate plugin replacement
        </button>
        <button
          type="button"
          onClick={() => {
            pluginComposerHost.setDraft({
              ...pluginComposerHost.getCurrent(),
              text: "First plugin update",
            });
            const current = pluginComposerHost.getCurrent();
            pluginComposerHost.setDraft({
              ...current,
              text: `${current.text} + second plugin update`,
            });
          }}
        >
          Simulate chained plugin updates
        </button>
        <button
          type="button"
          onClick={() => {
            mocks.pluginComposerHost = pluginComposerHost;
          }}
        >
          Capture plugin host
        </button>
      </>
    ) : null}
    {composer ? (
      <>
        <input
          aria-label="Composer message"
          value={composer.message}
          onChange={(event) =>
            composer.onChangeMessage(event.currentTarget.value, [])
          }
        />
        <button type="button" onClick={composer.onSubmit}>
          Submit composer
        </button>
        {composer.onEscape ? (
          <button type="button" onClick={composer.onEscape}>
            Escape composer
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (!attachments.onAttachFiles) return;
            void attachments.onAttachFiles([
              new File(["queued"], "queued.txt", { type: "text/plain" }),
            ]);
          }}
        >
          Attach file
        </button>
      </>
    ) : null}
    {execution.footerAction ? (
      <button type="button" onClick={execution.footerAction.onClick}>
        {execution.footerAction.label}
      </button>
    ) : null}
  </div>
);

const threadEnvironmentSummaryModule =
  await import("@/components/promptbox/ThreadEnvironmentSummary");
const ThreadEnvironmentSummaryFixture = memo(
  (
    _: Parameters<
      typeof threadEnvironmentSummaryModule.ThreadEnvironmentSummary
    >[0],
  ) => <div />,
);

const queuedMessagesListModule =
  await import("@/components/promptbox/banner/QueuedMessagesList");
vi.spyOn(queuedMessagesListModule, "QueuedMessagesList").mockImplementation(
  ({
    inlineEditor,
    queuedMessages,
    onEdit,
  }: {
    inlineEditor?: { content: ReactNode; onDismiss: () => void };
    queuedMessages: readonly ThreadQueuedMessage[];
    onEdit: (request: {
      queuedMessageId: string;
      queuedMessageIndex: number;
    }) => void;
  }) => (
    <div data-testid="queued-message-list">
      <div data-testid="queued-message-count">{queuedMessages.length}</div>
      {queuedMessages.map((message, index) => (
        <button
          key={message.id}
          type="button"
          onClick={() =>
            onEdit({
              queuedMessageId: message.id,
              queuedMessageIndex: index,
            })
          }
        >
          Edit queued message {index + 1}
        </button>
      ))}
      {inlineEditor ? (
        <div data-testid="inline-queued-message-editor">
          {inlineEditor.content}
          <button type="button" onClick={inlineEditor.onDismiss}>
            Cancel queued edit
          </button>
        </div>
      ) : null}
    </div>
  ),
);

const threadBackgroundCommandsCardModule =
  await import("@/components/promptbox/banner/ThreadBackgroundCommandsCard");
vi.spyOn(
  threadBackgroundCommandsCardModule,
  "ThreadBackgroundCommandsCard",
).mockImplementation(() => null);

const threadGoalCardModule =
  await import("@/components/promptbox/banner/ThreadGoalCard");
vi.spyOn(threadGoalCardModule, "ThreadGoalCard").mockImplementation(
  ({
    goal,
    onClearGoal,
  }: {
    goal: ThreadTimelineGoal | null;
    onClearGoal?: () => void;
  }) =>
    goal ? (
      <div data-testid="composer-stack-item">
        Goal banner
        {onClearGoal ? (
          <button
            type="button"
            aria-label="Clear active Goal"
            onClick={onClearGoal}
          />
        ) : null}
      </div>
    ) : null,
);

const threadPromptContextBannerModule =
  await import("@/components/promptbox/banner/ThreadPromptContextBanner");
vi.spyOn(
  threadPromptContextBannerModule,
  "ThreadPromptContextBanner",
).mockImplementation(() => null);

const threadPromptModeCardModule =
  await import("@/components/promptbox/banner/ThreadPromptModeCard");
vi.spyOn(threadPromptModeCardModule, "ThreadPromptModeCard").mockImplementation(
  ({
    activePromptMode,
    onExitPlanMode,
  }: {
    activePromptMode: ThreadTimelineActivePromptMode | null;
    onExitPlanMode?: () => void;
  }) =>
    activePromptMode ? (
      <div data-testid="composer-stack-item">
        Plan banner
        {onExitPlanMode ? (
          <button
            type="button"
            aria-label="Exit plan mode"
            onClick={onExitPlanMode}
          />
        ) : null}
      </div>
    ) : null,
);

const threadTodoCardModule =
  await import("@/components/promptbox/banner/ThreadTodoCard");
vi.spyOn(threadTodoCardModule, "ThreadTodoCard").mockImplementation(() => null);

const threadWorkflowCardModule =
  await import("@/components/promptbox/banner/ThreadWorkflowCard");
vi.spyOn(threadWorkflowCardModule, "ThreadWorkflowCard").mockImplementation(
  ({
    workflow,
    isExpanded,
    onToggle,
  }: {
    workflow: TimelineWorkflowWorkRow;
    isExpanded: boolean;
    onToggle: () => void;
  }) => (
    <button
      type="button"
      data-testid="workflow-card"
      data-expanded={isExpanded}
      onClick={onToggle}
    >
      {workflow.workflowName}
    </button>
  ),
);

const threadPendingInteractionBannerModule =
  await import("@/components/thread/pending-interactions/ThreadPendingInteractionBanner");
vi.spyOn(
  threadPendingInteractionBannerModule,
  "ThreadPendingInteractionBanner",
).mockImplementation(() => (
  <div data-testid="composer-stack-item">Pending interaction</div>
));

const pluginPendingInteractionComposerModule =
  await import("@/components/plugin/PluginPendingInteractionComposer");
vi.spyOn(
  pluginPendingInteractionComposerModule,
  "PluginPendingInteractionComposer",
).mockImplementation(() => (
  <div data-testid="composer-stack-item">Plugin pending interaction</div>
));

const appToastModule = await import("@/components/ui/app-toast");
vi.spyOn(appToastModule.appToast, "error").mockImplementation(mocks.toastError);

const commandSuggestionsModule = await import("@/hooks/useCommandSuggestions");
vi.spyOn(commandSuggestionsModule, "useCommandSuggestions").mockImplementation(
  () => ({
    hasMore: false,
    isError: false,
    isLoading: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
    suggestions: [],
    trigger: null,
  }),
);

const promptDraftStorageModule = await import("@/hooks/usePromptDraftStorage");
vi.spyOn(promptDraftStorageModule, "usePromptDraftStorage").mockImplementation(
  () => mocks.promptDraft,
);

const promptMentionsModule = await import("@/hooks/usePromptMentions");
vi.spyOn(promptMentionsModule, "usePromptMentions").mockImplementation(() => ({
  query: null,
  triggers: [],
  isError: false,
  isLoading: false,
  setQuery: vi.fn(),
  suggestions: [],
}));

const threadCreationOptionsModule =
  await import("@/hooks/useThreadCreationOptions");
type ThreadCreationOptionsInput = Parameters<
  typeof threadCreationOptionsModule.useThreadCreationOptions
>[0];
vi.spyOn(
  threadCreationOptionsModule,
  "useThreadCreationOptions",
).mockImplementation((options: ThreadCreationOptionsInput) => {
  mocks.useThreadCreationOptions(options);
  return {
    clearReuseEnvironment: vi.fn(),
    environmentSelectionValue: "",
    executionOptionsRouting: {},
    activeModel: undefined,
    executionInputSources: {},
    hasMultipleProviders: false,
    isLoadingModels: false,
    modelLoadError: null,
    modelLoadFailed: false,
    modelCatalogIsVerified: false,
    modelOptions: [],
    moreModelOptions: [],
    permissionMode: "auto",
    permissionModeOptions: [],
    permissionModeIsVerified: false,
    providerOptions: [],
    reasoningLevel: "medium",
    reasoningOptions: [],
    selectedModel: "gpt-5",
    selectedProviderComposerActions: [],
    selectedProviderDisplayName: "Codex",
    selectedProviderId: "codex",
    serviceTierFastLabel: "Fast",
    serviceTier: undefined,
    serviceTierSupportByProvider: {},
    setPermissionMode: vi.fn(),
    setSelectedProviderId: vi.fn(),
    setProviderModelReasoning: vi.fn(),
    setReasoningLevel: vi.fn(),
    setSelectedModel: vi.fn(),
    setServiceTier: vi.fn(),
    setEnvironmentSelectionValue: vi.fn(),
    supportsPermissionModeSelection: true,
    supportsServiceTier: false,
  };
});

const projectMutationsModule =
  await import("@/hooks/mutations/project-mutations");
vi.spyOn(
  projectMutationsModule,
  "useUploadPromptAttachment",
).mockImplementation(() => ({
  context: undefined,
  data: undefined,
  error: null,
  failureCount: 0,
  failureReason: null,
  isError: false,
  isIdle: true,
  isPending: false,
  isPaused: false,
  isSuccess: false,
  mutate: vi.fn(),
  mutateAsync: mocks.uploadPromptAttachmentMutateAsync,
  reset: vi.fn(),
  status: "idle",
  submittedAt: 0,
  variables: undefined,
}));

const threadRuntimeMutationsModule =
  await import("@/hooks/mutations/thread-runtime-mutations");
vi.spyOn(
  threadRuntimeMutationsModule,
  "useCancelThreadPlan",
).mockImplementation(() => ({
  context: undefined,
  data: undefined,
  error: null,
  failureCount: 0,
  failureReason: null,
  isError: false,
  isIdle: true,
  isPending: false,
  isPaused: false,
  isSuccess: false,
  mutate: mocks.cancelThreadPlanMutate,
  mutateAsync: vi.fn(),
  reset: vi.fn(),
  status: "idle",
  submittedAt: 0,
  variables: undefined,
}));
vi.spyOn(threadRuntimeMutationsModule, "useClearThreadGoal").mockImplementation(
  () => ({
    context: undefined,
    data: undefined,
    error: null,
    failureCount: 0,
    failureReason: null,
    isError: false,
    isIdle: true,
    isPending: false,
    isPaused: false,
    isSuccess: false,
    mutate: mocks.clearThreadGoalMutate,
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    status: "idle",
    submittedAt: 0,
    variables: undefined,
  }),
);
vi.spyOn(
  threadRuntimeMutationsModule,
  "useCreateThreadQueuedMessage",
).mockImplementation(() => ({
  context: undefined,
  data: undefined,
  error: null,
  failureCount: 0,
  failureReason: null,
  isError: false,
  isIdle: true,
  isPending: false,
  isPaused: false,
  isSuccess: false,
  mutate: vi.fn(),
  mutateAsync: mocks.createQueuedMessageMutateAsync,
  reset: vi.fn(),
  status: "idle",
  submittedAt: 0,
  variables: undefined,
}));
vi.spyOn(
  threadRuntimeMutationsModule,
  "useDeleteThreadQueuedMessage",
).mockImplementation(() => ({
  context: undefined,
  data: undefined,
  error: null,
  failureCount: 0,
  failureReason: null,
  isError: false,
  isIdle: true,
  isPending: false,
  isPaused: false,
  isSuccess: false,
  mutate: vi.fn(),
  mutateAsync: mocks.deleteQueuedMessageMutateAsync,
  reset: vi.fn(),
  status: "idle",
  submittedAt: 0,
  variables: undefined,
}));
vi.spyOn(
  threadRuntimeMutationsModule,
  "useReorderThreadQueuedMessage",
).mockImplementation(() => ({
  context: undefined,
  data: undefined,
  error: null,
  failureCount: 0,
  failureReason: null,
  isError: false,
  isIdle: true,
  isPending: false,
  isPaused: false,
  isSuccess: false,
  mutate: vi.fn(),
  mutateAsync: mocks.reorderQueuedMessageMutateAsync,
  reset: vi.fn(),
  status: "idle",
  submittedAt: 0,
  variables: undefined,
}));
vi.spyOn(
  threadRuntimeMutationsModule,
  "useSetThreadQueuedMessageGroupBoundary",
).mockImplementation(() => ({
  context: undefined,
  data: undefined,
  error: null,
  failureCount: 0,
  failureReason: null,
  isError: false,
  isIdle: true,
  isPending: false,
  isPaused: false,
  isSuccess: false,
  mutate: vi.fn(),
  mutateAsync: mocks.setQueuedMessageGroupBoundaryMutateAsync,
  reset: vi.fn(),
  status: "idle",
  submittedAt: 0,
  variables: undefined,
}));
vi.spyOn(
  threadRuntimeMutationsModule,
  "useSendThreadQueuedMessage",
).mockImplementation(() => ({
  context: undefined,
  data: undefined,
  error: null,
  failureCount: 0,
  failureReason: null,
  isError: false,
  isIdle: true,
  isPending: false,
  isPaused: false,
  isSuccess: false,
  mutate: vi.fn(),
  mutateAsync: mocks.sendQueuedMessageMutateAsync,
  reset: vi.fn(),
  status: "idle",
  submittedAt: 0,
  variables: undefined,
}));
vi.spyOn(threadRuntimeMutationsModule, "useStopThread").mockImplementation(
  () => ({
    context: undefined,
    data: undefined,
    error: null,
    failureCount: 0,
    failureReason: null,
    isError: false,
    isIdle: true,
    isPending: false,
    isPaused: false,
    isSuccess: false,
    mutate: mocks.stopThreadMutate,
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    status: "idle",
    submittedAt: 0,
    variables: undefined,
  }),
);
vi.spyOn(
  threadRuntimeMutationsModule,
  "useUpdateThreadQueuedMessage",
).mockImplementation(() => ({
  context: undefined,
  data: undefined,
  error: null,
  failureCount: 0,
  failureReason: null,
  isError: false,
  isIdle: true,
  isPending: false,
  isPaused: false,
  isSuccess: false,
  mutate: vi.fn(),
  mutateAsync: mocks.updateQueuedMessageMutateAsync,
  reset: vi.fn(),
  status: "idle",
  submittedAt: 0,
  variables: undefined,
}));

const threadStateMutationsModule =
  await import("@/hooks/mutations/thread-state-mutations");
vi.spyOn(threadStateMutationsModule, "useUnarchiveThread").mockImplementation(
  () => ({
    context: undefined,
    data: undefined,
    error: null,
    failureCount: 0,
    failureReason: null,
    isError: false,
    isIdle: true,
    isPending: false,
    mutate: mocks.unarchiveThreadMutate,
    mutateAsync: vi.fn(),
    isPaused: false,
    isSuccess: false,
    reset: vi.fn(),
    status: "idle",
    submittedAt: 0,
    variables: undefined,
  }),
);

const sidebarNavigationQueryModule =
  await import("@/hooks/queries/sidebar-navigation-query");
vi.spyOn(
  sidebarNavigationQueryModule,
  "useProjectDisplayName",
).mockImplementation(() => undefined);

function makeQueryResult<T>(data: T) {
  return {
    data,
    dataUpdatedAt: 0,
    error: null,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    errorUpdateCount: 0,
    isFetching: false,
    isPaused: false,
    isStale: false,
    isEnabled: true,
    refetch: vi.fn(),
    fetchStatus: "idle",
    promise: Promise.resolve(data),
    isError: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isLoading: false,
    isLoadingError: false,
    isInitialLoading: false,
    isPending: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isSuccess: true,
    status: "success",
  } as const;
}

const threadDefaultExecutionOptionsModule =
  await import("@/hooks/queries/thread-default-execution-options-query");
type ThreadDefaultExecutionOptions = Parameters<
  typeof threadDefaultExecutionOptionsModule.useThreadDefaultExecutionOptions
>[1];
vi.spyOn(
  threadDefaultExecutionOptionsModule,
  "useThreadDefaultExecutionOptions",
).mockImplementation(
  (threadId: string, options: ThreadDefaultExecutionOptions) => {
    mocks.useThreadDefaultExecutionOptions(threadId, options);
    return makeQueryResult(mocks.defaultExecutionOptions);
  },
);

const threadQueriesModule = await import("@/hooks/queries/thread-queries");
type ThreadPromptHistoryOptions = Parameters<
  typeof threadQueriesModule.useThreadPromptHistory
>[1];
type ThreadQueuedMessagesOptions = Parameters<
  typeof threadQueriesModule.useThreadQueuedMessages
>[1];
vi.spyOn(threadQueriesModule, "useThreadPromptHistory").mockImplementation(
  (threadId: string, options: ThreadPromptHistoryOptions) => {
    mocks.useThreadPromptHistory(threadId, options);
    return makeQueryResult([]);
  },
);
vi.spyOn(threadQueriesModule, "useThreadQueuedMessages").mockImplementation(
  (threadId: string, options: ThreadQueuedMessagesOptions) => {
    mocks.useThreadQueuedMessages(threadId, options);
    return makeQueryResult(mocks.queuedMessages);
  },
);

const threadDetailPromptAreaDependencies: ThreadDetailPromptAreaDependencies = {
  ...defaultThreadDetailPromptAreaDependencies,
  FollowUpPromptBox:
    /* SAFETY: The test fixture implements the FollowUpPromptBox props used by ThreadDetailPromptArea. */ FollowUpPromptBoxFixture as typeof followUpPromptBoxModule.FollowUpPromptBox,
  ThreadEnvironmentSummary: ThreadEnvironmentSummaryFixture,
  QueuedMessagesList: queuedMessagesListModule.QueuedMessagesList,
  ThreadBackgroundCommandsCard:
    threadBackgroundCommandsCardModule.ThreadBackgroundCommandsCard,
  ThreadGoalCard: threadGoalCardModule.ThreadGoalCard,
  ThreadPromptContextBanner:
    threadPromptContextBannerModule.ThreadPromptContextBanner,
  ThreadPromptModeCard: threadPromptModeCardModule.ThreadPromptModeCard,
  ThreadTodoCard: threadTodoCardModule.ThreadTodoCard,
  ThreadWorkflowCard: threadWorkflowCardModule.ThreadWorkflowCard,
  ThreadPendingInteractionBanner:
    threadPendingInteractionBannerModule.ThreadPendingInteractionBanner,
  appToast: appToastModule.appToast,
  useThreadCreationOptions:
    threadCreationOptionsModule.useThreadCreationOptions,
  useCancelThreadPlan: threadRuntimeMutationsModule.useCancelThreadPlan,
  useClearThreadGoal: threadRuntimeMutationsModule.useClearThreadGoal,
  useCreateThreadQueuedMessage:
    threadRuntimeMutationsModule.useCreateThreadQueuedMessage,
  useStopThread: threadRuntimeMutationsModule.useStopThread,
  useUnarchiveThread: threadStateMutationsModule.useUnarchiveThread,
  useProjectDisplayName: sidebarNavigationQueryModule.useProjectDisplayName,
  useThreadDefaultExecutionOptions:
    threadDefaultExecutionOptionsModule.useThreadDefaultExecutionOptions,
  useThreadQueuedMessages: threadQueriesModule.useThreadQueuedMessages,
  useThreadPromptHistory: threadQueriesModule.useThreadPromptHistory,
};

function makeQueuedMessage(
  overrides: Partial<ThreadQueuedMessage> = {},
): ThreadQueuedMessage {
  return {
    id: "qmsg_1",
    content: [{ type: "text", text: "Already queued", mentions: [] }],
    model: "gpt-5",
    reasoningLevel: "medium",
    permissionMode: "auto",
    serviceTier: "default",
    groupWithNext: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeThread(
  overrides: Partial<ThreadWithRuntime> = {},
): ThreadWithRuntime {
  return /* SAFETY: The test controls this fixture and verifies its behavior. */ {
    archivedAt: null,
    environmentId: null,
    id: "thr_1",
    projectId: "proj_1",
    providerId: "codex",
    runtime: { displayStatus: "idle" },
    status: "idle",
    ...overrides,
  } as ThreadWithRuntime;
}

const activePlan = {
  mode: "plan",
  providerId: "codex",
  prompt: "Plan the work",
} satisfies ThreadTimelineActivePromptMode;

const activeGoal = {
  sourceSeq: 1,
  updatedAt: 100,
  objective: "Finish the work",
  status: "active",
  tokenBudget: null,
  tokensUsed: 100,
  timeUsedSeconds: 10,
} satisfies ThreadTimelineGoal;

function makePendingInteraction(): PendingInteraction {
  return {
    id: "interaction-1",
    threadId: "thr_1",
    turnId: "turn-1",
    providerId: "codex",
    providerThreadId: "provider-thread-1",
    providerRequestId: "provider-request-1",
    origin: {
      kind: "provider",
      providerId: "codex",
      providerThreadId: "provider-thread-1",
      providerRequestId: "provider-request-1",
    },
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "question-1",
          prompt: "Continue?",
          multiSelect: false,
          allowFreeText: true,
        },
      ],
    },
    resolution: null,
    status: "pending",
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
  };
}

function makePluginPendingInteraction(): PendingInteraction {
  return {
    id: "plugin-interaction-1",
    threadId: "thr_1",
    turnId: null,
    origin: {
      kind: "plugin",
      pluginId: "example-plugin",
      rendererId: "example-form",
    },
    payload: {
      kind: "plugin",
      title: "Plugin input",
      data: null,
    },
    resolution: null,
    status: "pending",
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
  };
}

interface RenderPromptAreaOptions {
  activePromptMode?: ThreadTimelineActivePromptMode | null;
  activeWorkflows?: TimelineWorkflowWorkRow[];
  goal?: ThreadTimelineGoal | null;
  modelFallback?: ThreadTimelineModelFallback | null;
  pendingInteractions?: readonly PendingInteraction[];
  childPendingInteractions?: readonly ChildThreadPendingAttention[];
  pendingInteractionsInitialLoading?: boolean;
  sentMessageEdit?: ThreadDetailSentMessageEdit;
  thread?: ThreadWithRuntime;
}

function buildPromptAreaElement({
  activePromptMode = null,
  activeWorkflows = [],
  goal = null,
  modelFallback = null,
  pendingInteractions = [],
  childPendingInteractions = [],
  pendingInteractionsInitialLoading = false,
  sentMessageEdit,
  thread = makeThread(),
}: RenderPromptAreaOptions = {}) {
  return (
    <MemoryRouter>
      <ThreadDetailPromptArea
        activeBackgroundAgentCount={0}
        activeBackgroundCommands={[]}
        activePromptMode={activePromptMode}
        activeWorkflows={activeWorkflows}
        canUseGitUi={false}
        childPendingInteractions={childPendingInteractions}
        childThreadsSection={null}
        composerFocusRequestNonce={0}
        contextBannerMergeBase={null}
        environmentGoneStatus={null}
        goal={goal}
        modelFallback={modelFallback}
        isEnvironmentActionPending={false}
        onChangedFileClick={vi.fn()}
        parentThreadSection={null}
        pendingInteractions={pendingInteractions}
        pendingInteractionsInitialLoading={pendingInteractionsInitialLoading}
        pendingTodos={null}
        projectId="proj_1"
        pullRequest={null}
        pullRequestMergeMethod="squash"
        resolveMentionLink={() => null}
        sendMessage={{
          isPending: false,
          mutateAsync: vi.fn(),
        }}
        sentMessageEdit={sentMessageEdit}
        steerActiveThreadOnEnter={false}
        thread={thread}
        workspaceChangedFilesSection={null}
        workspaceStatusPending={false}
        dependencies={threadDetailPromptAreaDependencies}
      />
      <NavigationCapture />
    </MemoryRouter>
  );
}

function NavigationCapture() {
  const location = useLocation();
  return (
    <output data-testid="navigation-capture">
      {JSON.stringify({ pathname: location.pathname, state: location.state })}
    </output>
  );
}

function renderPromptArea(options: RenderPromptAreaOptions = {}) {
  return render(buildPromptAreaElement(options));
}

beforeEach(() => {
  mocks.defaultExecutionOptions = null;
  mocks.pluginComposerHost = null;
  mocks.promptDraft.text = "";
  mocks.promptDraft.getCurrent.mockImplementation(() => ({
    attachments: mocks.promptDraft.attachments,
    mentions: mocks.promptDraft.mentions,
    text: mocks.promptDraft.text,
  }));
  mocks.queuedMessages = [];
  mocks.updateQueuedMessageMutateAsync.mockResolvedValue(undefined);
  mocks.useThreadCreationOptions.mockClear();
  mocks.useThreadDefaultExecutionOptions.mockClear();
  mocks.useThreadPromptHistory.mockClear();
  mocks.useThreadQueuedMessages.mockClear();
});

afterEach(() => {
  cleanup();
  document
    .querySelectorAll("[data-sent-message-editor-test-host]")
    .forEach((element) => element.remove());
  resetPluginSlotStoreForTest();
  vi.clearAllMocks();
});

describe("ThreadDetailPromptArea", () => {
  it("keeps sent-message edit submission out of the normal send path", () => {
    mocks.defaultExecutionOptions = {
      model: "gpt-5",
      permissionMode: "auto",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };
    mocks.promptDraft.text = "Untouched follow-up draft";
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const updateDraft = vi.fn();
    const hostElement = document.createElement("div");
    hostElement.dataset.sentMessageEditorTestHost = "";
    document.body.append(hostElement);

    renderPromptArea({
      sentMessageEdit: {
        draft: {
          text: "Edited request",
          mentions: [],
          attachments: [],
        },
        hostElement,
        isSubmitting: false,
        operationId: "edit-operation-1",
        onCancel,
        onSubmit,
        updateDraft,
      },
    });

    const inlineEditor = within(hostElement);
    const editingLabel = inlineEditor.getByText("Editing message");
    const editingFrame = editingLabel.closest(
      '[data-inline-message-editor-frame="cap"]',
    );
    expect(editingFrame).not.toBeNull();
    expect(inlineEditor.getByTestId("submit-title").textContent).toBe(
      "Submit edit (Enter)",
    );
    expect(
      inlineEditor.getByTestId("plugin-customizations-suppressed").textContent,
    ).toBe("true");
    expect(
      /* SAFETY: The test controls this fixture and verifies its behavior. */ (
        inlineEditor.getByRole("textbox", {
          name: "Composer message",
        }) as HTMLInputElement
      ).value,
    ).toBe("Edited request");
    const bottomComposer = screen
      .getAllByTestId("follow-up-prompt-box")
      .find((element) => !hostElement.contains(element));
    expect(bottomComposer).toBeDefined();
    expect(
      /* SAFETY: The test controls this fixture and verifies its behavior. */ (
        within(bottomComposer!).getByRole("textbox", {
          name: "Composer message",
        }) as HTMLInputElement
      ).value,
    ).toBe("Untouched follow-up draft");
    fireEvent.click(
      inlineEditor.getByRole("button", {
        name: "Simulate plugin replacement",
      }),
    );
    expect(updateDraft).toHaveBeenCalledTimes(1);
    expect(mocks.promptDraft.setDraft).not.toHaveBeenCalled();

    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Submit composer" }),
    );

    expect(onSubmit).toHaveBeenCalledWith({
      execution: {
        model: "gpt-5",
        permissionMode: "auto",
        reasoningLevel: "medium",
        serviceTier: undefined,
        supportsServiceTier: false,
        executionInputSources: {},
      },
      input: [{ type: "text", text: "Edited request", mentions: [] }],
    });
    expect(mocks.promptDraft.clearIfCurrentMatches).not.toHaveBeenCalled();
    expect(mocks.createQueuedMessageMutateAsync).not.toHaveBeenCalled();

    fireEvent.click(
      inlineEditor.getByRole("button", {
        name: "Stop editing sent message",
      }),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);

    expect(
      within(bottomComposer!).queryByRole("button", {
        name: "Escape composer",
      }),
    ).toBeNull();
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Escape composer" }),
    );
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("blocks a staged sent-message edit when the thread becomes ineligible", () => {
    mocks.defaultExecutionOptions = {
      model: "gpt-5",
      permissionMode: "auto",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };
    mocks.queuedMessages = [makeQueuedMessage()];
    const hostElement = document.createElement("div");
    hostElement.dataset.sentMessageEditorTestHost = "";
    document.body.append(hostElement);
    const onSubmit = vi.fn();

    renderPromptArea({
      sentMessageEdit: {
        draft: { text: "Edited request", mentions: [], attachments: [] },
        hostElement,
        isSubmitting: false,
        operationId: "edit-operation-1",
        onCancel: vi.fn(),
        onSubmit,
        updateDraft: vi.fn(),
      },
    });

    const inlineEditor = within(hostElement);
    expect(inlineEditor.getByTestId("submit-mode").textContent).toBe(
      "blocked:unavailable",
    );
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Submit composer" }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the queued drawer adjacent to the bottom composer", () => {
    mocks.queuedMessages = [makeQueuedMessage()];

    renderPromptArea();

    const stack = screen.getByTestId("prompt-stack");
    const queue = screen.getByTestId("queued-message-list");
    const composer = screen.getByTestId("composer-boundary");
    expect(stack.lastElementChild).toBe(queue);
    expect(stack.nextElementSibling).toBe(composer);
  });

  it("uses the real thread cache keys immediately", () => {
    mocks.queuedMessages = [makeQueuedMessage()];

    renderPromptArea();

    expect(mocks.useThreadDefaultExecutionOptions).toHaveBeenCalledWith(
      "thr_1",
      expect.objectContaining({ enabled: true }),
    );
    expect(mocks.useThreadPromptHistory).toHaveBeenCalledWith(
      "thr_1",
      expect.objectContaining({ enabled: true }),
    );
    expect(mocks.useThreadQueuedMessages).toHaveBeenCalledWith(
      "thr_1",
      expect.objectContaining({ enabled: true }),
    );
    expect(mocks.useThreadCreationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        environmentId: undefined,
        scope: "component-local",
      }),
    );
    expect(screen.getByTestId("queued-message-count").textContent).toBe("1");
  });

  it("binds the normal plugin composer host to the rendered pane thread", () => {
    renderPromptArea({ thread: makeThread({ id: "thr_nonfocused" }) });

    expect(screen.getByTestId("plugin-composer-scope").textContent).toBe(
      "thread:thr_nonfocused",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate plugin replacement" }),
    );
    expect(mocks.promptDraft.setDraft).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Plugin-enhanced queued message" }),
    );
  });

  it("updates an inline-edited queue item without touching the bottom draft", async () => {
    mocks.defaultExecutionOptions = {
      model: "gpt-5",
      permissionMode: "auto",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };
    mocks.promptDraft.text = "Keep this bottom draft";
    mocks.queuedMessages = [makeQueuedMessage()];

    renderPromptArea();
    expect(screen.getByTestId("composer-location").textContent).toBe("bottom");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );

    const inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );
    expect(screen.getByTestId("queued-message-count").textContent).toBe("1");
    expect(
      /* SAFETY: The test controls this fixture and verifies its behavior. */ (
        inlineEditor.getByRole("textbox", {
          name: "Composer message",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Already queued");
    const bottomComposer =
      /* SAFETY: The test controls this fixture and verifies its behavior. */ screen
        .getAllByRole("textbox", { name: "Composer message" })
        .find(
          (element) =>
            element.closest('[data-testid="inline-queued-message-editor"]') ===
            null,
        ) as HTMLInputElement;
    expect(bottomComposer.value).toBe("Keep this bottom draft");
    fireEvent.change(bottomComposer, {
      target: { value: "Still-usable bottom draft" },
    });
    expect(mocks.promptDraft.setTextAndMentions).toHaveBeenCalledWith(
      "Still-usable bottom draft",
      [],
    );
    fireEvent.change(
      inlineEditor.getByRole("textbox", { name: "Composer message" }),
      { target: { value: "Edited queued message" } },
    );
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Submit composer" }),
    );

    await waitFor(() => {
      expect(mocks.updateQueuedMessageMutateAsync).toHaveBeenCalledWith({
        expectedUpdatedAt: 1,
        id: "thr_1",
        input: [{ type: "text", text: "Edited queued message", mentions: [] }],
        queuedMessageId: "qmsg_1",
      });
    });
    expect(mocks.deleteQueuedMessageMutateAsync).not.toHaveBeenCalled();
    expect(mocks.promptDraft.setDraft).not.toHaveBeenCalled();
    expect(mocks.promptDraft.text).toBe("Keep this bottom draft");
    await waitFor(() => {
      expect(
        /* SAFETY: The test controls this fixture and verifies its behavior. */ (
          screen.getByRole("textbox", {
            name: "Composer message",
          }) as HTMLTextAreaElement
        ).value,
      ).toBe("Keep this bottom draft");
    });
    expect(screen.getByTestId("composer-location").textContent).toBe("bottom");
  });

  it("exposes the inline queued draft to plugins without dropping attachments", async () => {
    mocks.queuedMessages = [
      makeQueuedMessage({
        content: [
          { type: "text", text: "Already queued", mentions: [] },
          {
            type: "localFile",
            path: "uploads/queued-spec.md",
            name: "queued-spec.md",
            sizeBytes: 42,
          },
        ],
      }),
    ];

    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    const inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );

    expect(inlineEditor.getByTestId("plugin-composer-scope").textContent).toBe(
      "queued-message:qmsg_1",
    );
    expect(inlineEditor.getByTestId("attachment-count").textContent).toBe("1");

    fireEvent.click(
      inlineEditor.getByRole("button", {
        name: "Simulate plugin replacement",
      }),
    );
    expect(
      /* SAFETY: The test controls this fixture and verifies its behavior. */ (
        inlineEditor.getByRole("textbox", {
          name: "Composer message",
        }) as HTMLInputElement
      ).value,
    ).toBe("Plugin-enhanced queued message");
    expect(inlineEditor.getByTestId("attachment-count").textContent).toBe("1");

    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Submit composer" }),
    );
    await waitFor(() => {
      expect(mocks.updateQueuedMessageMutateAsync).toHaveBeenCalledWith({
        expectedUpdatedAt: 1,
        id: "thr_1",
        input: [
          {
            mentions: [],
            text: "Plugin-enhanced queued message",
            type: "text",
          },
          {
            name: "queued-spec.md",
            path: "uploads/queued-spec.md",
            sizeBytes: 42,
            type: "localFile",
          },
        ],
        queuedMessageId: "qmsg_1",
      });
    });
  });

  it("keeps back-to-back plugin updates in the active queued draft", () => {
    mocks.queuedMessages = [makeQueuedMessage()];

    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    const inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );
    fireEvent.click(
      inlineEditor.getByRole("button", {
        name: "Simulate chained plugin updates",
      }),
    );

    expect(
      /* SAFETY: The test controls this fixture and verifies its behavior. */ (
        inlineEditor.getByRole("textbox", {
          name: "Composer message",
        }) as HTMLInputElement
      ).value,
    ).toBe("First plugin update + second plugin update");
  });

  it("renders text effects only for the active queued edit session", () => {
    mocks.queuedMessages = [
      makeQueuedMessage({ id: "qmsg_1" }),
      makeQueuedMessage({ id: "qmsg_2" }),
    ];

    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    let inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Capture plugin host" }),
    );
    const firstHost = mocks.pluginComposerHost!;
    act(() => {
      setComposerTextEffect(firstHost.textEffectKey, "composer-effect-test", {
        className: "queued-test-effect",
      });
    });
    expect(inlineEditor.getByTestId("composer-text-effect").textContent).toBe(
      "queued-test-effect",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 2" }),
    );
    inlineEditor = within(screen.getByTestId("inline-queued-message-editor"));
    expect(inlineEditor.getByTestId("composer-text-effect").textContent).toBe(
      "none",
    );
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Capture plugin host" }),
    );
    const secondHost = mocks.pluginComposerHost!;
    expect(secondHost.textEffectKey).not.toBe(firstHost.textEffectKey);

    act(() => {
      setComposerTextEffect(firstHost.textEffectKey, "composer-effect-test", {
        className: "stale-queued-test-effect",
      });
    });
    expect(inlineEditor.getByTestId("composer-text-effect").textContent).toBe(
      "none",
    );
    act(() => {
      setComposerTextEffect(secondHost.textEffectKey, "composer-effect-test", {
        className: "queued-test-effect",
      });
    });
    expect(inlineEditor.getByTestId("composer-text-effect").textContent).toBe(
      "queued-test-effect",
    );

    act(() => {
      setComposerTextEffect(
        firstHost.textEffectKey,
        "composer-effect-test",
        null,
      );
      setComposerTextEffect(
        secondHost.textEffectKey,
        "composer-effect-test",
        null,
      );
    });
  });

  it("ignores a stale plugin write after the queued edit changes", () => {
    mocks.queuedMessages = [
      makeQueuedMessage({
        id: "qmsg_1",
        content: [{ type: "text", text: "First queued draft", mentions: [] }],
      }),
      makeQueuedMessage({
        id: "qmsg_2",
        content: [{ type: "text", text: "Second queued draft", mentions: [] }],
      }),
    ];

    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    let inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Capture plugin host" }),
    );
    const staleHost = mocks.pluginComposerHost;
    expect(staleHost?.scope).toMatchObject({
      kind: "queued-message",
      queuedMessageId: "qmsg_1",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 2" }),
    );
    inlineEditor = within(screen.getByTestId("inline-queued-message-editor"));
    expect(inlineEditor.getByTestId("plugin-composer-scope").textContent).toBe(
      "queued-message:qmsg_2",
    );

    act(() => {
      staleHost?.setDraft({
        ...staleHost.getCurrent(),
        text: "Late plugin replacement",
      });
    });
    expect(
      /* SAFETY: The test controls this fixture and verifies its behavior. */ (
        inlineEditor.getByRole("textbox", {
          name: "Composer message",
        }) as HTMLInputElement
      ).value,
    ).toBe("Second queued draft");
  });

  it("shows the queued execution values as read-only while editing", () => {
    mocks.defaultExecutionOptions = {
      model: "bottom-model",
      permissionMode: "auto",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };
    mocks.queuedMessages = [
      makeQueuedMessage({
        model: "queued-model",
        permissionMode: "full",
        reasoningLevel: "high",
        serviceTier: "fast",
      }),
    ];

    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    const inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );

    expect(inlineEditor.getByTestId("selected-model").textContent).toBe(
      "queued-model",
    );
    expect(inlineEditor.getByTestId("selected-reasoning").textContent).toBe(
      "high",
    );
    expect(inlineEditor.getByTestId("selected-service-tier").textContent).toBe(
      "fast",
    );
    expect(inlineEditor.getByTestId("selected-permission").textContent).toBe(
      "full",
    );
    expect(inlineEditor.getByTestId("execution-read-only").textContent).toBe(
      "true",
    );
    expect(inlineEditor.getByTestId("permission-read-only").textContent).toBe(
      "true",
    );
    expect(
      inlineEditor.queryByRole("button", { name: "Handoff to new thread" }),
    ).toBeNull();
  });

  it("dismisses an inline edit when its thread changes or its live row disappears", async () => {
    mocks.promptDraft.text = "Untouched bottom draft";
    mocks.queuedMessages = [makeQueuedMessage()];
    const view = renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );

    view.rerender(
      buildPromptAreaElement({ thread: makeThread({ id: "thr_2" }) }),
    );
    await waitFor(() =>
      expect(
        /* SAFETY: The test controls this fixture and verifies its behavior. */ (
          screen.getByRole("textbox", {
            name: "Composer message",
          }) as HTMLInputElement
        ).value,
      ).toBe("Untouched bottom draft"),
    );

    view.rerender(buildPromptAreaElement());
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    mocks.queuedMessages = [];
    view.rerender(buildPromptAreaElement());
    await waitFor(() =>
      expect(
        /* SAFETY: The test controls this fixture and verifies its behavior. */ (
          screen.getByRole("textbox", {
            name: "Composer message",
          }) as HTMLInputElement
        ).value,
      ).toBe("Untouched bottom draft"),
    );
    expect(mocks.promptDraft.setDraft).not.toHaveBeenCalled();
  });

  it("does not attach a delayed queued upload to a later edit or the bottom draft", async () => {
    const upload = createDeferredPromise<{
      mimeType: string;
      name: string;
      path: string;
      sizeBytes: number;
      type: "localFile";
    }>();
    mocks.uploadPromptAttachmentMutateAsync.mockReturnValueOnce(upload.promise);
    mocks.queuedMessages = [makeQueuedMessage({ id: "qmsg_1" })];
    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    let inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );
    fireEvent.click(inlineEditor.getByRole("button", { name: "Attach file" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel queued edit" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    inlineEditor = within(screen.getByTestId("inline-queued-message-editor"));

    upload.resolve({
      mimeType: "text/plain",
      name: "queued.txt",
      path: "thread-storage/uploads/queued.txt",
      sizeBytes: 6,
      type: "localFile",
    });

    await waitFor(() =>
      expect(mocks.uploadPromptAttachmentMutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(inlineEditor.getByTestId("attachment-count").textContent).toBe("0");
    expect(mocks.promptDraft.addAttachment).not.toHaveBeenCalled();
  });

  it("keeps a delayed bottom upload owned by the bottom draft", async () => {
    const upload = createDeferredPromise<{
      mimeType: string;
      name: string;
      path: string;
      sizeBytes: number;
      type: "localFile";
    }>();
    const uploaded = {
      mimeType: "text/plain",
      name: "queued.txt",
      path: "thread-storage/uploads/queued.txt",
      sizeBytes: 6,
      type: "localFile" as const,
    };
    mocks.uploadPromptAttachmentMutateAsync.mockReturnValueOnce(upload.promise);
    mocks.queuedMessages = [makeQueuedMessage()];
    renderPromptArea();
    fireEvent.click(screen.getByRole("button", { name: "Attach file" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );

    upload.resolve(uploaded);

    await waitFor(() =>
      expect(mocks.promptDraft.addAttachment).toHaveBeenCalledWith(uploaded),
    );
    expect(
      within(screen.getByTestId("inline-queued-message-editor")).getByTestId(
        "attachment-count",
      ).textContent,
    ).toBe("0");
  });

  it("dismisses a missing queued message but keeps a stale edit recoverable", async () => {
    mocks.queuedMessages = [makeQueuedMessage()];
    mocks.updateQueuedMessageMutateAsync.mockRejectedValueOnce(
      new BbHttpError({
        body: null,
        code: "invalid_request",
        status: 409,
        message: "Queued message changed",
      }),
    );
    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    let inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Submit composer" }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Queued message changed"),
    );
    expect(
      screen.getByRole("button", { name: "Cancel queued edit" }),
    ).toBeTruthy();

    mocks.updateQueuedMessageMutateAsync.mockRejectedValueOnce(
      new BbHttpError({
        body: null,
        code: "invalid_request",
        status: 404,
        message: "Queued message not found",
      }),
    );
    inlineEditor = within(screen.getByTestId("inline-queued-message-editor"));
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Submit composer" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Cancel queued edit" }),
      ).toBeNull(),
    );
  });

  it("blocks submit while pending interactions are initially unknown", () => {
    mocks.defaultExecutionOptions = {
      model: "gpt-5",
      permissionMode: "auto",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };

    renderPromptArea({
      pendingInteractionsInitialLoading: true,
      thread: makeThread({ environmentId: "env_1" }),
    });

    expect(screen.getByTestId("submit-mode").textContent).toBe(
      "blocked:loading-pending-interactions",
    );
  });

  it("gives every concurrently running workflow its own independently expandable card", () => {
    renderPromptArea({
      activeWorkflows: [
        workflowRow({
          id: "row-wf-late",
          status: "pending",
          taskStatus: "running",
          workflowName: "rfn-visual-identity",
        }),
        workflowRow({
          id: "row-wf-early",
          status: "pending",
          taskStatus: "running",
          workflowName: "rfn-pass-a-balance",
        }),
      ],
    });

    const cards = screen.getAllByTestId("workflow-card");
    expect(cards.map((card) => card.textContent)).toEqual([
      "rfn-visual-identity",
      "rfn-pass-a-balance",
    ]);

    fireEvent.click(cards[1]!);
    expect(
      screen
        .getAllByTestId("workflow-card")
        .map((card) => card.getAttribute("data-expanded")),
    ).toEqual(["false", "true"]);
  });

  it("shows a child permission prompt on the parent composer", () => {
    renderPromptArea({
      childPendingInteractions: [
        {
          childThreadId: "thr_child",
          childTitle: "Install workspace tools",
          href: "/threads/thr_child",
          interaction: makePendingInteraction(),
        },
      ],
    });

    expect(screen.getByText("Pending interaction")).toBeTruthy();
  });

  it("keeps Goal above a pending interaction", () => {
    renderPromptArea({
      goal: activeGoal,
      pendingInteractions: [makePendingInteraction()],
    });

    expect(
      screen
        .getAllByTestId("composer-stack-item")
        .map((item) => item.textContent),
    ).toEqual(["Goal banner", "Pending interaction"]);
  });

  it("keeps plugin banners mounted while pending interaction suspends editor regions", () => {
    setPluginSlotRegistrations("pending-plugin", {
      homepageSections: [],
      settingsSections: [],
      navPanels: [],
      threadPanelActions: [],
      composerCustomizations: [
        {
          id: "pending",
          scopes: ["thread"],
          actions: [
            { id: "action", component: () => <button>Editor action</button> },
          ],
          plusMenu: [{ id: "menu", label: "Editor menu", run: () => {} }],
          banners: [
            {
              id: "banner",
              component: () => <div>Persistent plugin banner</div>,
            },
          ],
          richText: {
            effects: [
              {
                id: "rule",
                className: "pending-rule",
                match: (text) => [{ from: 0, to: text.length }],
              },
            ],
          },
        },
      ],
      pendingInteractions: [],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
    });

    renderPromptArea({ pendingInteractions: [makePendingInteraction()] });

    expect(screen.getByText("Persistent plugin banner")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editor action" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prompt actions" })).toBeNull();
    expect(document.querySelector(".pending-rule")).toBeNull();
    expect(screen.getByTestId("composer-hidden").textContent).toBe("true");
    expect(screen.getByTestId("submit-mode").textContent).toBe(
      "blocked:pending-interaction",
    );
    expect(screen.queryByTestId("queued-message-list")).toBeNull();
  });

  it("wires the Plan exit action to the current thread", () => {
    renderPromptArea({
      activePromptMode: activePlan,
      thread: makeThread({ id: "thr_plan" }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Exit plan mode" }));

    expect(mocks.cancelThreadPlanMutate).toHaveBeenCalledWith("thr_plan");
    expect(mocks.clearThreadGoalMutate).not.toHaveBeenCalled();
  });

  it("wires the Goal clear action to the current thread", () => {
    renderPromptArea({
      goal: activeGoal,
      thread: makeThread({ id: "thr_goal" }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear active Goal" }));

    expect(mocks.clearThreadGoalMutate).toHaveBeenCalledWith("thr_goal");
    expect(mocks.cancelThreadPlanMutate).not.toHaveBeenCalled();
  });

  it("keeps independent Plan and Goal banners above a pending interaction", () => {
    renderPromptArea({
      activePromptMode: activePlan,
      goal: activeGoal,
      pendingInteractions: [makePendingInteraction()],
    });

    expect(
      screen
        .getAllByTestId("composer-stack-item")
        .map((item) => item.textContent),
    ).toEqual(["Plan banner", "Goal banner", "Pending interaction"]);
  });

  it("keeps independent Plan and Goal banners above plugin input", () => {
    renderPromptArea({
      activePromptMode: activePlan,
      goal: activeGoal,
      pendingInteractions: [makePluginPendingInteraction()],
    });

    expect(
      screen
        .getAllByTestId("composer-stack-item")
        .map((item) => item.textContent),
    ).toEqual(["Plan banner", "Goal banner", "Pending interaction"]);
  });

  it("selects the provider fallback model for the next turn", () => {
    mocks.defaultExecutionOptions = {
      model: "claude-fable-5",
      permissionMode: "full",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };

    renderPromptArea({
      modelFallback: {
        sourceSeq: 42,
        detectedAt: 123,
        originalModel: "claude-fable-5",
        fallbackModel: "claude-opus-4-8",
        reason: "refusal",
        message: "Switched to Opus.",
      },
    });

    expect(mocks.useThreadCreationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ initialModel: "claude-opus-4-8" }),
    );
    expect(screen.getByTestId("selected-model").textContent).toBe(
      "claude-opus-4-8",
    );
    expect(screen.getByText("Model fallback")).toBeTruthy();
  });

  it("opens root compose with a handoff seed for the current thread", () => {
    renderPromptArea({
      thread: makeThread({
        environmentId: "env_1",
        id: "thr_source",
        projectId: "proj_source",
        title: "Source thread",
        titleFallback: null,
      }),
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Handoff to new thread" }),
    );

    expect(screen.getByTestId("navigation-capture").textContent).toBe(
      JSON.stringify({
        pathname: "/projects/proj_source",
        state: {
          focusPrompt: true,
          [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: {
            environmentId: "env_1",
            projectId: "proj_source",
            sourceThreadId: "thr_source",
            sourceThreadTitle: "Source thread",
          },
          reuseEnvironmentId: "env_1",
        },
      }),
    );
  });
});
