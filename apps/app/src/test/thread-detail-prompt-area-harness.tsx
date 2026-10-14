import type {
  PendingInteraction,
  PermissionMode,
  PromptTextMention,
  ResolvedThreadExecutionOptions,
  ThreadQueuedMessage,
  ThreadTimelineActivePromptMode,
  ThreadTimelineGoal,
} from "@bb/domain";
import type {
  ExistingThreadExecutionInputSources,
  TimelineWorkflowWorkRow,
} from "@bb/server-contract";
import type { ReactNode } from "react";
import { vi } from "vitest";
import type { PromptDraftAttachment } from "@bb/client-core";
import type { TypeaheadConfig } from "@/components/promptbox/PromptBoxInternal";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";

export const promptAreaMocks = {
  cancelThreadPlanMutate: vi.fn(),
  clearThreadGoalMutate: vi.fn(),
  createQueuedMessageMutateAsync: vi.fn(),
  createThreadMutateAsync: vi.fn(),
  defaultExecutionOptions: null as ResolvedThreadExecutionOptions | null,
  executionInputSources: {} as ExistingThreadExecutionInputSources,
  deleteQueuedMessageMutateAsync: vi.fn(),
  navigate: vi.fn(),
  pluginComposerHost: null as PluginComposerHost | null,
  promptDraft: {
    addAttachment: vi.fn(),
    attachments: [] as PromptDraftAttachment[],
    clearIfCurrentMatches: vi.fn(),
    getCurrent: vi.fn(),
    mentions: [] as PromptTextMention[],
    updateAttachments: vi.fn(),
    restoreIfEmpty: vi.fn(),
    setDraft: vi.fn(),
    setTextAndMentions: vi.fn(),
    storageKey: "bb.promptbox.contents-proj_1-thr_1-3",
    subscribe: vi.fn(() => () => {}),
    text: "",
  },
  queuedMessages: [] as ThreadQueuedMessage[] | undefined,
  reorderQueuedMessageMutateAsync: vi.fn(),
  sendMessageMutateAsync: vi.fn(),
  sendQueuedMessageMutateAsync: vi.fn(),
  setQueuedMessageGroupBoundaryMutateAsync: vi.fn(),
  stopThreadMutate: vi.fn(),
  serviceTier: undefined as "default" | "fast" | undefined,
  setPermissionMode: vi.fn(),
  setReasoningLevel: vi.fn(),
  setServiceTier: vi.fn(),
  supportsServiceTier: false,
  toastError: vi.fn(),
  restoreThreadEnvironmentMutate: vi.fn(),
  unarchiveThreadMutate: vi.fn(),
  updateThreadMutate: vi.fn(),
  uploadPromptAttachmentMutateAsync: vi.fn(),
  updateQueuedMessageMutateAsync: vi.fn(),
  useThreadDefaultExecutionOptions: vi.fn(),
  useThreadCreationOptions: vi.fn(),
  useThreadPromptHistory: vi.fn(),
  useThreadQueuedMessages: vi.fn(),
};

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => promptAreaMocks.navigate,
  };
});

vi.mock("@/components/ui/app-route-anchor", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/app-route-anchor")>();
  return {
    ...actual,
    useImmediateRouteNavigate: () => promptAreaMocks.navigate,
  };
});

