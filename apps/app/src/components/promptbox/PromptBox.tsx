import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { COARSE_POINTER_TEXT_BASE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { useComposerInputLock } from "@/lib/plugin-sdk-hooks";
import type {
  PromptBoxHandle,
  PromptBoxInternalProps,
} from "./PromptBoxInternal";
import {
  DEFAULT_PROMPTBOX_PLACEHOLDER,
  isPromptBoxChromeTarget,
  PromptBoxShell,
} from "./PromptBoxShell";
import { appendPromptActionToDraft } from "./prompt-action-draft";
import type { PromptBoxAction } from "./PromptBoxActionsMenu";

// Callers import the composer contract from this module so the tiptap editor
// stays out of their static closure. The type re-exports are erased at build
// time; the only runtime edge to PromptBoxInternal is the dynamic import gate
// below (named in bundle-budget.json's onDemandPackages).
export type {
  AttachmentsConfig,
  HistoryConfig,
  PromptBoxHandle,
  PromptBoxSubmissionConfig,
  PromptVoiceConfig,
  TypeaheadCommandConfig,
  TypeaheadConfig,
  TypeaheadMentionConfig,
} from "./PromptBoxInternal";
export type { PromptBoxAction } from "./PromptBoxActionsMenu";

/** Public composer props: the internal editor's, minus the handoff-only prop. */
export type PromptBoxProps = Omit<PromptBoxInternalProps, "takeFocusOnCreate">;

type PromptBoxInternalModule = typeof import("./PromptBoxInternal");

let loadedInternalModule: PromptBoxInternalModule | null = null;
let internalModulePromise: Promise<PromptBoxInternalModule> | null = null;

function loadPromptBoxInternalModule(): Promise<PromptBoxInternalModule> {
  internalModulePromise ??= import("./PromptBoxInternal").then((module) => {
    loadedInternalModule = module;
    return module;
  });
  return internalModulePromise;
}

const INTERNAL_PREFETCH_IDLE_TIMEOUT_MS = 2_500;

/**
 * Warms the editor chunk off the route's critical path so the first tap's
 * handoff is usually a mount, not a fetch. Prefers an idle callback (the
 * route chunk has been fetched and evaluated by then); browsers without
 * `requestIdleCallback` get a plain timeout. Returns a cancel function.
 */
function schedulePromptBoxInternalPrefetch(): () => void {
  if (loadedInternalModule !== null || typeof window === "undefined") {
    return () => {};
  }
  let idleHandle: number | null = null;
  let timeoutHandle: number | null = null;
  const run = () => {
    idleHandle = null;
    timeoutHandle = null;
    void loadPromptBoxInternalModule();
  };
  if (typeof window.requestIdleCallback === "function") {
    idleHandle = window.requestIdleCallback(run, {
      timeout: INTERNAL_PREFETCH_IDLE_TIMEOUT_MS,
    });
  } else {
    timeoutHandle = window.setTimeout(run, INTERNAL_PREFETCH_IDLE_TIMEOUT_MS);
  }
  return () => {
    if (idleHandle !== null) window.cancelIdleCallback(idleHandle);
    if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
  };
}

/**
 * The composer behind a first-focus handoff.
 *
 * Renders the dumb PromptBoxShell (closed-state chrome, draft preview, action
 * row — zero tiptap) until the first compose intent: a tap/focus on the text
 * region, a paste or drop, a prompt action, or a programmatic focus request
 * (`promptBoxRef.focusEnd()` / a `focusEndKey` change / desktop `autoFocus`).
 * Intent starts the dynamic import of PromptBoxInternal and mounts it when it
 * resolves; once realized it stays mounted for the life of this component.
 *
 * While the chunk loads, an invisible interim `<textarea>` overlaid on the
 * text region owns the focus. It is what the tap natively focuses — so the
 * soft keyboard opens inside the user's gesture — and every keystroke or
 * paste it receives is flushed straight into the controlled draft, which the
 * shell preview echoes. The swap is deferred while an IME composition is in
 * progress so no composition is cut mid-way; at swap time the editor mounts
 * with the full draft and, when the interim surface held focus, takes it over
 * (`takeFocusOnCreate`) with the caret at the end.
 */
export function PromptBox(props: PromptBoxProps) {
  const {
    autoFocus = true,
    focusEndKey,
    history,
    onChange,
    onEscape,
    onSubmit,
    placeholder = DEFAULT_PROMPTBOX_PLACEHOLDER,
    promptBoxRef,
    submission = {},
    value,
    mentionRanges,
    attachments: attachmentConfig = {},
    voice,
    blurOnPointerSubmit = false,
    compact,
  } = props;
  const {
    isSubmitting = false,
    disabled: submitDisabled = false,
    onModifierSubmit,
  } = submission;
  const isPointerCoarse = usePointerCoarse();
  const pluginComposerHost = usePluginComposerHost();
  const composerInputLocked = useComposerInputLock(
    pluginComposerHost?.textEffectKey ?? null,
  );

  const [internalModule, setInternalModule] = useState(loadedInternalModule);
  const [isRealized, setIsRealized] = useState(false);
  const [isInterimFocused, setIsInterimFocused] = useState(false);
  const [interimStartedEmpty, setInterimStartedEmpty] = useState(false);

  const isMountedRef = useRef(true);
  const realizeRequestedRef = useRef(false);
  const pendingSwapForCompositionRef = useRef(false);
  const handoffFocusRef = useRef(false);
  const composingRef = useRef(false);
  const interimRef = useRef<HTMLTextAreaElement>(null);
  const internalHandleRef = useRef<PromptBoxHandle | null>(null);
  const flushedBufferRef = useRef("");
  const valueRef = useRef(value);
  const mentionRangesRef = useRef(mentionRanges);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  mentionRangesRef.current = mentionRanges;
  onChangeRef.current = onChange;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isVoiceBusy =
    voice?.state === "recording" || voice?.state === "transcribing";
  const interimReadOnly = composerInputLocked || isVoiceBusy;

  /**
   * Streams the interim textarea's buffer into the controlled draft. The
   * draft's tail is replaced with the current buffer, so backspacing and
   * caret moves inside the buffered region survive, while text and mention
   * ranges that existed before the interim session stay untouched.
   */
  const flushInterimBuffer = useCallback(() => {
    const interim = interimRef.current;
    if (!interim) return;
    const buffer = interim.value;
    const previous = flushedBufferRef.current;
    if (buffer === previous) return;
    flushedBufferRef.current = buffer;
    const currentText = valueRef.current;
    const base =
      previous.length > 0 && currentText.endsWith(previous)
        ? currentText.slice(0, currentText.length - previous.length)
        : currentText;
    const nextText = base + buffer;
    valueRef.current = nextText;
    onChangeRef.current(nextText, [...mentionRangesRef.current]);
  }, []);

  const resetInterimBuffer = useCallback(() => {
    const interim = interimRef.current;
    if (interim) interim.value = "";
    flushedBufferRef.current = "";
    setInterimStartedEmpty(false);
  }, []);

  const attemptSwap = useCallback(() => {
    if (!isMountedRef.current) return;
    if (composingRef.current) {
      // Never cut an IME composition: the swap waits for compositionend so
      // the composed text commits into the interim buffer and flushes first.
      pendingSwapForCompositionRef.current = true;
      return;
    }
    flushInterimBuffer();
    const interim = interimRef.current;
    handoffFocusRef.current =
      interim !== null && interim.ownerDocument.activeElement === interim;
    setIsRealized(true);
  }, [flushInterimBuffer]);

  const requestRealize = useCallback(() => {
    if (realizeRequestedRef.current) return;
    realizeRequestedRef.current = true;
    void loadPromptBoxInternalModule().then((module) => {
      if (!isMountedRef.current) return;
      setInternalModule(module);
      attemptSwap();
    });
  }, [attemptSwap]);

  const preloadInternal = useCallback(() => {
    void loadPromptBoxInternalModule();
  }, []);

  // Warm the chunk once the shell has painted so the first tap's handoff is
  // CPU-bound, not network-bound. Realization still waits for intent.
  useEffect(() => {
    if (isRealized) return;
    return schedulePromptBoxInternalPrefetch();
  }, [isRealized]);

  // Desktop parity with the editor's passive autofocus: the mounted composer
  // takes focus on mount / history-scope change on fine pointers, so realize
  // immediately and park the focus (and any early keystrokes) in the interim
  // surface until the editor exists. Coarse pointers never autofocus.
  const focusScopeKey = history?.resetKey;
  useEffect(() => {
    if (!autoFocus || isPointerCoarse || isRealized) return;
    requestRealize();
    interimRef.current?.focus();
  }, [autoFocus, focusScopeKey, isPointerCoarse, isRealized, requestRealize]);

  // A focusEndKey change before the editor exists is a programmatic focus
  // request (e.g. editing a queued message): realize, and mirror the editor's
  // behavior of taking focus only on fine pointers.
  const lastFocusEndKeyRef = useRef(focusEndKey);
  useEffect(() => {
    if (focusEndKey === undefined) return;
    if (focusEndKey === lastFocusEndKeyRef.current) return;
    lastFocusEndKeyRef.current = focusEndKey;
    if (isRealized) return;
    requestRealize();
    if (!isPointerCoarse) {
      const interim = interimRef.current;
      interim?.focus();
      interim?.setSelectionRange(interim.value.length, interim.value.length);
    }
  }, [focusEndKey, isPointerCoarse, isRealized, requestRealize]);

  useImperativeHandle(
    promptBoxRef,
    () => ({
      focusEnd: () => {
        const handle = internalHandleRef.current;
        if (handle) {
          handle.focusEnd();
          return;
        }
        requestRealize();
        if (isPointerCoarse) return;
        const interim = interimRef.current;
        interim?.focus();
        interim?.setSelectionRange(interim.value.length, interim.value.length);
      },
      captureHeightForLayoutChange: () => {
        // Pre-handoff there is no editor-owned height animation to seed; the
        // first post-handoff layout change simply skips the tween.
        internalHandleRef.current?.captureHeightForLayoutChange();
      },
      insertTextAtCursor: (text: string) => {
        const handle = internalHandleRef.current;
        if (handle) {
          handle.insertTextAtCursor(text);
          return;
        }
        // Editorless fallback, mirroring PromptBoxInternal's: normalize and
        // append with smart spacing, then realize so follow-up typing is live.
        flushInterimBuffer();
        const normalizedText = text.replace(/\s+/g, " ").trim();
        if (normalizedText.length === 0) return;
        const currentValue = valueRef.current;
        const nextValue =
          currentValue.length === 0 || /\s$/.test(currentValue)
            ? `${currentValue}${normalizedText}`
            : `${currentValue} ${normalizedText}`;
        valueRef.current = nextValue;
        onChangeRef.current(nextValue, [...mentionRangesRef.current]);
        requestRealize();
      },
      getTextBeforeCursor: () => {
        const handle = internalHandleRef.current;
        if (handle) return handle.getTextBeforeCursor();
        flushInterimBuffer();
        const trimmed = valueRef.current.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      },
      playVoiceCompletionTransition: () =>
        internalHandleRef.current?.playVoiceCompletionTransition() ??
        Promise.resolve(),
    }),
    [flushInterimBuffer, isPointerCoarse, requestRealize],
  );

  const attachments = attachmentConfig.items ?? [];
  const canSubmitFromInterim = useCallback(() => {
    const hasSubmittableInput =
      valueRef.current.trim().length > 0 || attachments.length > 0;
    return (
      hasSubmittableInput && !isSubmitting && !submitDisabled && !isVoiceBusy
    );
  }, [attachments.length, isSubmitting, isVoiceBusy, submitDisabled]);

  const submitFromShell = useCallback(() => {
    flushInterimBuffer();
    if (!canSubmitFromInterim()) return;
    onSubmit();
    resetInterimBuffer();
    if (blurOnPointerSubmit) interimRef.current?.blur();
  }, [
    blurOnPointerSubmit,
    canSubmitFromInterim,
    flushInterimBuffer,
    onSubmit,
    resetInterimBuffer,
  ]);

  const handleInterimFocus = useCallback(
    (event: ReactFocusEvent<HTMLTextAreaElement>) => {
      setIsInterimFocused(true);
      if (event.currentTarget.value.length === 0) {
        setInterimStartedEmpty(valueRef.current.length === 0);
      }
      requestRealize();
    },
    [requestRealize],
  );

  const handleInterimBlur = useCallback(() => {
    setIsInterimFocused(false);
    flushInterimBuffer();
    // The flushed text lives in the draft now; drop the buffer so a later
    // interim session (or an external draft write) starts from a clean tail.
    resetInterimBuffer();
  }, [flushInterimBuffer, resetInterimBuffer]);

  const handleInterimKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (onEscape) {
          onEscape();
        } else {
          event.currentTarget.blur();
        }
        return;
      }
      if (event.key !== "Enter") return;
      const isModifierSubmitKey =
        event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey;
      if (isModifierSubmitKey && onModifierSubmit) {
        event.preventDefault();
        flushInterimBuffer();
        if (!isSubmitting && !submitDisabled && !isVoiceBusy) {
          onModifierSubmit();
          resetInterimBuffer();
        }
        return;
      }
      // Coarse pointers keep Enter as a newline, like the mounted editor.
      if (isPointerCoarse) return;
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      event.preventDefault();
      submitFromShell();
    },
    [
      flushInterimBuffer,
      isPointerCoarse,
      isSubmitting,
      isVoiceBusy,
      onEscape,
      onModifierSubmit,
      resetInterimBuffer,
      submitDisabled,
      submitFromShell,
    ],
  );

  const handleInterimPaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const clipboardData = event.clipboardData;
      const onAttachFiles = attachmentConfig.onAttachFiles;
      const pastedFiles = Array.from(clipboardData?.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (onAttachFiles && pastedFiles.length > 0) {
        event.preventDefault();
        void onAttachFiles(pastedFiles);
        return;
      }
      const text = clipboardData?.getData("text/plain") ?? "";
      if (text.length === 0) return;
      // Insert explicitly instead of relying on the browser default so the
      // newline normalization matches the editor's paste path and the flush
      // happens in the same task as the paste.
      event.preventDefault();
      const normalized = text.replace(/\r\n?/gu, "\n");
      const interim = event.currentTarget;
      interim.setRangeText(
        normalized,
        interim.selectionStart ?? interim.value.length,
        interim.selectionEnd ?? interim.value.length,
        "end",
      );
      flushInterimBuffer();
    },
    [attachmentConfig.onAttachFiles, flushInterimBuffer],
  );

  const handleInterimCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleInterimCompositionEnd = useCallback(() => {
    composingRef.current = false;
    flushInterimBuffer();
    if (pendingSwapForCompositionRef.current) {
      pendingSwapForCompositionRef.current = false;
      attemptSwap();
    }
  }, [attemptSwap, flushInterimBuffer]);

  const handleChromeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLFormElement>) => {
      if (!isPromptBoxChromeTarget(event.target)) return;
      const interim = interimRef.current;
      if (!interim || interimReadOnly) return;
      event.preventDefault();
      interim.focus();
      interim.setSelectionRange(interim.value.length, interim.value.length);
      requestRealize();
    },
    [interimReadOnly, requestRealize],
  );

  const handlePromptAction = useCallback(
    (action: PromptBoxAction) => {
      flushInterimBuffer();
      const appended = appendPromptActionToDraft({
        action,
        text: valueRef.current,
        mentions: mentionRangesRef.current,
      });
      if (appended !== null) {
        valueRef.current = appended.text;
        onChangeRef.current(appended.text, appended.mentions);
      }
      requestRealize();
    },
    [flushInterimBuffer, requestRealize],
  );

  const handleComposeIntent = useCallback(() => {
    requestRealize();
  }, [requestRealize]);

  if (isRealized && internalModule) {
    return (
      <internalModule.PromptBoxInternal
        {...props}
        promptBoxRef={internalHandleRef}
        takeFocusOnCreate={handoffFocusRef.current}
      />
    );
  }

  const showCompactLayout = compact?.isCompact === true && !isVoiceBusy;
  const effectivePlaceholder = showCompactLayout
    ? (compact.placeholder ?? placeholder)
    : placeholder;

  const interimSurface = (
    <textarea
      ref={interimRef}
      data-promptbox-interim-input=""
      {...(props.id ? { id: props.id } : {})}
      aria-label={effectivePlaceholder}
      autoComplete="off"
      enterKeyHint={isPointerCoarse ? "enter" : "send"}
      readOnly={interimReadOnly}
      aria-readonly={interimReadOnly || undefined}
      tabIndex={interimReadOnly ? -1 : 0}
      onFocus={handleInterimFocus}
      onBlur={handleInterimBlur}
      onInput={flushInterimBuffer}
      onKeyDown={handleInterimKeyDown}
      onPaste={handleInterimPaste}
      onCompositionStart={handleInterimCompositionStart}
      onCompositionEnd={handleInterimCompositionEnd}
      className={cn(
        "absolute inset-0 z-10 h-full w-full resize-none overflow-hidden bg-transparent px-4 pb-1 pr-14 pt-3 outline-none",
        COARSE_POINTER_TEXT_BASE_CLASS,
        "leading-relaxed",
        showCompactLayout && "pb-0 pt-3",
        // Empty-draft sessions render their own text natively (with the native
        // caret and IME preview); sessions continuing an existing draft stay
        // invisible and let the preview echo the flushed keystrokes instead.
        interimStartedEmpty
          ? "text-foreground caret-foreground"
          : "text-transparent caret-transparent",
      )}
    />
  );

  return (
    <PromptBoxShell
      id={props.id}
      value={value}
      mentionRanges={mentionRanges}
      placeholder={placeholder}
      className={props.className}
      header={props.header}
      footerStart={props.footerStart}
      submission={props.submission}
      minHeight={props.minHeight}
      attachments={props.attachments}
      promptActions={props.promptActions}
      suppressPluginComposerCustomizations={
        props.suppressPluginComposerCustomizations
      }
      editorLayout={props.editorLayout}
      onCollapse={props.onCollapse}
      compact={compact}
      containerCompactPlaceholder={props.containerCompactPlaceholder}
      voice={voice}
      onComposerLayoutChange={props.onComposerLayoutChange}
      interimSurface={interimSurface}
      showInterimCaret={isInterimFocused && !interimStartedEmpty}
      suppressPreviewText={interimStartedEmpty && value.length > 0}
      onChromeMouseDown={handleChromeMouseDown}
      onSubmitIntent={submitFromShell}
      onPromptAction={handlePromptAction}
      onPreload={preloadInternal}
      onComposeIntent={handleComposeIntent}
    />
  );
}
