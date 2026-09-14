import { useCallback, useMemo, useState, type ReactNode } from "react";
import type {
  Environment,
  Host,
  PermissionMode,
  PromptMentionResource,
  PromptTextMention,
  ThreadQueuedMessage,
  WorkspaceStatus,
} from "@bb/domain";
import { makeThreadQueuedMessage } from "@bb/test-helpers/domain-fixtures";
import {
  formatEnvironmentDisplay,
  type EnvironmentDisplayHostContext,
} from "@bb/core-ui";
import { EMPTY_ORDERED_MENTION_SUGGESTIONS } from "@bb/client-core";
import type {
  SystemExecutionOptionsModelLoadError,
  ThreadContextWindowUsage,
} from "@bb/server-contract";
import {
  FollowUpPromptBox,
  type FollowUpSubmitMode,
} from "@/components/promptbox/FollowUpPromptBox";
import {
  getFollowUpPromptPlaceholder,
  getCompactFollowUpPromptPlaceholder,
} from "@/components/promptbox/follow-up-placeholder";
import {
  findEnvironmentDisplayProvider,
  getEnvironmentSummaryChrome,
} from "@/lib/environment-workspace-display";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  type AttachmentsConfig,
  type PromptBoxAction,
  type TypeaheadConfig,
} from "@/components/promptbox/PromptBoxInternal";
import {
  AUTOMATION_PROMPT_ACTION,
  CREATE_PLUGIN_PROMPT_ACTION,
} from "@/components/promptbox/PromptBoxActionsMenu";
import { ThreadPromptContextBanner } from "@/components/promptbox/banner/ThreadPromptContextBanner";
import {
  QueuedMessagesList,
  type QueuedMessageEditRequest,
  type QueuedMessageInlineEditor,
} from "@/components/promptbox/banner/QueuedMessagesList";
import { ThreadEnvironmentSummary } from "@/components/promptbox/ThreadEnvironmentSummary";
import {
  formatWorkspaceCheckoutDisplay,
  type WorkspaceCheckoutDisplay,
} from "@/lib/workspace-checkout-display";
import type { PickerOption } from "@/components/pickers/OptionPicker";
import { selectWorkspaceChangedFilesSection } from "@/components/workspace/workspace-change-summary";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { ModelPickerStoryQueryProvider } from "../../../.ladle/model-picker-query-provider";
import {
  makeEnvironment,
  makeExecutionControlsProps,
  useInteractiveExecutionControls,
  STORY_CODEX_MODELS,
  STORY_ENVIRONMENT_PROVIDERS,
  PROJECT_NAMES,
  STORY_PROVIDER_OPTIONS,
} from "../../../.ladle/story-fixtures";
import type {
  ExecutionControlsProps,
  ExecutionPermissionConfig,
} from "@/components/promptbox/ExecutionControls";
import { PageShell } from "@/components/ui/page-shell.js";
import { promptDraftToInput, type PromptDraftState } from "@bb/client-core";
import { queuedInputToDraft } from "@bb/client-core";

export default {
  title: "promptbox/Follow Up Prompt Box",
};

const noop = () => {};
const STORY_BRANCH_NAME = "bb/design-system-polish";

const baseExecution = makeExecutionControlsProps({
  provider: {
    options: STORY_PROVIDER_OPTIONS,
    selectedId: "codex",
    hasMultiple: true,
  },
});
const codexModelLoadError = {
  providerId: "codex",
  code: "failed",
} satisfies SystemExecutionOptionsModelLoadError;

const permissionModeOptions: readonly PickerOption<PermissionMode>[] = [
  { value: "accept-edits", label: "Accept Edits" },
  { value: "auto", label: "Approve for me" },
  { value: "full", label: "Full Access", tone: "warning" },
];

const basePermission: ExecutionPermissionConfig = {
  value: "auto",
  options: permissionModeOptions,
  onChange: noop,
  supported: true,
};