vi.mock("@/components/promptbox/FollowUpPromptBox", async () => {
  const { ComposerBannersSlot } = await vi.importActual<
    typeof import("@/components/plugin/PluginComposerBanners")
  >("@/components/plugin/PluginComposerBanners");
  return {
    FollowUpPromptBox: ({
      activePromptMode,
      typeahead,
      attachments,
      composer,
      environmentSummary,
      execution,
      executionReadOnly,
      pendingInteraction,
      permission,
      permissionReadOnly,
      pluginComposerHost,
      sessionOptionsControl,
      showScrollToBottomButton,
      stack,
      suppressPluginComposerCustomizations,
      textEffects,
    }: {
      activePromptMode?: ThreadTimelineActivePromptMode | null;
      typeahead: TypeaheadConfig;
      attachments: {
        items: readonly unknown[];
        onAttachFiles: (files: File[]) => void | Promise<void>;
      };
      composer: {
        canModifierSubmit: boolean;
        message: string;
        onChangeMessage: (message: string, mentions: []) => void;
        onEscape?: () => void;
        onModifierSubmit: () => void;
        onSubmit: () => void;
        submitLabel?: string;
        submitIcon?: string;
        submitTitle?: string;
        submitMode: { kind: string; reason?: string };
      } | null;
      environmentSummary?: ReactNode;
      execution: {
        providerRouting: { environmentId?: string; hostId?: string };
        model: {
          active?: { model: string } | null;
        };
        provider: {
          selectedId: string;
          onChange?: (value: string) => void;
        };
        handoff?: {
          active: boolean;
          onStart: () => void;
          onExit: () => void;
          onSelect: (selection: {
            providerId: string;
            model: string;
            reasoningLevel: "medium";
          }) => void;
        };
        reasoning: { value: string };
        serviceTier?: { value?: string };
        agentOptions?: {
          sections: readonly {
            id: string;
            label: string;
            selectedLabel: string;
            appliesOnNextTurn: boolean;
          }[];
          onChange: (optionId: string, value: string | boolean) => void;
        };
      };
      executionReadOnly?: boolean;
      pendingInteraction?: ReactNode;
      permission: { value?: string };
      permissionReadOnly?: boolean;
      pluginComposerHost?: PluginComposerHost | null;
      sessionOptionsControl?: ReactNode;
      showScrollToBottomButton?: boolean;
      stack: ReactNode;
      suppressPluginComposerCustomizations?: boolean;
      textEffects?: readonly {
        effect: { className: string };
      }[];
    }) => (
      <div data-testid="follow-up-prompt-box">
        {environmentSummary}
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
          {composer === null || pendingInteraction ? "true" : "false"}
        </div>
        <div data-testid="submit-mode">
          {composer?.submitMode.kind}:{composer?.submitMode.reason ?? ""}
        </div>
        <div data-testid="submit-title">
          {composer?.submitTitle ?? "Submit"}
        </div>
        <div data-testid="submit-label">{composer?.submitLabel ?? ""}</div>
        <div data-testid="submit-icon">{composer?.submitIcon ?? ""}</div>
        <div data-testid="plugin-customizations-suppressed">
          {suppressPluginComposerCustomizations ? "true" : "false"}
        </div>
        <div data-testid="active-permission-mode">{activePromptMode?.mode}</div>
        <div data-testid="selected-provider">
          {execution.provider.selectedId}
        </div>
        <div data-testid="preview-environment">
          {execution.providerRouting.environmentId}
        </div>
        <div data-testid="command-suggestions">
          {typeahead.command?.suggestions
            .map((command) => command.name)
            .join(",")}
        </div>
        <div data-testid="selected-model">{execution.model.active?.model}</div>
        <div data-testid="selected-reasoning">{execution.reasoning.value}</div>
        <div data-testid="selected-service-tier">
          {execution.serviceTier?.value}
        </div>
        <div data-testid="selected-permission">{permission.value}</div>
        <div data-testid="session-options-control">{sessionOptionsControl}</div>
        <div data-testid="picker-agent-options">
          {(execution.agentOptions?.sections ?? []).map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => execution.agentOptions?.onChange(section.id, true)}
            >
              {`${section.label}: ${section.selectedLabel}${section.appliesOnNextTurn ? " (next turn)" : ""}`}
            </button>
          ))}
        </div>
        <div data-testid="execution-read-only">
          {executionReadOnly ? "true" : "false"}
        </div>
        <div data-testid="permission-read-only">
          {permissionReadOnly ? "true" : "false"}
        </div>
        <div data-testid="attachment-count">{attachments.items.length}</div>
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
                promptAreaMocks.pluginComposerHost = pluginComposerHost;
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
            {composer.canModifierSubmit ? (
              <button type="button" onClick={composer.onModifierSubmit}>
                Modifier submit
              </button>
            ) : null}
            {composer.onEscape ? (
              <button type="button" onClick={composer.onEscape}>
                Escape composer
              </button>
            ) : null}
            <button
              type="button"
              onClick={() =>
                void attachments.onAttachFiles([
                  new File(["queued"], "queued.txt", { type: "text/plain" }),
                ])
              }
            >
              Attach file
            </button>
          </>
        ) : null}
        {execution.provider.onChange ? (
          <>
            <button
              type="button"
              onClick={() => execution.provider.onChange?.("claude-code")}
            >
              Switch provider
            </button>
            <button
              type="button"
              onClick={() => execution.provider.onChange?.("codex")}
            >
              Switch provider back
            </button>
          </>
        ) : null}
        {execution.handoff ? (
          <>
            {execution.handoff.active ? (
              <button type="button" onClick={execution.handoff.onExit}>
                Exit handoff
              </button>
            ) : null}
            <button type="button" onClick={execution.handoff.onStart}>
              Start handoff
            </button>
            <button
              type="button"
              onClick={() =>
                execution.handoff?.onSelect({
                  providerId: "codex",
                  model: "gpt-5-mini",
                  reasoningLevel: "medium",
                })
              }
            >
              Same provider handoff
            </button>
            <button
              type="button"
              onClick={() =>
                execution.handoff?.onSelect({
                  providerId: "claude-code",
                  model: "claude-opus-5",
                  reasoningLevel: "medium",
                })
              }
            >
              Complete handoff flow
            </button>
          </>
        ) : null}
      </div>
    ),
  };
});

