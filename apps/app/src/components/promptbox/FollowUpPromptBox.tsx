import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type {
  PromptTextMention,
  ThreadRuntimeDisplayStatus,
  ThreadTimelineActivePromptMode,
} from "@bb/domain";
import type { ComposerView, PluginComposerScope } from "@get-bb/plugin-sdk";
import type { ComposerTextEffectSource } from "@/lib/composer-text-effects";
import { ComposerBannersSlot } from "@/components/plugin/PluginComposerBanners";
import {
  PluginComposerHostProvider,
  PluginComposerViewProvider,
  type PluginComposerHost,
  usePluginComposerViewModel,
} from "@/components/plugin/plugin-composer-host";
import {
  ComposerExtensionHost,
  useComposerExtensionController,
} from "@/components/plugin/ComposerExtensionHost";
import {
  PromptBoxInternal,
  type AttachmentsConfig,
  type HistoryConfig,
  type PromptBoxAction,
  type PromptBoxHandle,
  type TypeaheadConfig,
} from "@/components/promptbox/PromptBoxInternal";
import { usePromptVoice } from "@/components/promptbox/usePromptVoice";
import { PermissionModePicker } from "@/components/pickers/PermissionModePicker";
import {
  ExecutionControls,
  type ExecutionControlsProps,
  type ExecutionPermissionConfig,
} from "@/components/promptbox/ExecutionControls";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { ThreadTimelineScrollToBottomButton } from "@/views/thread-detail/ThreadTimelineScrollToBottomButton";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import { ThreadContextWindowIndicator } from "@/components/thread/timeline";
import { THREAD_PROMPT_CONTEXT_BANNER_ROW_HEIGHT } from "@/components/promptbox/banner/ThreadPromptContextBanner";
import {
  permissionDisplayForActivePromptMode,
  permissionDisplayForPromptMode,
  shouldDisablePermissionPickerForActivePromptMode,
  shouldDisablePermissionPickerForPromptMode,
} from "./effective-prompt-mode";

type PromptBoxWithScrollAnchorProps = ComponentProps<
  typeof PromptBoxInternal
> & {
  scrollToBottomOnModifierSubmit?: boolean;
  scrollToBottomOnSubmit?: boolean;
};

function PromptBoxWithScrollAnchor({
  onSubmit,
  scrollToBottomOnModifierSubmit = true,
  scrollToBottomOnSubmit = true,
  submission,
  ...promptBoxProps
}: PromptBoxWithScrollAnchorProps) {
  const bottomAnchor = useBottomAnchoredScroll();
  const handleSubmit = () => {
    onSubmit();
    if (scrollToBottomOnSubmit) {
      bottomAnchor?.scrollToBottom();
    }
  };
  const handleModifierSubmit =
    submission?.onModifierSubmit === undefined
      ? undefined
      : () => {
          submission.onModifierSubmit?.();
          if (scrollToBottomOnModifierSubmit) {
            bottomAnchor?.scrollToBottom();
          }
        };
  const anchoredSubmission =
    submission === undefined
      ? undefined
      : {
          ...submission,
          ...(handleModifierSubmit
            ? { onModifierSubmit: handleModifierSubmit }
            : {}),
        };
  return (
    <PromptBoxInternal
      {...promptBoxProps}
      onSubmit={handleSubmit}
      submission={anchoredSubmission}
    />
  );
}

// Elastic compensation: when nothing is stacked above the textarea, the
// textarea defaults to FOLLOW_UP_PROMPT_BOX_ELASTIC_TARGET_HEIGHT so the
// prompt area is already at "with-banner" height on first paint. As the stack
// (context banner + queued messages) grows, the textarea min-height shrinks
// by the same amount — total prompt-area height stays constant and the
// thread timeline does not shift when the context banner mounts.
const FOLLOW_UP_PROMPT_BOX_DEFAULT_MIN_HEIGHT = 68;
const FOLLOW_UP_PROMPT_BOX_ELASTIC_TARGET_HEIGHT =
  FOLLOW_UP_PROMPT_BOX_DEFAULT_MIN_HEIGHT +
  THREAD_PROMPT_CONTEXT_BANNER_ROW_HEIGHT;