const promptActions: readonly PromptBoxAction[] = [
  { kind: "skills", text: "/" },
  {
    kind: "plan",
    command: { trigger: "/", name: "plan", trailingText: " " },
    text: "/plan ",
  },
  {
    kind: "goal",
    command: { trigger: "/", name: "goal", trailingText: " " },
    text: "/goal ",
  },
  AUTOMATION_PROMPT_ACTION,
  CREATE_PLUGIN_PROMPT_ACTION,
];

const readOnlyExecution = makeExecutionControlsProps({
  provider: {
    options: STORY_PROVIDER_OPTIONS,
    selectedId: "codex",
    onChange: noop,
    hasMultiple: false,
  },
  model: {
    active: { model: "gpt-5.5" },
    selected: "gpt-5.5",
    options: STORY_CODEX_MODELS,
    moreOptions: [],
    isLoading: false,
    loadFailed: false,
    onChange: noop,
  },
});

const readOnlyPermission: ExecutionPermissionConfig = {
  value: "accept-edits",
  options: permissionModeOptions,
  onChange: noop,
  supported: true,
};

interface EnvironmentSummaryArgs {
  environment: Environment;
  host: EnvironmentDisplayHostContext;
  projectName?: string | null;
  machineName?: string;
  hasMultipleMachines?: boolean;
  hostType?: Host["type"];
  branchName?: string;
  environmentCheckout?: WorkspaceCheckoutDisplay;
  onCreateNewThreadInEnvironment?: () => void;
}

function makeEnvironmentSummary({
  environment,
  host,
  projectName = PROJECT_NAMES.bb,
  machineName,
  hasMultipleMachines = false,
  hostType = "persistent",
  branchName,
  environmentCheckout,
  onCreateNewThreadInEnvironment,
}: EnvironmentSummaryArgs): ReactNode {
  const providerLookup = findEnvironmentDisplayProvider(
    STORY_ENVIRONMENT_PROVIDERS,
    environment.environmentProviderId,
  );
  const display = formatEnvironmentDisplay({
    environment,
    host,
    providerLookup,
  });
  const chrome = getEnvironmentSummaryChrome({
    display,
    providerLookup,
    environmentName: environment.name,
    hasMultipleMachines,
    host:
      machineName === undefined
        ? null
        : { name: machineName, type: hostType, machineProviderId: null },
    machineProviders: undefined,
  });
  const checkoutDisplay =
    environmentCheckout ??
    (branchName
      ? formatWorkspaceCheckoutDisplay({
          checkout: {
            kind: "branch",
            branchName,
            headSha: null,
          },
        })
      : undefined);
  return (
    <ThreadEnvironmentSummary
      projectName={projectName ?? undefined}
      environmentLabel={chrome.environmentLabel}
      environmentCompactLabel={chrome.environmentCompactLabel}
      environmentIcon={chrome.environmentIcon}
      environmentProviderName={chrome.environmentProviderName}
      environmentHost={chrome.environmentHost}
      environmentMachineProvider={chrome.environmentMachineProvider}
      environmentCheckout={checkoutDisplay}
      onCreateNewThreadInEnvironment={onCreateNewThreadInEnvironment}
    />
  );
}

const localEnvironmentDisplayHost: EnvironmentDisplayHostContext = {
  locality: "local",
  identity: null,
};

const remoteEnvironmentDisplayHost: EnvironmentDisplayHostContext = {
  locality: "remote",
  identity: null,
};

const localEnvironmentSummary: ReactNode = makeEnvironmentSummary({
  environment: makeEnvironment({
    status: "ready",
  }),
  host: localEnvironmentDisplayHost,
  branchName: STORY_BRANCH_NAME,
});

const longHostEnvironmentSummary: ReactNode = makeEnvironmentSummary({
  environment: makeEnvironment({
    status: "ready",
  }),
  host: localEnvironmentDisplayHost,
  projectName: "bb UI QA",
  machineName: "Bersabel's MacBook Pro",
  hasMultipleMachines: true,
  branchName: STORY_BRANCH_NAME,
});

