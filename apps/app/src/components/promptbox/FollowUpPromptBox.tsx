import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { PromptTextMention, ThreadRuntimeDisplayStatus } from "@bb/domain";
import {
  PromptBoxInternal,
  type AttachmentsConfig,
  type HistoryConfig,
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
import { ThreadTimelineScrollToBottomButton } from "@/views/thread-detail/ThreadTimelineScrollToBottomButton";
import { ThreadContextWindowIndicator } from "@/components/thread/timeline";
import { THREAD_PROMPT_CONTEXT_BANNER_ROW_HEIGHT } from "@/components/promptbox/banner/ThreadPromptContextBanner";

type PromptBoxWithScrollAnchorProps = ComponentProps<typeof PromptBoxInternal> & {
  scrollToBottomOnSubmit?: boolean;
};

function PromptBoxWithScrollAnchor({
  onSubmit,
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
          bottomAnchor?.scrollToBottom();
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

/**
 * Discriminated state for the composer's submit affordances. Replaces the
 * previous canSendFollowUp / canQueueFollowUp / canStopRuntime / onStop
 * boolean soup. The caller computes one of these from runtimeDisplayStatus +
 * pending-interaction state and passes it down; the composer reads .kind to
 * render submit/queue/stop affordances.
 */
export type FollowUpBlockedReason =
  | "loading-execution-options"
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
  promptPlaceholder: string;
  canModifierSubmit: boolean;
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
   * Render the footer controls (model/reasoning + permission pickers) as
   * non-interactive, dimmed labels. Used by the side chat, which inherits the
   * parent thread's model and is always read-only: it renders the SAME pickers
   * as the main thread, just disabled. The composer text input stays editable.
   */
  readOnly?: boolean;
  typeahead: TypeaheadConfig;
  /** zenMode resetKey — typically the active thread id, so zen-mode collapses on thread change. */
  zenModeResetKey: string | number;
  /**
   * Changing this refocuses the composer caret to the end — e.g. after editing a
   * queued message restores its text into the draft.
   */
  focusEndKey?: string | number;
}

type FollowUpPromptBoxWithComposerProps = Omit<
  FollowUpPromptBoxProps,
  "composer"
> & {
  composer: FollowUpComposerProps;
};

function FollowUpPromptBoxStackOnly({
  stack,
}: Pick<FollowUpPromptBoxProps, "stack">) {
  if (!stack) {
    return null;
  }
  return (
    <div data-promptbox-shell="" className="space-y-2">
      <div className="space-y-2">{stack}</div>
    </div>
  );
}

function FollowUpPromptBoxWithComposer({
  id,
  attachments,
  stack,
  composer,
  environmentSummary,
  contextWindowUsage,
  execution,
  permission,
  readOnly,
  typeahead,
  zenModeResetKey,
  focusEndKey,
}: FollowUpPromptBoxWithComposerProps) {
  const submitMode = composer.submitMode;
  const canQueueFollowUp = submitMode.kind === "queue";
  const canSubmit = submitMode.kind === "ready" || submitMode.kind === "queue";
  const isStopping =
    submitMode.kind === "blocked" && submitMode.reason === "stopping";
  const isLoadingExecutionOptions =
    submitMode.kind === "blocked" &&
    submitMode.reason === "loading-execution-options";
  const isProvisioning =
    submitMode.kind === "blocked" && submitMode.reason === "provisioning";
  const isUnavailable =
    submitMode.kind === "blocked" && submitMode.reason === "unavailable";
  const onStopRuntime =
    submitMode.kind === "queue" || submitMode.kind === "stop-only"
      ? submitMode.onStop
      : undefined;
  const canStopRuntime = onStopRuntime !== undefined;
  const promptBoxRef = useRef<PromptBoxHandle>(null);
  const voice = usePromptVoice(promptBoxRef);
  const onModifierSubmit = composer.canModifierSubmit
    ? composer.onModifierSubmit
    : undefined;
  const footerStart = useMemo(
    () => <ExecutionControls {...execution} disabled={readOnly} />,
    [execution, readOnly],
  );
  // The side chat renders the SAME permission picker as the main thread, just
  // disabled (read-only) — identical label and position. No static-label
  // special-casing: `readOnly` flows to the picker's `disabled`.
  const permissionControl = useMemo(
    () => (
      <PermissionModePicker
        value={permission.value}
        options={permission.options}
        onChange={permission.onChange}
        supported={permission.supported}
        disabled={readOnly}
        className="h-6"
      />
    ),
    [
      permission.onChange,
      permission.options,
      permission.supported,
      permission.value,
      readOnly,
    ],
  );
  const stackRef = useRef<HTMLDivElement>(null);
  const [stackHeight, setStackHeight] = useState(0);
  // Measure the stack synchronously after every render. useLayoutEffect runs
  // post-DOM-commit and pre-paint, so when a React commit adds the banner
  // (e.g. workspace status arrives and the git section becomes non-empty),
  // we read the new stack height and the resulting `setStackHeight` triggers
  // a synchronous re-render that updates the textarea's minHeight before the
  // browser paints. Without this, the banner appears at 32px while the
  // textarea is still 100px for one frame — the timeline visibly shifts up
  // then back down as the elastic compensation catches up.
  useLayoutEffect(() => {
    const element = stackRef.current;
    if (!element) return;
    const measured = element.offsetHeight;
    setStackHeight((prev) => (prev === measured ? prev : measured));
  }, [stack]);
  // ResizeObserver catches changes that happen outside a React render —
  // banner sections expanding via CSS animation, window resize affecting
  // markdown line-wrapping inside the stack, etc.
  useEffect(() => {
    const element = stackRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setStackHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
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

  return (
    <>
      <ThreadTimelineScrollToBottomButton
        active={composer.threadRuntimeDisplayStatus === "active"}
      />
      <div data-promptbox-shell="" className="space-y-2">
        <div ref={stackRef} className="space-y-2">
          {stack}
        </div>
        <PromptBoxWithScrollAnchor
          id={id}
          promptBoxRef={promptBoxRef}
          voice={voice}
          minHeight={elasticTextareaMinHeight}
          value={composer.message}
          mentionRanges={composer.mentionRanges}
          onChange={composer.onChangeMessage}
          onSubmit={composer.onSubmit}
          scrollToBottomOnSubmit={submitMode.kind !== "queue"}
          history={composer.history}
          focusEndKey={focusEndKey}
          placeholder={composer.promptPlaceholder}
          mentionMenuPlacement="top"
          submission={{
            onStop: onStopRuntime,
            isSubmitting: composer.isFollowUpSubmitting || isStopping,
            disabled: !canSubmit || composer.isFollowUpSubmitting,
            onModifierSubmit,
            title: canQueueFollowUp
              ? "Queue follow-up (Enter)"
              : isStopping
                ? "Stopping run..."
                : isLoadingExecutionOptions
                  ? "Loading models..."
                  : isProvisioning
                    ? "Provisioning..."
                    : isUnavailable
                      ? "Unavailable"
                      : "Submit (Enter)",
            isRunning: canStopRuntime,
          }}
          typeahead={typeahead}
          attachments={attachments}
          zenMode={{
            layout: "thread",
            storageKey: null,
            resetKey: zenModeResetKey,
            resetOnSubmit: true,
          }}
          footerStart={footerStart}
        />
        <div className="mt-1 flex min-h-6 items-center justify-between gap-2 pl-[15px] pr-3.5">
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
      </div>
    </>
  );
}

export const FollowUpPromptBox = memo(function FollowUpPromptBox(
  props: FollowUpPromptBoxProps,
) {
  if (props.composer === null) {
    return <FollowUpPromptBoxStackOnly stack={props.stack} />;
  }
  return <FollowUpPromptBoxWithComposer {...props} composer={props.composer} />;
});