const OPEN_COMPOSER_OVERLAY_TRIGGER_SELECTOR =
  '[aria-haspopup][aria-expanded="true"]';
const MOBILE_KEYBOARD_VIEWPORT_MIN_DELTA_PX = 80;
const MOBILE_FOCUS_EXPANSION_FALLBACK_MS = 350;
const MOBILE_KEYBOARD_DISMISSAL_FALLBACK_MS = 750;
const DEFAULT_FOLLOW_UP_COMPOSER_SCOPE = {
  kind: "new-thread",
  projectId: null,
} as const;

function isKeyboardFocusTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  );
}
/**
 * Discriminated state for the composer's submit affordances. Replaces the
 * previous canSendFollowUp / canQueueFollowUp / canStopRuntime / onStop
 * boolean soup. The caller computes one of these from runtimeDisplayStatus +
 * pending-interaction state and passes it down; the composer reads .kind to
 * render submit/queue/stop affordances.
 */
export type FollowUpBlockedReason =
  | "loading-execution-options"
  | "loading-pending-interactions"
  | "pending-interaction"
  | "provisioning"
  | "stopping"
  | "unavailable";

export type FollowUpSubmitMode =
  /** Idle thread — submit creates a new turn; no stop affordance. */
  | { kind: "ready" }
  /** Runtime is active or host-reconnecting — submit queues the message; stop the runtime. */
  | { kind: "queue"; onStop: () => void }
  /** Runtime is pre-start or waiting on the host — can't send/queue, but can stop. */
  | { kind: "stop-only"; onStop: () => void }
  /** Can't submit and can't stop — show why. */
  | { kind: "blocked"; reason: FollowUpBlockedReason };

export interface FollowUpComposerProps {
  history: HistoryConfig;
  /** True while the send/queue mutation is in flight. Orthogonal to submitMode. */
  isFollowUpSubmitting: boolean;
  message: string;
  mentionRanges: readonly PromptTextMention[];
  onChangeMessage: (value: string, mentionRanges: PromptTextMention[]) => void;
  onModifierSubmit: () => void;
  onSubmit: () => void;
  /** Accessible label and tooltip for the primary submit action. */
  submitTitle?: string;
  compactPromptPlaceholder: string;
  promptPlaceholder: string;
  canModifierSubmit: boolean;
  /**
   * While the runtime is active, use Enter for steer and the modifier shortcut
   * for queue. False preserves the default Enter-to-queue behavior.
   */
  steerActiveThreadOnEnter: boolean;
  submitMode: FollowUpSubmitMode;
  /** Used by the scroll-to-bottom button to know whether the runtime is actively streaming. */
  threadRuntimeDisplayStatus: ThreadRuntimeDisplayStatus;
}

type ContextWindowUsage = ComponentProps<
  typeof ThreadContextWindowIndicator
>["usage"];