const multiMachineEnvironmentSummary: ReactNode = makeEnvironmentSummary({
  environment: makeEnvironment({
    status: "ready",
  }),
  host: localEnvironmentDisplayHost,
  machineName: "Build Mac mini",
  hasMultipleMachines: true,
  branchName: STORY_BRANCH_NAME,
});

const sandboxWorktreeEnvironmentSummary: ReactNode = makeEnvironmentSummary({
  environment: makeEnvironment({
    environmentProviderId: "git-worktree",
    status: "ready",
  }),
  host: remoteEnvironmentDisplayHost,
  machineName: "Modal sandbox",
  hostType: "ephemeral",
  branchName: STORY_BRANCH_NAME,
  onCreateNewThreadInEnvironment: noop,
});

const namedLocalEnvironmentSummary: ReactNode = makeEnvironmentSummary({
  environment: makeEnvironment({
    name: "Linked review tree",
    status: "ready",
  }),
  host: localEnvironmentDisplayHost,
  machineName: "Bersabel's MacBook Pro",
  hasMultipleMachines: true,
  branchName: STORY_BRANCH_NAME,
  onCreateNewThreadInEnvironment: noop,
});

const detachedWorktreeEnvironmentSummary: ReactNode = makeEnvironmentSummary({
  environment: makeEnvironment({
    environmentProviderId: "git-worktree",
    status: "ready",
  }),
  host: localEnvironmentDisplayHost,
  machineName: "Bersabel's MacBook Pro",
  environmentCheckout: formatWorkspaceCheckoutDisplay({
    checkout: {
      kind: "detached",
      headSha: "abcdef1234567890",
    },
  }),
  onCreateNewThreadInEnvironment: noop,
});

const provisioningEnvironmentSummary: ReactNode = makeEnvironmentSummary({
  environment: makeEnvironment({
    path: null,
    status: "provisioning",
  }),
  host: localEnvironmentDisplayHost,
});

const personalEnvironmentSummary: ReactNode = makeEnvironmentSummary({
  environment: makeEnvironment({
    environmentProviderId: "personal-workspace",
    branchName: null,
    status: "ready",
  }),
  host: localEnvironmentDisplayHost,
  projectName: null,
  onCreateNewThreadInEnvironment: noop,
});

const destroyedEnvironmentSummary: ReactNode = makeEnvironmentSummary({
  environment: makeEnvironment({
    path: null,
    status: "destroyed",
  }),
  host: localEnvironmentDisplayHost,
});

const usage: ThreadContextWindowUsage = {
  usedTokens: 32_400,
  modelContextWindow: 128_000,
  estimated: false,
};

const typeaheadBase: TypeaheadConfig = {
  mention: {
    results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
    isLoading: false,
    isError: false,
    onQueryChange: noop,
  },
  command: INERT_TYPEAHEAD_COMMAND_CONFIG,
};

const attachmentsBase: AttachmentsConfig = {
  items: [],
  projectId: "proj_demo",
  isAttaching: false,
  error: null,
  onAttachFiles: noop,
  onRemove: noop,
};

const historyEntries = [
  { text: "review thread workspace", mentions: [], attachments: [] },
  {
    text: "investigate timeline pagination",
    mentions: [],
    attachments: [],
  },
];

interface StoryMentionSpec {
  token: string;
  resource: PromptMentionResource;
}

function storyMention(
  text: string,
  { token, resource }: StoryMentionSpec,
): PromptTextMention {
  const start = text.indexOf(token);
  if (start < 0) {
    throw new Error(`Missing story mention token: ${token}`);
  }
  return {
    start,
    end: start + token.length,
    resource,
  };
}

function buildStoryMentions(
  text: string,
  mentionSpecs: readonly StoryMentionSpec[],
): PromptTextMention[] {
  return mentionSpecs.map((spec) => storyMention(text, spec));
}

const stackedCardsWithPillsMessage = [
  "> Review @apps/app/src/components/promptbox/FollowUpPromptBox.tsx",
  "> with @thread:thr_prompt_pills, then run /github:gh-fix-ci.",
  "",
  "This paragraph should stay outside the collapsed one-line preview.",
].join("\n");