vi.mock("@/components/promptbox/ThreadEnvironmentSummary", () => ({
  ThreadEnvironmentSummary: () => (
    <div data-testid="thread-environment-summary" />
  ),
}));

vi.mock(
  "@/components/promptbox/banner/QueuedMessagesList",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/components/promptbox/banner/QueuedMessagesList")
    >()),
    QueuedMessagesList: ({
      inlineEditor,
      queuedMessages,
      onEdit,
      onSend,
      sendAction,
      sendDisabled,
    }: {
      inlineEditor?: { content: ReactNode; onDismiss: () => void };
      queuedMessages: readonly ThreadQueuedMessage[];
      onEdit: (request: {
        queuedMessageId: string;
        queuedMessageIndex: number;
      }) => void;
      onSend: (queuedMessageId: string) => void;
      sendAction: "send-now" | "steer-when-ready";
      sendDisabled: boolean;
    }) => (
      <div
        data-testid="queued-message-list"
        data-send-action={sendAction}
        data-send-disabled={sendDisabled ? "" : undefined}
      >
        <div data-testid="queued-message-count">{queuedMessages.length}</div>
        {queuedMessages.map((message, index) => (
          <div key={message.id}>
            <button type="button" onClick={() => onSend(message.id)}>
              {sendAction === "steer-when-ready"
                ? `Steer queued message ${index + 1} when ready`
                : `Send queued message ${index + 1} now`}
            </button>
            <button
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
          </div>
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
  }),
);

vi.mock("@/components/promptbox/banner/ThreadBackgroundCommandsCard", () => ({
  ThreadBackgroundCommandsCard: () => null,
}));

vi.mock("@/components/promptbox/banner/ThreadGoalCard", () => ({
  ThreadGoalCard: ({
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
}));

vi.mock("@/components/promptbox/banner/ThreadPromptContextBanner", () => ({
  ThreadPromptContextBanner: () => null,
}));

vi.mock("@/components/promptbox/banner/ThreadPromptModeCard", () => ({
  ThreadPromptModeCard: ({
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
}));

vi.mock("@/components/promptbox/banner/ThreadTodoCard", () => ({
  ThreadTodoCard: () => null,
}));

vi.mock("@/components/promptbox/banner/ThreadWorkflowCard", () => {
  const MockWorkflowCard = ({
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
  );
  return {
    ThreadWorkflowCard: MockWorkflowCard,
    ThreadWorkflowSummary: ({
      workflow,
    }: {
      workflow: TimelineWorkflowWorkRow;
    }) => <span data-testid="workflow-summary">{workflow.workflowName}</span>,
  };
});

vi.mock(
  "@/components/thread/pending-interactions/ThreadPendingInteractionBanner",
  () => ({
    ThreadPendingInteractionBanners: () => (
      <div data-testid="composer-stack-item">Pending interaction</div>
    ),
  }),
);

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: promptAreaMocks.toastError },
}));

vi.mock("@/hooks/useCommandSuggestions", () => ({
  useCommandSuggestions: ({
    providerId,
    commandScope,
  }: {
    providerId: string;
    commandScope: string;
  }) => ({
    hasMore: false,
    isError: false,
    isLoading: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
    suggestions: [{ name: `${providerId}:${commandScope}` }],
    triggers: [],
  }),
}));

vi.mock("@/hooks/usePromptMentions", () => ({
  usePromptMentions: () => ({
    isError: false,
    isLoading: false,
    setQuery: vi.fn(),
    suggestions: [],
  }),
}));

vi.mock("@/hooks/useThreadCreationOptions", async () => {
  const { useState } = await import("react");
  return {
    useThreadCreationOptions: (options: {
      initialProviderId: string;
      initialPermissionMode?: PermissionMode;
    }) => {
      promptAreaMocks.useThreadCreationOptions(options);
      const [selectedProviderId, setSelectedProviderId] = useState(
        options.initialProviderId,
      );
      const [explicitModel, setExplicitModel] = useState<string | null>(null);
      const isClaude = selectedProviderId === "claude-code";
      return {
        activeModel: null,
        executionInputSources: promptAreaMocks.executionInputSources,
        executionOptionsRouting: { hostId: "host_1" },
        providers: [],
        hasMultipleProviders: true,
        isLoadingModels: false,
        modelCatalogIsSettled: true,
        modelLoadError: null,
        modelLoadFailed: false,
        modelOptions: [],
        moreModelOptions: [],
        permissionMode: options.initialPermissionMode ?? "auto",
        permissionModeOptions: [],
        providerOptions: [
          { value: "codex", label: "Codex" },
          { value: "claude-code", label: "Claude Code" },
        ],
        reasoningLevel: "medium",
        reasoningOptions: [],
        selectedModel: explicitModel ?? (isClaude ? "claude-opus-5" : "gpt-5"),
        selectedProviderComposerActions: [],
        selectedProviderDisplayName: isClaude ? "Claude Code" : "Codex",
        selectedProviderId,
        serviceTier: promptAreaMocks.serviceTier,
        serviceTierSupportByProvider: {},
        setPermissionMode: promptAreaMocks.setPermissionMode,
        setReasoningLevel: promptAreaMocks.setReasoningLevel,
        setProviderModelReasoning: ({
          providerId,
          model,
        }: {
          providerId: string;
          model: string;
        }) => {
          setSelectedProviderId(providerId);
          setExplicitModel(model);
        },
        setSelectedModel: setExplicitModel,
        setSelectedProviderId: (providerId: string) => {
          setSelectedProviderId(providerId);
          setExplicitModel(null);
        },
        setServiceTier: promptAreaMocks.setServiceTier,
        supportsPermissionModeSelection: true,
        supportsServiceTier: promptAreaMocks.supportsServiceTier,
      };
    },
  };
});

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: () => ({
    isPending: false,
    mutateAsync: promptAreaMocks.uploadPromptAttachmentMutateAsync,
  }),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useCancelThreadPlan: () => ({
    isPending: false,
    mutate: promptAreaMocks.cancelThreadPlanMutate,
  }),
  useClearThreadGoal: () => ({
    isPending: false,
    mutate: promptAreaMocks.clearThreadGoalMutate,
  }),
  useCreateThread: () => ({
    isPending: false,
    mutateAsync: promptAreaMocks.createThreadMutateAsync,
  }),
  useCreateThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: promptAreaMocks.createQueuedMessageMutateAsync,
  }),
  useDeleteThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: promptAreaMocks.deleteQueuedMessageMutateAsync,
  }),
  useReorderThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: promptAreaMocks.reorderQueuedMessageMutateAsync,
  }),
  useSetThreadQueuedMessageGroupBoundary: () => ({
    isPending: false,
    mutateAsync: promptAreaMocks.setQueuedMessageGroupBoundaryMutateAsync,
  }),
  useSendThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: promptAreaMocks.sendQueuedMessageMutateAsync,
  }),
  useStopThread: () => ({
    isPending: false,
    mutate: promptAreaMocks.stopThreadMutate,
    variables: null,
  }),
  useUpdateThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: promptAreaMocks.updateQueuedMessageMutateAsync,
  }),
}));