export interface FollowUpPromptBoxProps {
  id?: string;
  attachments: AttachmentsConfig;
  /**
   * Slot for the stack of context cards above the prompt input — today
   * <ContextBanner> + <QueuedMessagesList>, both wrapped in PromptStackCard
   * chrome. The caller composes whatever should render above the composer
   * and passes it as a single element. Pass null to hide the stack entirely.
   */
  stack: ReactNode | null;
  activePromptMode?: ThreadTimelineActivePromptMode | null;
  composer: FollowUpComposerProps | null;
  /** Slot for the read-only environment strip in the bottom row. Pass null to hide. */
  environmentSummary: ReactNode | null;
  /**
   * Token usage indicator shown to the right of the permission picker. Null
   * means no usage available yet (e.g. thread just created); the indicator is
   * hidden in that case.
   */
  contextWindowUsage: ContextWindowUsage | null;
  /**
   * Execution controls (provider + model + service tier + reasoning) rendered
   * in PromptBox's footer slot. Callers omit provider.onChange so the picker
   * renders the provider as locked — follow-ups can't change provider, the
   * thread is already committed.
   */
  execution: ExecutionControlsProps;
  /** Permission mode picker rendered in the bottom row. */
  permission: ExecutionPermissionConfig;
  /**
   * Render all footer controls (model/reasoning + permission pickers) as
   * non-interactive, dimmed labels. The composer text input stays editable.
   */
  readOnly?: boolean;
  /** Override only the execution controls' readonly state. */
  executionReadOnly?: boolean;
  /** Override only the permission picker's readonly state. */
  permissionReadOnly?: boolean;
  typeahead: TypeaheadConfig;
  promptActions?: readonly PromptBoxAction[];
  /** Suppress plugin customizations while a retained secondary composer is inactive. */
  suppressPluginComposerCustomizations?: boolean;
  /** Optional transient draft host exposed to plugin composer hooks. */
  pluginComposerHost?: PluginComposerHost | null;
  /** Active scope used to filter and lifecycle-key plugin banner slots. */
  pluginComposerScope?: PluginComposerScope | null;
  textEffects?: readonly ComposerTextEffectSource[];
  /** zenMode resetKey — typically the active thread id, so zen-mode collapses on thread change. */
  zenModeResetKey: string | number;
  /**
   * Changing this refocuses the composer caret to the end — e.g. after editing a
   * queued message restores its text into the draft.
   */
  focusEndKey?: string | number;
  /**
   * Whether this is the pane's primary composer (the main thread box) rather
   * than a secondary one such as a side-chat composer, which stays mounted but
   * hidden. Only the primary composer answers the pane-scoped Cmd+Shift+C /
   * Cmd+Shift+M fallback when the caret is outside every composer. Defaults to
   * true; side chats pass false. Marks the composer shell via
   * `data-app-composer-role` so the model picker can read the same signal.
   */
  isPrimaryComposer?: boolean;
  /** Inline queue editors do not own a timeline scroll control. */
  showScrollToBottomButton?: boolean;
  /**
   * A pending interaction (permission request, user question) that takes the
   * composer's place. The composer editor stays MOUNTED but hidden while this
   * is set: the previous implementation swapped the whole composer out of the
   * tree, so every approval tore down and rebuilt the TipTap editor and the
   * composer's pickers, and the draft-restoring remount landed in the same
   * task as the approval's timeline update. Rendered as the last stack item.
   */
  pendingInteraction?: ReactNode;
}

type FollowUpPromptBoxWithComposerProps = Omit<
  FollowUpPromptBoxProps,
  "composer"
> & {
  composer: FollowUpComposerProps;
};

function FollowUpPromptBoxStackOnly({
  stack,
  pluginComposerHost,
  pluginComposerScope,
}: Pick<
  FollowUpPromptBoxProps,
  "stack" | "pluginComposerHost" | "pluginComposerScope"
>) {
  const composerScope =
    pluginComposerScope ?? pluginComposerHost?.scope ?? null;
  const composerView = usePluginComposerViewModel({
    scope: composerScope ?? DEFAULT_FOLLOW_UP_COMPOSER_SCOPE,
    layout: "expanded",
    text: pluginComposerHost?.draft.text ?? "",
    attachmentCount: pluginComposerHost?.draft.attachments.length ?? 0,
    isRunning: false,
    isSubmitting: false,
  });
  if (!stack && !composerScope) {
    return null;
  }
  return (
    <PluginComposerViewProvider value={composerView}>
      <PluginComposerHostProvider value={pluginComposerHost ?? null}>
        <div data-promptbox-shell="" className="space-y-2">
          <div className="grid gap-2">
            {composerScope ? (
              <ComposerBannersSlot>{stack}</ComposerBannersSlot>
            ) : (
              stack
            )}
          </div>
        </div>
      </PluginComposerHostProvider>
    </PluginComposerViewProvider>
  );
}