const stackedCardsWithPillsMentions = buildStoryMentions(
  stackedCardsWithPillsMessage,
  [
    {
      token: "@apps/app/src/components/promptbox/FollowUpPromptBox.tsx",
      resource: {
        kind: "path",
        source: "workspace",
        entryKind: "file",
        path: "apps/app/src/components/promptbox/FollowUpPromptBox.tsx",
        label: "FollowUpPromptBox.tsx",
      },
    },
    {
      token: "@thread:thr_prompt_pills",
      resource: {
        kind: "thread",
        projectId: "proj_promptbox",
        threadId: "thr_prompt_pills",
        label: "Prompt pills QA",
      },
    },
    {
      token: "/github:gh-fix-ci",
      resource: {
        kind: "command",
        trigger: "/",
        name: "github:gh-fix-ci",
        source: "skill",
        origin: "user",
        label: "github:gh-fix-ci",
        argumentHint: null,
      },
    },
  ],
);

const dirtyWorkspaceStatus: WorkspaceStatus = {
  workingTree: {
    state: "dirty_uncommitted",
    hasUncommittedChanges: true,
    files: [
      {
        path: "apps/app/src/components/promptbox/FollowUpPromptBox.tsx",
        status: "M",
        insertions: 42,
        deletions: 18,
      },
      {
        path: "apps/app/src/views/ThreadDetailPromptArea.tsx",
        status: "M",
        insertions: 12,
        deletions: 6,
      },
      {
        path: "apps/app/src/components/promptbox/banner/QueuedMessagesList.tsx",
        status: "A",
        insertions: 74,
        deletions: 0,
      },
    ],
    insertions: 128,
    deletions: 24,
    lineStatsComplete: true,
  },
  branch: {
    currentBranch: STORY_BRANCH_NAME,
    defaultBranch: "main",
  },
  checkout: {
    kind: "branch",
    branchName: STORY_BRANCH_NAME,
    headSha: null,
  },
  mergeBase: null,
};

const dirtyContextBannerSection =
  selectWorkspaceChangedFilesSection(dirtyWorkspaceStatus);

const contextBannerElement: ReactNode = dirtyContextBannerSection ? (
  <ThreadPromptContextBanner
    archivedSection={null}
    environmentGoneSection={null}
    gitSection={{
      changedFiles: dirtyContextBannerSection,
      mergeBase: {
        branch: "main",
        options: ["main", "develop", "release/2026-05"],
        onChange: noop,
      },
      onPromptBannerFileClick: noop,
    }}
    gitSectionPending={false}
    parentThreadSection={null}
    childThreadsSection={null}
    pullRequestSection={null}
    expandedSection={null}
    onToggleSection={noop}
  />
) : null;

const archivedContextBannerElement: ReactNode = (
  <ThreadPromptContextBanner
    archivedSection={{ archivedAt: 1_731_456_000_000 }}
    environmentGoneSection={null}
    gitSection={null}
    gitSectionPending={false}
    parentThreadSection={null}
    childThreadsSection={null}
    pullRequestSection={null}
    expandedSection={null}
    onToggleSection={noop}
  />
);

const environmentGoneContextBannerElement: ReactNode = (
  <ThreadPromptContextBanner
    archivedSection={null}
    environmentGoneSection={{ status: "destroyed" }}
    gitSection={null}
    gitSectionPending={false}
    parentThreadSection={null}
    childThreadsSection={null}
    pullRequestSection={null}
    expandedSection={null}
    onToggleSection={noop}
  />
);

function makeStoryQueuedMessage(id: string, text: string): ThreadQueuedMessage {
  return makeThreadQueuedMessage({
    id,
    threadId: "thr_prompt_pills",
    content: [{ type: "text", text, mentions: [] }],
  });
}

