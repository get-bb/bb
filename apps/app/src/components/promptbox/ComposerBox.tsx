import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { QueryClientContext } from "@tanstack/react-query";
import type {
  ComposerView,
  ComposerAttachment,
  ExperimentalComposerAction,
  ExperimentalComposerContributions,
  ExperimentalComposerEditor,
  ExperimentalComposerEditorVoice,
  ExperimentalComposerAttachments,
  ExperimentalComposerHistory,
  ExperimentalComposerInput,
  ExperimentalComposerPromptAction,
  ExperimentalComposerRendererApi,
  ExperimentalComposerSubmission,
  ExperimentalComposerVoice,
  PluginComposerScope,
  PluginMentionTrigger,
} from "@get-bb/plugin-sdk";
import type { ThreadResponse } from "@bb/server-contract";
import {
  composerDraftFromPromptDraft,
  DEFAULT_PLUGIN_MENTION_TRIGGER,
  promptDraftFromComposerDraft,
  type PromptDraftAttachment,
  type PromptDraftState,
  type PromptMentionLinkResolver,
} from "@bb/client-core";
import { isProjectAttachmentPath } from "@/lib/file-content-urls";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import type { PromptTextMention } from "@bb/domain";
import { composerMentionResource } from "./mentions/prompt-mention-pill";
import {
  PluginSlotMount,
  resetCrashedPluginSlots,
} from "@/components/plugin/PluginSlotMount";
import {
  PluginComposerHostProvider,
  PluginComposerViewProvider,
  useComposerHostDraftNotifier,
  useOptionalPluginComposerView,
  usePluginComposerHost,
  type PluginComposerHost,
  usePluginComposerViewModel,
} from "@/components/plugin/plugin-composer-host";
import {
  useResolvedComposerEditor,
  useResolvedComposerPlusMenuItems,
  useResolvedComposerPopups,
  useResolvedComposerSendMenuItems,
} from "@/components/plugin/composer-slot-hooks";
import {
  useAppCommandKeyDispatch,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import { useAttachmentOpener } from "@/components/secondary-panel/AttachmentOpenerContext";
import { useThreadTitleMentionResources } from "@/components/thread/ThreadTitleMentions";
import { appToast } from "@/components/ui/app-toast";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import {
  voiceUnsupportedMessage,
  type VoiceUnsupportedReason,
} from "@/hooks/voice-input-support";
import {
  getLocalAttachmentPreviewSrc,
  releaseLocalAttachmentPreview,
} from "@/lib/attachment-local-previews";
import {
  clearComposerEditorBridge,
  publishComposerEditorBridge,
} from "@/lib/composer-editor-registry";
import type {
  ComposerEditorState,
  ComposerEditorSubmission,
  ComposerSubmitExtras,
} from "@get-bb/plugin-sdk/internal/composer-handle";
import {
  readMessageClipboardHtml,
  readMessageClipboardImage,
} from "@/lib/message-clipboard";
import {
  usePluginFrontendLoadFailed,
  usePluginFrontendsSettled,
} from "@/lib/plugin-frontend-boot-state";
import { schedulePluginFrontendReconcile } from "@/lib/plugin-frontend-lazy";
import { useComposerInputLock } from "@/lib/plugin-sdk-hooks";
import { sdk } from "@/lib/sdk";
import {
  parseThreadLink,
  resolveThreadMentionsInBatches,
} from "@/lib/thread-links";
import { toUserAttachmentImageSrc } from "@/lib/user-attachment-images";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import { ComposerPlaceholder } from "./ComposerPlaceholder";
import { PluginComposerPopup } from "@/components/plugin/PluginComposerPopup";
import {
  ComposerContributionsContext,
  ComposerMenuEntry,
  ComposerPluginActions,
  ComposerRootHostContext,
  NoComposerPluginActions,
  type ComposerRootHost,
} from "./composer-root";
import {
  composerDecorationSources,
  createDraftObserverRunner,
} from "./composer-decorations";
import type { ComposerTextEffectSource } from "@/lib/composer-text-effects";
import { useComposerReplacement } from "./composer-provider";
import { QueuedEditorTypeaheadLayoutContext } from "./queued-editor-typeahead-layout";
import { ComposerSearchProvider } from "./composer-search";
import type { CommandSuggestionSource } from "@/hooks/useCommandSuggestions";
import type { PromptMentionSource } from "@/hooks/usePromptMentions";
import { ComposerMaxHeightContext } from "./composer-max-height";
import {
  modifierSubmitShortcutAria,
  modifierSubmitShortcutLabel,
} from "./modifier-submit-shortcut";

interface TypeaheadMentionConfig {
  triggers?: readonly PluginMentionTrigger[];
  source: PromptMentionSource;
  resolveLink?: PromptMentionLinkResolver;
}
interface TypeaheadCommandConfig {
  source: CommandSuggestionSource;
}
export interface TypeaheadConfig {
  mention: TypeaheadMentionConfig;
  command: TypeaheadCommandConfig;
}
export interface AttachmentsConfig extends Omit<
  ExperimentalComposerAttachments,
  "items" | "onAttachFiles" | "onUpdate"
> {
  items?: PromptDraftAttachment[];
  onAttachFiles?(files: File[]): Promise<PromptDraftAttachment[]>;
  onUpdate?(
    update: (attachments: PromptDraftAttachment[]) => PromptDraftAttachment[],
  ): void;
}
export interface HistoryConfig {
  currentDraft: PromptDraftState;
  entries: readonly PromptDraftState[];
  onSelectEntry(draft: PromptDraftState): void;
  resetKey?: string | number;
}
export interface PromptBoxHandle {
  focusEnd(): void;
  readonly voice: ExperimentalComposerEditorVoice | null;
}
export type PromptBoxAction = ExperimentalComposerPromptAction;
export type MentionMenuPlacement =
  ExperimentalComposerInput["mentionMenuPlacement"];

export const DEFAULT_COMPOSER_SCOPE = {
  kind: "new-thread",
  projectId: null,
} as const satisfies PluginComposerScope;

export interface PromptVoiceConfig extends Omit<
  ExperimentalComposerVoice,
  "unsupportedMessage"
> {
  unsupportedReason?: VoiceUnsupportedReason | null;
}

export interface PromptBoxSubmissionConfig extends Omit<
  ExperimentalComposerSubmission,
  "enter" | "modifier" | "showModifierInMenu"
> {
  onModifierSubmit?: (extras?: ComposerSubmitExtras) => void | Promise<void>;
  queuesDraft?: boolean;
  swapSubmitActions?: boolean;
  showModifierSubmitAction?: boolean;
}

export type ComposerBoxProps = Omit<
  ExperimentalComposerInput,
  | "voice"
  | "submission"
  | "mentionTriggers"
  | "commandTriggers"
  | "resolveMentionLink"
  | "attachments"
  | "history"
> & {
  typeahead: TypeaheadConfig;
  attachments?: AttachmentsConfig;
  history?: HistoryConfig;
  value: string;
  mentionRanges: readonly PromptTextMention[];
  onChange(value: string, mentionRanges: PromptTextMention[]): void;
  onSubmit(extras?: ComposerSubmitExtras): void | Promise<void>;
  submission?: PromptBoxSubmissionConfig;
  textEffects?: readonly ComposerTextEffectSource[];
  voice?: PromptVoiceConfig;
  promptBoxRef?: Ref<PromptBoxHandle>;
  onFocusCommand?(): void;
  suppressPluginComposerCustomizations?: boolean;
  onComposerLayoutChange?(layout: ComposerView["layout"]): void;
  focusEndKey?: string | number;
};

const EMPTY_ATTACHMENTS: PromptDraftAttachment[] = [];

const COMPOSER_SLOT_KIND = "composer";

const ignoreReportedSubmitError = () => {};

const ENTER_SHORTCUT = { label: "Enter", ariaKeyshortcuts: "Enter" };

function composerSubmission(
  submission: PromptBoxSubmissionConfig | undefined,
  onSubmit: ComposerBoxProps["onSubmit"],
): ExperimentalComposerSubmission {
  const {
    onModifierSubmit,
    queuesDraft = false,
    swapSubmitActions = false,
    showModifierSubmitAction = false,
    ...state
  } = submission ?? {};
  const runReported =
    (handler: () => void | Promise<void>): ExperimentalComposerAction["run"] =>
    () => {
      void Promise.resolve(handler()).catch(ignoreReportedSubmitError);
    };
  const draft = {
    kind: queuesDraft || swapSubmitActions ? "queue" : "send",
    requiresInput: true,
    run: runReported(() => onSubmit()),
  } as const;
  const steer =
    onModifierSubmit === undefined
      ? null
      : ({
          kind: "steer",
          requiresInput: false,
          run: runReported(() => onModifierSubmit()),
        } as const);
  const [enter, modifier] =
    swapSubmitActions && steer !== null ? [steer, draft] : [draft, steer];
  return {
    ...state,
    enter: { ...enter, shortcut: ENTER_SHORTCUT },
    modifier:
      modifier === null
        ? null
        : {
            ...modifier,
            shortcut: {
              label: modifierSubmitShortcutLabel(),
              ariaKeyshortcuts: modifierSubmitShortcutAria(),
            },
          },
    showModifierInMenu: showModifierSubmitAction,
  };
}

const ComposerRendererContext =
  createContext<ExperimentalComposerRendererApi | null>(null);

export function useComposerRendererApi(): ExperimentalComposerRendererApi {
  const api = useContext(ComposerRendererContext);
  if (api === null) {
    throw new Error(
      "experimental_useComposerRenderer() is only available inside an experimental_composer component.",
    );
  }
  return api;
}

function composerVoice(
  voice: PromptVoiceConfig | undefined,
): ExperimentalComposerVoice | undefined {
  if (voice === undefined) return undefined;
  const { unsupportedReason, ...rest } = voice;
  return {
    ...rest,
    unsupportedMessage: voiceUnsupportedMessage(unsupportedReason ?? null),
  };
}

const DEFAULT_MENTION_TRIGGERS: readonly PluginMentionTrigger[] = [
  DEFAULT_PLUGIN_MENTION_TRIGGER,
];

interface MentionLinkSources {
  resolveLink: PromptMentionLinkResolver | undefined;
  attachments: readonly PromptDraftAttachment[];
  attachmentProjectId: string | undefined;
  openAttachment: ReturnType<typeof useAttachmentOpener>;
}

function mentionLinkResolver({
  resolveLink,
  attachments,
  attachmentProjectId,
  openAttachment,
}: MentionLinkSources): ExperimentalComposerInput["resolveMentionLink"] {
  return (mention) => {
    if (mention.kind !== "attachment") {
      return resolveLink?.(composerMentionResource(mention)) ?? null;
    }
    const attachment = attachments.find((item) => item.path === mention.path);
    const projectId = attachment?.sourceProjectId ?? attachmentProjectId;
    if (
      !attachment ||
      !openAttachment ||
      !projectId ||
      !isProjectAttachmentPath(attachment)
    ) {
      return null;
    }
    return () =>
      openAttachment({
        name: attachment.name,
        path: attachment.path,
        projectId,
      });
  };
}

function composerAttachments(
  attachments: AttachmentsConfig | undefined,
): ExperimentalComposerAttachments | undefined {
  if (attachments === undefined) return undefined;
  const { onUpdate, ...rest } = attachments;
  return {
    ...rest,
    onUpdate:
      onUpdate &&
      ((update) =>
        onUpdate((current) =>
          update(current).map(promptDraftAttachmentFromComposer),
        )),
  };
}

function promptDraftAttachmentFromComposer(
  attachment: ComposerAttachment,
): PromptDraftAttachment {
  return { ...attachment };
}

function composerHistory(
  history: HistoryConfig | undefined,
): ExperimentalComposerHistory | undefined {
  if (history === undefined) return undefined;
  return {
    currentDraft: composerDraftFromPromptDraft(history.currentDraft),
    entries: history.entries.map(composerDraftFromPromptDraft),
    onSelectEntry: (draft) =>
      history.onSelectEntry(promptDraftFromComposerDraft(draft)),
    resetKey: history.resetKey,
  };
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

function useComposerRendererHostApi({
  value,
  mentionRanges,
  onChange,
  onSubmit,
  submission,
  textEffects,
  voice,
  promptBoxRef,
  onComposerLayoutChange,
  focusEndKey,
  onFocusCommand,
  suppressPluginComposerCustomizations: suppress = false,
  typeahead,
  attachments,
  history,
  ...input
}: ComposerBoxProps): {
  api: ExperimentalComposerRendererApi;
  boxHost: PluginComposerHost;
  rootHost: ComposerRootHost;
  contributions: ExperimentalComposerContributions;
  typeahead: TypeaheadConfig;
} {
  const host = usePluginComposerHost();
  const syntheticKey = useId();
  const [layout, setLayout] = useState<ComposerView["layout"]>("expanded");
  const handleLayoutChange = (next: ComposerView["layout"]) => {
    setLayout(next);
    onComposerLayoutChange?.(next);
  };
  const localView = usePluginComposerViewModel({
    scope: host?.scope ?? DEFAULT_COMPOSER_SCOPE,
    layout,
    text: value,
    attachmentCount: attachments?.items?.length ?? 0,
    isRunning: submission?.isRunning ?? false,
    isSubmitting: submission?.isSubmitting ?? false,
  });
  const view = useOptionalPluginComposerView() ?? localView;
  const pluginScopeKind = suppress ? null : view.scope.kind;
  const resolvedEditor = useResolvedComposerEditor(pluginScopeKind);
  const popups = useResolvedComposerPopups(pluginScopeKind);
  const plusMenuItems = useResolvedComposerPlusMenuItems(view.scope.kind);
  const sendMenuItems = useResolvedComposerSendMenuItems(pluginScopeKind);
  const draftAttachments = attachments?.items ?? EMPTY_ATTACHMENTS;
  const onUpdateAttachments = attachments?.onUpdate;
  const draft = useMemo<PromptDraftState>(
    () => ({
      text: value,
      mentions: [...mentionRanges],
      attachments: draftAttachments,
    }),
    [draftAttachments, mentionRanges, value],
  );
  const subscribeDraft = useComposerHostDraftNotifier(draft);
  const previousAttachmentPathsRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const paths = new Set(draftAttachments.map((item) => item.path));
    for (const path of previousAttachmentPathsRef.current) {
      if (!paths.has(path)) releaseLocalAttachmentPreview(path);
    }
    previousAttachmentPathsRef.current = paths;
  }, [draftAttachments]);
  const submitForPlugin =
    (state: ComposerEditorState) =>
    async ({ mode, ...extras }: ComposerEditorSubmission) => {
      if (host?.sendsOnEnter !== true) {
        throw new Error("This composer cannot submit programmatically.");
      }
      const current = host.getCurrent();
      if (
        current.text.trim().length === 0 &&
        current.attachments.length === 0
      ) {
        throw new Error("Type a message first.");
      }
      const onModifierSubmit = submission?.onModifierSubmit;
      const runsSteer =
        mode === "steer-if-active"
          ? onModifierSubmit !== undefined
          : mode === "enter" && submission?.swapSubmitActions === true;
      const run = runsSteer ? onModifierSubmit : onSubmit;
      const voiceActive =
        voice?.state === "recording" || voice?.state === "transcribing";
      if (
        run === undefined ||
        state.isAttaching ||
        state.isSubmitting ||
        submission?.disabled === true ||
        voiceActive
      ) {
        throw new Error(
          state.submittingBlockedReason ??
            "This composer can't submit right now.",
        );
      }
      await run(extras);
    };
  const boxHost: PluginComposerHost = {
    ...(host ?? {
      scope: DEFAULT_COMPOSER_SCOPE,
      textEffectKey: `composer-box:${syntheticKey}`,
      focus: () => {},
    }),
    getCurrent: () => draft,
    subscribeDraft,
    setDraft: (next) => {
      onChange(next.text, next.mentions);
      if (next.attachments !== draft.attachments) {
        onUpdateAttachments?.(() => next.attachments);
      }
    },
  };
  const key = boxHost.textEffectKey;
  const inputLocked = useComposerInputLock(key);
  const focusComposerShortcut = useAppCommandShortcut("composer.focus");
  const dispatchAppCommandKey = useAppCommandKeyDispatch();
  const openAttachment = useAttachmentOpener();
  const threadTitleResources = useThreadTitleMentionResources();
  const queryClient = useContext(QueryClientContext);
  const reportTypeaheadLayout = useContext(QueuedEditorTypeaheadLayoutContext);
  const isFocusedPane = useOptionalPaneContext()?.isFocused ?? true;
  const availableMaxHeight = useContext(ComposerMaxHeightContext);
  const maxHeight = input.maxHeight ?? availableMaxHeight;

  const decorationSources = composerDecorationSources(
    resolvedEditor.effects,
    textEffects ?? [],
  );
  const [draftObserverRunner] = useState(createDraftObserverRunner);
  useEffect(() => {
    draftObserverRunner.update({
      text: value,
      mentions: mentionRanges,
      view,
      observers: resolvedEditor.observers,
    });
  });
  useEffect(() => () => draftObserverRunner.dispose(), [draftObserverRunner]);
  const registerEditor: ComposerRootHost["registerEditor"] = (editor) => {
    if (editor.state.layout !== layout) handleLayoutChange(editor.state.layout);
    const bridge = {
      host: host ?? boxHost,
      pluginCustomizable: host !== null && !suppress,
      ...editor,
      submit: submitForPlugin(editor.state),
    };
    publishComposerEditorBridge(key, bridge);
    return () => clearComposerEditorBridge(key, bridge);
  };
  const getCachedThreadLink = (threadId: string) => {
    const thread =
      threadTitleResources.threadById.get(threadId) ??
      queryClient?.getQueryData<ThreadResponse>(threadQueryKey(threadId));
    return thread
      ? {
          threadId,
          projectId: thread.projectId,
          label: getThreadDisplayTitle(thread),
        }
      : null;
  };

  const mentionTriggers =
    typeahead.mention.triggers ?? DEFAULT_MENTION_TRIGGERS;
  const api: ExperimentalComposerRendererApi = {
    input: {
      ...input,
      ...(maxHeight === undefined ? {} : { maxHeight }),
      submission: composerSubmission(submission, onSubmit),
      voice: composerVoice(voice),
      mentionTriggers,
      commandTriggers: typeahead.command.source.skillsTriggers.filter(
        (trigger) => !mentionTriggers.some((mention) => mention === trigger),
      ),
      resolveMentionLink: mentionLinkResolver({
        resolveLink: typeahead.mention.resolveLink,
        attachments: draftAttachments,
        attachmentProjectId: attachments?.projectId,
        openAttachment,
      }),
      attachments: composerAttachments(attachments),
      history: composerHistory(history),
    },
    view,
    key,
    inputLocked,
    focusComposerShortcut,
    decorationSources,
    threadLinks: {
      parse: (url) => parseThreadLink(url, window.location.origin),
      cached: getCachedThreadLink,
      resolve: (threadIds, signal, onBatch) =>
        resolveThreadMentionsInBatches(
          threadIds,
          (batch, batchSignal) =>
            sdk.threads.resolveMentions({
              threadIds: batch,
              signal: batchSignal,
            }),
          signal,
          ({ threads }) => onBatch(threads),
        ),
    },
    clipboard: {
      readMessage: readMessageClipboardHtml,
      readMessageImage: readMessageClipboardImage,
    },
    dispatchAppCommandKey,
    showError: (message) => appToast.error(message),
    attachmentSrc: (path, projectId) =>
      getLocalAttachmentPreviewSrc(path) ??
      toUserAttachmentImageSrc(path, projectId),
  };
  const getEditorRef = useRef<(() => ExperimentalComposerEditor) | null>(null);
  const lastFocusEndKeyRef = useRef(focusEndKey);
  useLayoutEffect(() => {
    if (focusEndKey === undefined) return;
    if (focusEndKey === lastFocusEndKeyRef.current) return;
    lastFocusEndKeyRef.current = focusEndKey;
    getEditorRef.current?.().focusEnd();
  }, [focusEndKey]);
  const attachEditor: ComposerRootHost["attachEditor"] = (getEditor) => {
    getEditorRef.current = getEditor;
    assignRef(promptBoxRef, {
      focusEnd: () => getEditor().focusEnd(),
      get voice() {
        return getEditor().voice ?? null;
      },
    });
    return () => {
      getEditorRef.current = null;
      assignRef(promptBoxRef, null);
    };
  };
  const rootHost: ComposerRootHost = {
    key,
    registerEditor,
    attachEditor,
    onFocusCommand,
    reportMenuLayout: reportTypeaheadLayout,
    runsPluginCommands: host !== null && !suppress,
    isFocusedPane,
  };
  const contributions: ExperimentalComposerContributions = {
    popups,
    plusMenuItems,
    sendMenuItems,
    Actions: suppress ? NoComposerPluginActions : ComposerPluginActions,
    Popup: PluginComposerPopup,
    MenuEntry: ComposerMenuEntry,
  };
  return { api, boxHost, rootHost, contributions, typeahead };
}