function FollowUpPromptBoxWithComposer({
  id,
  attachments,
  stack,
  activePromptMode,
  composer,
  environmentSummary,
  contextWindowUsage,
  execution,
  permission,
  readOnly,
  executionReadOnly,
  permissionReadOnly,
  typeahead,
  promptActions,
  suppressPluginComposerCustomizations,
  pluginComposerHost,
  pluginComposerScope,
  textEffects,
  zenModeResetKey,
  focusEndKey,
  isPrimaryComposer = true,
  showScrollToBottomButton = true,
  pendingInteraction = null,
}: FollowUpPromptBoxWithComposerProps) {
  const submitMode = composer.submitMode;
  const hasPendingInteraction =
    pendingInteraction !== null && pendingInteraction !== undefined;
  const canQueueFollowUp = submitMode.kind === "queue";
  const canSubmit = submitMode.kind === "ready" || submitMode.kind === "queue";
  const isStopping =
    submitMode.kind === "blocked" && submitMode.reason === "stopping";
  const isLoadingExecutionOptions =
    submitMode.kind === "blocked" &&
    submitMode.reason === "loading-execution-options";
  const isLoadingPendingInteractions =
    submitMode.kind === "blocked" &&
    submitMode.reason === "loading-pending-interactions";
  const isProvisioning =
    submitMode.kind === "blocked" && submitMode.reason === "provisioning";
  const isUnavailable =
    submitMode.kind === "blocked" && submitMode.reason === "unavailable";
  const onStopRuntime =
    submitMode.kind === "queue" || submitMode.kind === "stop-only"
      ? submitMode.onStop
      : undefined;
  const canStopRuntime = onStopRuntime !== undefined;
  const attachmentCount = attachments.items?.length ?? 0;
  const composerScope =
    pluginComposerScope ?? pluginComposerHost?.scope ?? null;
  const [composerLayout, setComposerLayout] =
    useState<ComposerView["layout"]>("expanded");
  const composerView = usePluginComposerViewModel({
    scope: composerScope ?? DEFAULT_FOLLOW_UP_COMPOSER_SCOPE,
    layout: composerLayout,
    text: composer.message,
    attachmentCount,
    isRunning: canStopRuntime,
    isSubmitting: composer.isFollowUpSubmitting || isStopping,
  });
  const promptBoxRef = useRef<PromptBoxHandle>(null);
  // Scope Cmd+Shift+C to the focused pane's primary composer. Every mounted
  // composer registers this handler — including side-chat composers that stay
  // mounted while hidden — so gating on both the focused pane and "primary"
  // keeps a hidden side chat from stealing the chord. Standalone/single-pane
  // surfaces have no pane context and default to focused.
  const paneContext = useOptionalPaneContext();
  const isFocusedPane = paneContext?.isFocused ?? true;
  const focusDefault = useCallback(() => {
    promptBoxRef.current?.focusEnd();
    return promptBoxRef.current !== null;
  }, []);
  const extensionController = useComposerExtensionController({
    host: pluginComposerHost ?? null,
    view: composerView,
    isFocused: isFocusedPane,
    isPrimary: isPrimaryComposer,
    focusDefault,
  });
  const voice = usePromptVoice(promptBoxRef);
  const isCompactViewport = useIsCompactViewport();
  const isPointerCoarse = usePointerCoarse();
  const composerInteractionRef = useRef<HTMLDivElement>(null);
  const interactionExpandedRef = useRef(false);
  const pendingFocusExpansionCleanupRef = useRef<(() => void) | null>(null);
  const pendingFocusLossCleanupRef = useRef<(() => void) | null>(null);
  const [isInteractionExpanded, setIsInteractionExpanded] = useState(false);
  const isMobilePromptBoxCompact = isCompactViewport && !isInteractionExpanded;
  const compactConfig = useMemo(
    () =>
      isCompactViewport
        ? {
            isCompact: isMobilePromptBoxCompact,
            placeholder: composer.compactPromptPlaceholder,
          }
        : undefined,
    [
      composer.compactPromptPlaceholder,
      isCompactViewport,
      isMobilePromptBoxCompact,
    ],
  );
  const setInteractionExpanded = useCallback((nextExpanded: boolean) => {
    if (interactionExpandedRef.current === nextExpanded) return;
    interactionExpandedRef.current = nextExpanded;
    promptBoxRef.current?.captureHeightForLayoutChange();
    setIsInteractionExpanded(nextExpanded);
  }, []);
  const cancelPendingFocusExpansion = useCallback(() => {
    pendingFocusExpansionCleanupRef.current?.();
    pendingFocusExpansionCleanupRef.current = null;
  }, []);
  const cancelPendingFocusLoss = useCallback(() => {
    const cleanup = pendingFocusLossCleanupRef.current;
    pendingFocusLossCleanupRef.current = null;
    cleanup?.();
  }, []);
  const handleComposerFocus = useCallback(
    (event: ReactFocusEvent) => {
      cancelPendingFocusLoss();
      if (interactionExpandedRef.current) return;
      if (
        !isCompactViewport ||
        !isPointerCoarse ||
        !isKeyboardFocusTarget(event.target) ||
        !window.visualViewport
      ) {
        setInteractionExpanded(true);
        return;
      }
      if (pendingFocusExpansionCleanupRef.current) return;

      const visualViewport = window.visualViewport;
      const initialViewportHeight = visualViewport.height;
      let animationFrame: number | null = null;
      let fallbackTimeout: number | null = null;
      let hasFinished = false;
      const removeSignals = () => {
        visualViewport.removeEventListener("resize", handleViewportResize);
        if (fallbackTimeout !== null) {
          window.clearTimeout(fallbackTimeout);
          fallbackTimeout = null;
        }
      };
      const cleanup = () => {
        removeSignals();
        if (animationFrame !== null) {
          window.cancelAnimationFrame(animationFrame);
          animationFrame = null;
        }
      };
      const finishExpansion = () => {
        if (hasFinished) return;
        hasFinished = true;
        removeSignals();
        // AppLayout updates its visual-viewport height in the same animation
        // frame. Expanding here keeps the composer and keyboard on one paint.
        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = null;
          pendingFocusExpansionCleanupRef.current = null;
          setInteractionExpanded(true);
        });
      };
      const handleViewportResize = () => {
        if (
          initialViewportHeight - visualViewport.height <
          MOBILE_KEYBOARD_VIEWPORT_MIN_DELTA_PX
        ) {
          return;
        }
        finishExpansion();
      };

      visualViewport.addEventListener("resize", handleViewportResize);
      fallbackTimeout = window.setTimeout(
        finishExpansion,
        MOBILE_FOCUS_EXPANSION_FALLBACK_MS,
      );
      pendingFocusExpansionCleanupRef.current = cleanup;
    },
    [
      cancelPendingFocusLoss,
      isCompactViewport,
      isPointerCoarse,
      setInteractionExpanded,
    ],
  );
  const scheduleCollapseAfterFocusLoss = useCallback(
    (event: ReactFocusEvent) => {
      cancelPendingFocusLoss();
      const dismissedKeyboard = isKeyboardFocusTarget(event.target);
      const focusLossFrame = window.requestAnimationFrame(() => {
        pendingFocusLossCleanupRef.current = null;
        const composerElement = composerInteractionRef.current;
        if (!composerElement) return;

        // Focus events for the element losing focus run before the browser has
        // assigned the next active element. Waiting one frame makes collapse a
        // decision about settled focus state instead of pointer intent.
        if (composerElement.contains(document.activeElement)) return;

        // Responsive popovers and dropdowns portal their content outside the
        // composer. Their shared trigger contract exposes open state through
        // aria-haspopup + aria-expanded, so focus in an owned overlay must not
        // collapse the composer behind it.
        if (
          composerElement.querySelector(OPEN_COMPOSER_OVERLAY_TRIGGER_SELECTOR)
        ) {
          return;
        }

        const collapse = () => {
          cancelPendingFocusExpansion();
          setInteractionExpanded(false);
        };
        const focusSettledOnDocument =
          document.activeElement === document.body ||
          document.activeElement === document.documentElement;
        const visualViewport = window.visualViewport;
        if (
          !dismissedKeyboard ||
          !focusSettledOnDocument ||
          !isCompactViewport ||
          !isPointerCoarse ||
          !visualViewport
        ) {
          collapse();
          return;
        }

        // The software keyboard's dismiss control usually leaves focus on the
        // document before the viewport grows. Keep the expanded composer
        // stable during that native animation, then compact it as soon as the
        // visible viewport reports the keyboard has actually closed.
        const keyboardViewportHeight = visualViewport.height;
        let fallbackTimeout: number | null = null;
        let hasFinished = false;
        const cleanup = () => {
          visualViewport.removeEventListener("resize", handleViewportResize);
          if (fallbackTimeout !== null) {
            window.clearTimeout(fallbackTimeout);
            fallbackTimeout = null;
          }
        };
        const finishCollapse = () => {
          if (hasFinished) return;
          hasFinished = true;
          cleanup();
          pendingFocusLossCleanupRef.current = null;
          collapse();
        };
        const handleViewportResize = () => {
          if (
            visualViewport.height - keyboardViewportHeight <
            MOBILE_KEYBOARD_VIEWPORT_MIN_DELTA_PX
          ) {
            return;
          }
          finishCollapse();
        };

        visualViewport.addEventListener("resize", handleViewportResize);
        fallbackTimeout = window.setTimeout(
          finishCollapse,
          MOBILE_KEYBOARD_DISMISSAL_FALLBACK_MS,
        );
        pendingFocusLossCleanupRef.current = cleanup;
      });
      pendingFocusLossCleanupRef.current = () => {
        window.cancelAnimationFrame(focusLossFrame);
      };
    },
    [
      cancelPendingFocusExpansion,
      cancelPendingFocusLoss,
      isCompactViewport,
      isPointerCoarse,
      setInteractionExpanded,
    ],
  );
  useEffect(
    () => () => {
      cancelPendingFocusExpansion();
      cancelPendingFocusLoss();
    },
    [cancelPendingFocusExpansion, cancelPendingFocusLoss],
  );
  const steerOnPrimarySubmit =
    submitMode.kind === "queue" && composer.steerActiveThreadOnEnter;
  const onPrimarySubmit = steerOnPrimarySubmit
    ? composer.onModifierSubmit
    : composer.onSubmit;
  const onModifierSubmit = composer.canModifierSubmit
    ? steerOnPrimarySubmit
      ? composer.onSubmit
      : composer.onModifierSubmit
    : undefined;
  // While the interaction owns the surface the pickers are hidden with the
  // editor; keep them disabled too so their keyboard chords (model picker
  // toggle/cycle) cannot open a popover anchored to a hidden trigger.
  const executionControlsDisabled =
    (executionReadOnly ?? readOnly ?? false) || hasPendingInteraction;
  const footerStart = useMemo(
    () => (
      <ExecutionControls {...execution} disabled={executionControlsDisabled} />
    ),
    [execution, executionControlsDisabled],
  );
  const promptModeInput = useMemo(
    () => ({
      providerId: execution.provider.selectedId,
      value: composer.message,
      mentionRanges: composer.mentionRanges,
    }),
    [composer.mentionRanges, composer.message, execution.provider.selectedId],
  );
  const permissionDisplayOverride = useMemo(
    () =>
      permissionDisplayForActivePromptMode(activePromptMode) ??
      permissionDisplayForPromptMode(promptModeInput),
    [activePromptMode, promptModeInput],
  );
  const permissionPickerDisabledByPlanMode =
    shouldDisablePermissionPickerForActivePromptMode(activePromptMode) ||
    shouldDisablePermissionPickerForPromptMode(promptModeInput);
  const permissionReadOnlyResolved =
    (permissionReadOnly ?? readOnly ?? false) || hasPendingInteraction;
  const permissionPickerDisabled =
    permissionReadOnlyResolved || permissionPickerDisabledByPlanMode;
  // Side chat and active plan mode render the same permission picker as the
  // main thread, but non-interactive so the displayed effective mode cannot
  // diverge from the provider mode driving the current turn.
  const permissionControl = useMemo(
    () => (
      <PermissionModePicker
        value={permission.value}
        options={permission.options}
        onChange={permission.onChange}
        supported={permission.supported}
        disabled={permissionPickerDisabled}
        showChevronWhenDisabled={permissionPickerDisabledByPlanMode}
        displayOverride={permissionDisplayOverride}
        className="h-6"
      />
    ),
    [
      permission.onChange,
      permission.options,
      permission.supported,
      permission.value,
      permissionDisplayOverride,
      permissionPickerDisabledByPlanMode,
      permissionPickerDisabled,
    ],
  );
  const stackRef = useRef<HTMLDivElement>(null);
  const lastStackHeightRef = useRef(0);
  const [stackHeight, setStackHeight] = useState(0);
  const applyStackHeight = useCallback((measured: number) => {
    if (lastStackHeightRef.current === measured) return;
    lastStackHeightRef.current = measured;
    setStackHeight(measured);
  }, []);

  // Take one initial border-box measurement before paint. Later measurements
  // use ResizeObserver's supplied border-box size, which avoids a synchronous
  // offsetHeight read after each timeline or composer render.
  useLayoutEffect(() => {
    const element = stackRef.current;
    if (element) {
      applyStackHeight(element.offsetHeight);
    }
  }, [applyStackHeight]);

  useEffect(() => {
    const element = stackRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === element);
      if (!entry) return;
      const borderBoxSize = Array.isArray(entry.borderBoxSize)
        ? entry.borderBoxSize[0]
        : entry.borderBoxSize;
      applyStackHeight(borderBoxSize?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [applyStackHeight]);
  // The elastic pre-size keeps the prompt area's total height constant as the
  // stack (context banner + queued messages) mounts/unmounts so the timeline
  // doesn't shift. Callers that need the main-thread prompt height should pass
  // an empty stack instead of null.
  const elasticTextareaMinHeight =
    stack === null
      ? FOLLOW_UP_PROMPT_BOX_DEFAULT_MIN_HEIGHT
      : Math.max(
          FOLLOW_UP_PROMPT_BOX_DEFAULT_MIN_HEIGHT,
          FOLLOW_UP_PROMPT_BOX_ELASTIC_TARGET_HEIGHT - stackHeight,
        );

  const composerElement = (
    <div
      ref={composerInteractionRef}
      className="relative z-20"
      data-follow-up-composer=""
      data-follow-up-composer-expanded={isInteractionExpanded ? "" : undefined}
      // Hidden, not unmounted: the editor keeps its DOM, draft, and history
      // across the interaction (see `pendingInteraction`).
      hidden={hasPendingInteraction}
      onBlurCapture={scheduleCollapseAfterFocusLoss}
      onFocusCapture={handleComposerFocus}
    >
      <PromptBoxWithScrollAnchor
        id={id}
        promptBoxRef={promptBoxRef}
        voice={voice}
        minHeight={elasticTextareaMinHeight}
        value={composer.message}
        mentionRanges={composer.mentionRanges}
        onChange={composer.onChangeMessage}
        onSubmit={onPrimarySubmit}
        blurOnPointerSubmit={isCompactViewport && isPointerCoarse}
        textEffects={textEffects}
        onComposerLayoutChange={setComposerLayout}
        scrollToBottomOnSubmit={
          submitMode.kind !== "queue" || steerOnPrimarySubmit
        }
        scrollToBottomOnModifierSubmit={!steerOnPrimarySubmit}
        history={composer.history}
        focusEndKey={focusEndKey}
        placeholder={composer.promptPlaceholder}
        containerCompactPlaceholder={composer.compactPromptPlaceholder}
        heightAnimationKey={isInteractionExpanded ? "expanded" : "compact"}
        mentionMenuPlacement="top"
        submission={{
          onStop: onStopRuntime,
          isSubmitting: composer.isFollowUpSubmitting || isStopping,
          disabled:
            !canSubmit ||
            composer.isFollowUpSubmitting ||
            (steerOnPrimarySubmit && !composer.canModifierSubmit),
          onModifierSubmit,
          title: composer.isFollowUpSubmitting
            ? "Submitting..."
            : canSubmit && composer.submitTitle !== undefined
              ? composer.submitTitle
              : canQueueFollowUp
                ? steerOnPrimarySubmit
                  ? "Steer current run (Enter)"
                  : "Queue follow-up (Enter)"
                : isStopping
                  ? "Stopping run..."
                  : isLoadingExecutionOptions
                    ? "Loading models..."
                    : isLoadingPendingInteractions
                      ? "Checking pending interactions..."
                      : isProvisioning
                        ? "Provisioning..."
                        : isUnavailable
                          ? "Unavailable"
                          : "Submit (Enter)",
          isRunning: canStopRuntime,
        }}
        typeahead={typeahead}
        attachments={attachments}
        promptActions={promptActions}
        suppressPluginComposerCustomizations={
          suppressPluginComposerCustomizations
        }
        compact={compactConfig}
        zenMode={{
          layout: "thread",
          storageKey: null,
          resetKey: `${zenModeResetKey}:${
            isCompactViewport ? "mobile" : "desktop"
          }`,
          resetOnSubmit: true,
        }}
        footerStart={footerStart}
      />
      {!isMobilePromptBoxCompact ? (
        <div
          data-follow-up-composer-footer=""
          className="mt-1 flex min-h-6 max-h-6 items-center justify-between gap-2 overflow-hidden pl-[15px] pr-3.5 opacity-100 transition-[max-height,min-height,margin-top,opacity] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {environmentSummary}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {permissionControl}
            {contextWindowUsage ? (
              <ThreadContextWindowIndicator usage={contextWindowUsage} />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <ComposerExtensionHost
      controller={extensionController}
      defaultRenderer={
        <DefaultFollowUpComposer
          active={composer.threadRuntimeDisplayStatus === "active"}
          composerElement={composerElement}
          hasPluginComposerScope={composerScope !== null}
          isPrimaryComposer={isPrimaryComposer}
          pendingInteraction={pendingInteraction}
          showScrollToBottomButton={showScrollToBottomButton}
          stack={stack}
          stackRef={stackRef}
        />
      }
    />
  );
}

interface DefaultFollowUpComposerProps {
  active: boolean;
  composerElement: ReactNode;
  hasPluginComposerScope: boolean;
  isPrimaryComposer: boolean;
  pendingInteraction?: ReactNode;
  showScrollToBottomButton: boolean;
  stack: ReactNode | null;
  stackRef: RefObject<HTMLDivElement | null>;
}

/** BB's presentation for a host-owned follow-up Composer controller. */
export function DefaultFollowUpComposer({
  active,
  composerElement,
  hasPluginComposerScope,
  isPrimaryComposer,
  pendingInteraction = null,
  showScrollToBottomButton,
  stack,
  stackRef,
}: DefaultFollowUpComposerProps) {
  return (
    <>
      {showScrollToBottomButton ? (
        <ThreadTimelineScrollToBottomButton active={active} />
      ) : null}
      <div
        data-app-composer=""
        data-app-composer-role={isPrimaryComposer ? "primary" : "secondary"}
        data-promptbox-shell=""
        className="space-y-2"
      >
        <div ref={stackRef} className="grid gap-2">
          {hasPluginComposerScope ? (
            <ComposerBannersSlot>{stack}</ComposerBannersSlot>
          ) : (
            stack
          )}
          {pendingInteraction}
        </div>
        <div data-follow-up-composer-anchor="">{composerElement}</div>
      </div>
    </>
  );
}

export const FollowUpPromptBox = memo(function FollowUpPromptBox(
  props: FollowUpPromptBoxProps,
) {
  if (props.composer === null) {
    return (
      <FollowUpPromptBoxStackOnly
        stack={props.stack}
        pluginComposerHost={props.pluginComposerHost}
        pluginComposerScope={props.pluginComposerScope}
      />
    );
  }
  return <FollowUpPromptBoxWithComposer {...props} composer={props.composer} />;
});