const queuedMessages: readonly ThreadQueuedMessage[] = [
  makeStoryQueuedMessage("q_1", "Also check the timeline error overlay."),
  makeStoryQueuedMessage(
    "q_2",
    "Confirm the environment summary renders without the branch button on unmanaged environments.",
  ),
  makeStoryQueuedMessage(
    "q_3",
    "Edit this queued prompt in the expanded workspace and keep the same real composer.",
  ),
  makeStoryQueuedMessage("q_4", "Compare the queue in light and dark themes."),
  makeStoryQueuedMessage("q_5", "Verify keyboard reordering from each grip."),
  makeStoryQueuedMessage("q_6", "Run the prompt-box typecheck."),
  makeStoryQueuedMessage("q_7", "Review the queue at a narrow width."),
  makeStoryQueuedMessage("q_8", "Capture the final interaction states."),
];

type RowPermission = Parameters<typeof FollowUpPromptBox>[0]["permission"];

interface RowConfig {
  initialMessage?: string;
  initialMentions?: PromptTextMention[];
  submitMode: FollowUpSubmitMode;
  isFollowUpSubmitting?: boolean;
  threadRuntimeDisplayStatus?: FollowUpComposerRuntimeStatus;
  promptPlaceholder?: string;
  environmentSummary?: ReactNode | null;
  contextWindowUsage?: ThreadContextWindowUsage | null;
  stack?: ReactNode | null;
  queuedMessages?: readonly ThreadQueuedMessage[];
  collapseResetKey?: string;
  hideComposer?: boolean;
  execution?: ExecutionControlsProps;
  permission?: RowPermission;
  activePromptMode?: Parameters<
    typeof FollowUpPromptBox
  >[0]["activePromptMode"];
  readOnly?: boolean;
}

type FollowUpComposerRuntimeStatus = NonNullable<
  Parameters<typeof FollowUpPromptBox>[0]["composer"]
>["threadRuntimeDisplayStatus"];

function PromptStage({ children }: { children: ReactNode }) {
  return (
    <div className="w-full min-w-0 bg-background">
      <PageShell
        shellClassName="!mx-0 !mt-0 !h-auto !min-h-0 !flex-none md:!mx-0 md:!mt-0"
        scrollAreaClassName="hidden"
        footerClassName="chat-prompt-box"
        footer={children}
      >
        <span aria-hidden="true" />
      </PageShell>
    </div>
  );
}