export function ComposerRendererHostProvider({
  children,
  ...props
}: ComposerBoxProps & { children: ReactNode }) {
  const { api, boxHost, rootHost, contributions, typeahead } =
    useComposerRendererHostApi(props);
  return (
    <ComposerRendererContext.Provider value={api}>
      <ComposerRootHostContext.Provider value={rootHost}>
        <ComposerContributionsContext.Provider value={contributions}>
          <PluginComposerViewProvider value={api.view}>
            <PluginComposerHostProvider value={boxHost}>
              <ComposerSearchProvider typeahead={typeahead}>
                {children}
              </ComposerSearchProvider>
            </PluginComposerHostProvider>
          </PluginComposerViewProvider>
        </ComposerContributionsContext.Provider>
      </ComposerRootHostContext.Provider>
    </ComposerRendererContext.Provider>
  );
}

export function ComposerBox(props: ComposerBoxProps) {
  const replacement = useComposerReplacement();
  const bootSettled = usePluginFrontendsSettled();
  const loadFailed = usePluginFrontendLoadFailed();
  const [attempt, setAttempt] = useState(0);
  const registration =
    replacement.kind === "plugin" ? replacement.registration : null;
  const pluginId = registration?.pluginId ?? null;
  const handleReload = useCallback(() => {
    if (pluginId !== null) resetCrashedPluginSlots(pluginId);
    setAttempt((current) => current + 1);
  }, [pluginId]);
  const handleCrash = useCallback(
    (crashedPluginId: string) => {
      appToast.error("Composer plugin crashed", {
        description: `${registration?.title ?? "Composer"} (${crashedPluginId}) stopped working.`,
      });
    },
    [registration?.title],
  );

  if (registration === null) {
    return (
      <ComposerPlaceholder
        state={
          !bootSettled
            ? {
                kind: "loading",
                shape:
                  props.surface === "new-thread"
                    ? "new-thread"
                    : props.compact?.when === "always"
                      ? "thread-compact"
                      : "thread",
              }
            : loadFailed
              ? { kind: "failed", onRetry: schedulePluginFrontendReconcile }
              : { kind: "missing" }
        }
      />
    );
  }
  const Composer = registration.component;
  return (
    <ComposerRendererHostProvider {...props}>
      <div data-composer-box="" className="w-full">
        <PluginSlotMount
          key={`${registration.pluginId}/${registration.id}/${registration.generation}/${attempt}`}
          pluginId={registration.pluginId}
          slotKind={COMPOSER_SLOT_KIND}
          slotId={registration.id}
          crashFallback={
            <ComposerPlaceholder
              state={{
                kind: "crashed",
                pluginTitle: registration.title,
                onReload: handleReload,
              }}
            />
          }
          onCrash={handleCrash}
        >
          <Composer />
        </PluginSlotMount>
      </div>
    </ComposerRendererHostProvider>
  );
}