vi.mock("@/hooks/mutations/thread-state-mutations", () => ({
  useRestoreThreadEnvironment: () => ({
    isPending: false,
    mutate: promptAreaMocks.restoreThreadEnvironmentMutate,
    variables: null,
  }),
  useUnarchiveThread: () => ({
    isPending: false,
    mutate: promptAreaMocks.unarchiveThreadMutate,
    variables: null,
  }),
  useUpdateThread: () => ({
    isPending: false,
    mutate: promptAreaMocks.updateThreadMutate,
  }),
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useProjectDisplayName: () => null,
}));

vi.mock("@/hooks/queries/thread-default-execution-options-query", () => ({
  useThreadDefaultExecutionOptions: (threadId: string, options: unknown) => {
    promptAreaMocks.useThreadDefaultExecutionOptions(threadId, options);
    return {
      data: promptAreaMocks.defaultExecutionOptions,
      isError: false,
    };
  },
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  orderPendingInteractions: (
    interactions: readonly PendingInteraction[] | undefined,
  ) => interactions ?? [],
  useThreadPromptHistory: (threadId: string, options: unknown) => {
    promptAreaMocks.useThreadPromptHistory(threadId, options);
    return { data: [] };
  },
  useThreadQueuedMessages: (threadId: string, options: unknown) => {
    promptAreaMocks.useThreadQueuedMessages(threadId, options);
    return { data: promptAreaMocks.queuedMessages };
  },
}));