function Row({
  initialMessage = "",
  initialMentions = [],
  submitMode,
  isFollowUpSubmitting = false,
  threadRuntimeDisplayStatus = "idle",
  promptPlaceholder,
  environmentSummary = localEnvironmentSummary,
  contextWindowUsage = null,
  stack = null,
  queuedMessages: initialQueuedMessages,
  collapseResetKey = "thr_demo",
  hideComposer = false,
  execution = baseExecution,
  permission = basePermission,
  activePromptMode = null,
  readOnly = false,
}: RowConfig) {
  const [message, setMessage] = useState(initialMessage);
  const [mentionRanges, setMentionRanges] =
    useState<PromptTextMention[]>(initialMentions);
  const [storyQueuedMessages, setStoryQueuedMessages] = useState(
    initialQueuedMessages ?? [],
  );
  const [inlineEditingQueuedMessage, setInlineEditingQueuedMessage] = useState<{
    draft: PromptDraftState;
    queuedMessageId: string;
    queuedMessageIndex: number;
  } | null>(null);
  const resolvedPlaceholder =
    promptPlaceholder ??
    getFollowUpPromptPlaceholder(threadRuntimeDisplayStatus);
  const resolvedCompactPlaceholder =
    promptPlaceholder ??
    getCompactFollowUpPromptPlaceholder(threadRuntimeDisplayStatus);
  const handleChangeMessage = (
    nextMessage: string,
    nextMentions: PromptTextMention[],
  ) => {
    setMessage(nextMessage);
    setMentionRanges(nextMentions);
  };
  const handleChangeInlineMessage = useCallback(
    (nextMessage: string, nextMentions: PromptTextMention[]) => {
      setInlineEditingQueuedMessage((current) =>
        current
          ? {
              ...current,
              draft: {
                ...current.draft,
                mentions: nextMentions,
                text: nextMessage,
              },
            }
          : current,
      );
    },
    [],
  );
  const dismissInlineEditor = useCallback(() => {
    setInlineEditingQueuedMessage(null);
  }, []);
  const handleEditQueuedMessage = useCallback(
    ({ queuedMessageId, queuedMessageIndex }: QueuedMessageEditRequest) => {
      const queuedMessage = storyQueuedMessages.find(
        (candidate) => candidate.id === queuedMessageId,
      );
      if (!queuedMessage) return;
      setInlineEditingQueuedMessage({
        draft: queuedInputToDraft(queuedMessage.content),
        queuedMessageId,
        queuedMessageIndex,
      });
    },
    [storyQueuedMessages],
  );
  const handleSubmit = useCallback(() => {
    if (!inlineEditingQueuedMessage) return;
    const input = promptDraftToInput(inlineEditingQueuedMessage.draft);
    if (input.length === 0) return;
    setStoryQueuedMessages((current) =>
      current.map((queuedMessage) =>
        queuedMessage.id === inlineEditingQueuedMessage.queuedMessageId
          ? { ...queuedMessage, content: input, updatedAt: Date.now() }
          : queuedMessage,
      ),
    );
    dismissInlineEditor();
  }, [dismissInlineEditor, inlineEditingQueuedMessage]);
  const inlineEditor = useMemo<QueuedMessageInlineEditor | undefined>(
    () =>
      inlineEditingQueuedMessage
        ? {
            queuedMessageId: inlineEditingQueuedMessage.queuedMessageId,
            queuedMessageIndex: inlineEditingQueuedMessage.queuedMessageIndex,
            content: (
              <FollowUpPromptBox
                attachments={attachmentsBase}
                stack={null}
                composer={{
                  history: {
                    currentDraft: inlineEditingQueuedMessage.draft,
                    entries: [],
                    onSelectEntry: noop,
                  },
                  isFollowUpSubmitting: false,
                  message: inlineEditingQueuedMessage.draft.text,
                  mentionRanges: inlineEditingQueuedMessage.draft.mentions,
                  onChangeMessage: handleChangeInlineMessage,
                  onModifierSubmit: handleSubmit,
                  onSubmit: handleSubmit,
                  compactPromptPlaceholder: resolvedCompactPlaceholder,
                  promptPlaceholder: resolvedPlaceholder,
                  canModifierSubmit: true,
                  steerActiveThreadOnEnter: false,
                  submitMode: { kind: "ready" },
                  threadRuntimeDisplayStatus,
                }}
                environmentSummary={null}
                contextWindowUsage={null}
                execution={execution}
                executionReadOnly
                permission={permission}
                permissionReadOnly
                promptActions={promptActions}
                typeahead={typeaheadBase}
                collapseResetKey={`${collapseResetKey}:queued-message`}
                isPrimaryComposer={false}
                showScrollToBottomButton={false}
              />
            ),
            onDismiss: dismissInlineEditor,
          }
        : undefined,
    [
      dismissInlineEditor,
      execution,
      handleChangeInlineMessage,
      handleSubmit,
      inlineEditingQueuedMessage,
      permission,
      resolvedCompactPlaceholder,
      resolvedPlaceholder,
      threadRuntimeDisplayStatus,
      collapseResetKey,
    ],
  );
  const queueElement =
    initialQueuedMessages === undefined ? null : (
      <QueuedMessagesList
        attachedToComposer={true}
        queuedMessages={storyQueuedMessages}
        inlineEditor={inlineEditor}
        sendAction="send-now"
        sendDisabled={false}
        actionDisabled={false}
        processingMessageId={null}
        processingAction={null}
        onSend={(id) =>
          setStoryQueuedMessages((current) =>
            current.filter((message) => message.id !== id),
          )
        }
        onReorder={noop}
        onSetGroupBoundary={noop}
        onEdit={handleEditQueuedMessage}
        onDelete={(id) =>
          setStoryQueuedMessages((current) =>
            current.filter((message) => message.id !== id),
          )
        }
      />
    );
  const resolvedStack = queueElement ? (
    <>
      {stack}
      {queueElement}
    </>
  ) : (
    stack
  );
  return (
    <PromptStage>
      <FollowUpPromptBox
        attachments={attachmentsBase}
        stack={resolvedStack}
        composer={
          hideComposer
            ? null
            : {
                history: {
                  currentDraft: {
                    text: message,
                    mentions: mentionRanges,
                    attachments: [],
                  },
                  entries: historyEntries,
                  onSelectEntry: noop,
                },
                isFollowUpSubmitting,
                message,
                mentionRanges,
                onChangeMessage: handleChangeMessage,
                onModifierSubmit: noop,
                onSubmit: noop,
                compactPromptPlaceholder: resolvedCompactPlaceholder,
                promptPlaceholder: resolvedPlaceholder,
                canModifierSubmit: submitMode.kind === "queue",
                steerActiveThreadOnEnter: false,
                submitMode,
                threadRuntimeDisplayStatus,
              }
        }
        environmentSummary={environmentSummary}
        contextWindowUsage={contextWindowUsage}
        execution={execution}
        permission={permission}
        activePromptMode={activePromptMode}
        promptActions={promptActions}
        executionReadOnly={readOnly}
        permissionReadOnly={readOnly}
        typeahead={typeaheadBase}
        collapseResetKey={collapseResetKey}
      />
    </PromptStage>
  );
}

function StackedCardsWithPillsRow() {
  return (
    <Row
      submitMode={{ kind: "queue", onStop: noop }}
      threadRuntimeDisplayStatus="active"
      initialMessage={stackedCardsWithPillsMessage}
      initialMentions={stackedCardsWithPillsMentions}
      stack={contextBannerElement}
      queuedMessages={queuedMessages}
      contextWindowUsage={usage}
      environmentSummary={multiMachineEnvironmentSummary}
    />
  );
}

function InteractiveRow() {
  const execution = useInteractiveExecutionControls(baseExecution);
  return (
    <ModelPickerStoryQueryProvider>
      <Row submitMode={{ kind: "ready" }} execution={execution} />
    </ModelPickerStoryQueryProvider>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="ready"
        hint="interactive provider, model, reasoning, and fast mode"
      >
        <InteractiveRow />
      </StoryRow>
      <StoryRow
        label="loading models"
        hint="locked provider while execution options load"
      >
        <Row
          submitMode={{ kind: "ready" }}
          execution={{
            ...baseExecution,
            model: {
              ...baseExecution.model,
              active: null,
              selected: "",
              options: [],
              isLoading: true,
              loadFailed: false,
            },
          }}
          environmentSummary={namedLocalEnvironmentSummary}
        />
      </StoryRow>
      <StoryRow
        label="model load failed"
        hint="locked provider with structured modelLoadError"
      >
        <Row
          submitMode={{ kind: "ready" }}
          execution={{
            ...baseExecution,
            model: {
              ...baseExecution.model,
              active: null,
              selected: "",
              options: [],
              isLoading: false,
              loadFailed: true,
              loadError: codexModelLoadError,
            },
          }}
          environmentSummary={multiMachineEnvironmentSummary}
        />
      </StoryRow>
      <StoryRow label="no models" hint="locked provider with empty catalog">
        <Row
          submitMode={{ kind: "ready" }}
          execution={{
            ...baseExecution,
            model: {
              ...baseExecution.model,
              active: null,
              selected: "",
              options: [],
              isLoading: false,
              loadFailed: false,
              loadError: null,
            },
          }}
          environmentSummary={detachedWorktreeEnvironmentSummary}
        />
      </StoryRow>
      <StoryRow label="with promptbox context banner">
        <Row
          submitMode={{ kind: "ready" }}
          stack={contextBannerElement}
          environmentSummary={localEnvironmentSummary}
        />
      </StoryRow>
      <StoryRow
        label="archived: composer hidden"
        hint="read-only banner remains; prompt input and footer controls are collapsed"
      >
        <Row
          submitMode={{ kind: "blocked", reason: "pending-interaction" }}
          stack={archivedContextBannerElement}
          hideComposer
        />
      </StoryRow>
      <StoryRow
        label="environment gone: composer hidden"
        hint="destroyed environment uses the prompt context banner path"
      >
        <Row
          submitMode={{ kind: "blocked", reason: "pending-interaction" }}
          stack={environmentGoneContextBannerElement}
          hideComposer
        />
      </StoryRow>
      <StoryRow
        label="stacked cards with Markdown + pills"
        hint="collapse on mobile to verify the quoted prompt and pills truncate to one line"
      >
        <StackedCardsWithPillsRow />
      </StoryRow>
      <StoryRow
        label="provisioning"
        hint="runtime loading icon + lifecycle label"
      >
        <Row
          submitMode={{ kind: "queue", onStop: noop }}
          threadRuntimeDisplayStatus="starting"
          environmentSummary={provisioningEnvironmentSummary}
        />
      </StoryRow>
      <StoryRow
        label="ready · one machine"
        hint="provider name; the machine is unambiguous so it stays hidden"
      >
        <Row
          submitMode={{ kind: "ready" }}
          environmentSummary={localEnvironmentSummary}
        />
      </StoryRow>
      <StoryRow
        label="ready · personal workspace"
        hint="no project chip, no branch; the provider names the environment"
      >
        <Row
          submitMode={{ kind: "ready" }}
          environmentSummary={personalEnvironmentSummary}
        />
      </StoryRow>
      <StoryRow
        label="ready · second machine"
        hint="machine name once more than one machine exists"
      >
        <Row
          submitMode={{ kind: "ready" }}
          environmentSummary={multiMachineEnvironmentSummary}
        />
      </StoryRow>
      <StoryRow
        label="ready · worktree on a sandbox"
        hint="an ephemeral host is ambiguous, so it is named"
      >
        <Row
          submitMode={{ kind: "ready" }}
          environmentSummary={sandboxWorktreeEnvironmentSummary}
        />
      </StoryRow>
      <StoryRow
        label="ready · named environment"
        hint="a custom name wins over both machine and provider"
      >
        <Row
          submitMode={{ kind: "ready" }}
          environmentSummary={namedLocalEnvironmentSummary}
        />
      </StoryRow>
      <StoryRow
        label="ready · detached worktree"
        hint="provider icon · detached commit checkout"
      >
        <Row
          submitMode={{ kind: "ready" }}
          environmentSummary={detachedWorktreeEnvironmentSummary}
        />
      </StoryRow>
      <StoryRow
        label="destroyed environment"
        hint="lifecycle label replaces the provider name"
      >
        <Row
          submitMode={{ kind: "ready" }}
          environmentSummary={destroyedEnvironmentSummary}
        />
      </StoryRow>
      <StoryRow
        label="env: long machine name"
        hint="full machine name when space allows; truncates with a title when constrained"
      >
        <Row
          submitMode={{ kind: "ready" }}
          environmentSummary={longHostEnvironmentSummary}
        />
      </StoryRow>
      <StoryRow
        label="eight queued follow-ups"
        hint="the centered handle stays quiet; hover the header to reveal the right-aligned caret"
      >
        <Row
          submitMode={{ kind: "queue", onStop: noop }}
          threadRuntimeDisplayStatus="active"
          queuedMessages={queuedMessages}
          contextWindowUsage={usage}
        />
      </StoryRow>
      <StoryRow
        label="read-only footer"
        hint="same model & permission pickers as the main thread, just disabled"
      >
        <Row
          submitMode={{ kind: "ready" }}
          execution={readOnlyExecution}
          permission={readOnlyPermission}
          readOnly
          environmentSummary={multiMachineEnvironmentSummary}
        />
      </StoryRow>
    </StoryCard>
  );
}

