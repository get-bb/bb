import {
  useEffect,
  useLayoutEffect,
  useRef,
  type DragEvent as ReactDragEvent,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { PromptTextMention } from "@bb/domain";
import { AppCommandShortcutHint } from "@/components/commands/AppCommandShortcutHint";
import { useAppCommandShortcut } from "@/components/commands/AppCommandProvider";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import {
  COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS,
  COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
  COARSE_POINTER_TEXT_BASE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { cn } from "@bb/shared-ui/lib/utils";
import { ComposerActionsSlot } from "@/components/plugin/PluginComposerActions";
import {
  PluginComposerViewProvider,
  useOptionalPluginComposerView,
  usePluginComposerHost,
  usePluginComposerViewModel,
} from "@/components/plugin/plugin-composer-host";
import type { ComposerView } from "@get-bb/plugin-sdk";
import { AttachmentPreview } from "./AttachmentPreview";
import { VoiceRecordingBar } from "./VoiceRecordingBar";
import {
  ComposerPlusMenuSlot,
  type PromptBoxAction,
} from "./PromptBoxActionsMenu";
import { PROMPT_MENTION_PILL_CLASS } from "./mentions/prompt-mention-display";
import { PromptMentionIcon } from "./mentions/PromptMentionIcon";
import type {
  AttachmentsConfig,
  PromptBoxSubmissionConfig,
  PromptVoiceConfig,
} from "./PromptBoxInternal";

/**
 * The composer's closed-state chrome with zero tiptap imports.
 *
 * PromptBox renders this shell until the user's first focus/tap/paste/drop
 * (or a programmatic focus request) hands off to the lazily loaded
 * PromptBoxInternal editor. The shell must look exactly like the mounted
 * composer at rest, so its frame, editor region, and action row reuse the
 * internal editor's class strings and data attributes — including a
 * `.ProseMirror`-shaped `contenteditable="false"` preview surface so the
 * placeholder and compact-truncation CSS in app.css applies unchanged.
 *
 * Dependency direction is one-way on purpose: PromptBoxInternal imports
 * shared chrome from this module, never the reverse (type-only imports
 * excepted — they are erased at build time). Future composer features land
 * in the internal module, not here.
 */

export const PROMPTBOX_MIN_HEIGHT = 68;
export const DEFAULT_PROMPTBOX_PLACEHOLDER =
  "Ask anything. @ to mention files, folders, or sections";
export const COMPACT_PROMPT_ACTION_BUTTON_CLASS =
  "size-8 p-0 transition-all [&_svg]:size-4";
export const COLLAPSING_GRID_CLASS =
  "grid transition-[grid-template-rows] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none";

export type PromptBoxEditorLayout = "thread" | "root-compose";

export interface PromptBoxCompactConfig {
  isCompact: boolean;
  placeholder?: string;
}

// Reserve the fixed action row and border so the standard prompt box does
// not grow beyond its intended viewport-relative cap. Shared with
// ComposerEditorSlot so the shell and the mounted editor cap identically.
export const COMPOSER_EDITOR_MAX_HEIGHT_BY_LAYOUT: Record<
  PromptBoxEditorLayout,
  string
> = {
  thread: "calc(50dvh - 3rem)",
  "root-compose": "calc(70dvh - 3rem)",
};

export const PROMPTBOX_INTERACTIVE_TARGET_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[data-prompt-mention='true']",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
].join(",");

export function isPromptBoxChromeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  return target.closest(PROMPTBOX_INTERACTIVE_TARGET_SELECTOR) === null;
}

export interface PromptSubmitButtonProps {
  canSubmit: boolean;
  className: string;
  disabledReason: string | undefined;
  isCompact: boolean;
  isSubmitting: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  title: string;
}

export function PromptSubmitButton({
  canSubmit,
  className,
  disabledReason,
  isCompact,
  isSubmitting,
  onClick,
  onPointerDown,
  title,
}: PromptSubmitButtonProps) {
  const button = (
    <Button
      data-promptbox-submit-action=""
      type="submit"
      size={isCompact ? "icon" : "sm"}
      variant="default"
      aria-label={title}
      disabled={!canSubmit}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={className}
    >
      {isSubmitting ? (
        <Icon name="Spinner" className="size-4 animate-spin" />
      ) : (
        <Icon name="CornerDownLeft" className="size-4" />
      )}
    </Button>
  );

  if (!disabledReason) return button;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-promptbox-submit-disabled-reason=""
            className="inline-flex shrink-0"
          >
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{disabledReason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface PromptBoxShellPreviewSegment {
  key: string;
  mention: PromptTextMention | null;
  text: string;
}

function promptBoxShellPreviewSegments(
  value: string,
  mentionRanges: readonly PromptTextMention[],
): PromptBoxShellPreviewSegment[] {
  const sortedMentions = [...mentionRanges].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const segments: PromptBoxShellPreviewSegment[] = [];
  let cursor = 0;
  for (const mention of sortedMentions) {
    if (mention.start < cursor || mention.end > value.length) continue;
    if (mention.start > cursor) {
      segments.push({
        key: `text-${cursor}`,
        mention: null,
        text: value.slice(cursor, mention.start),
      });
    }
    segments.push({
      key: `mention-${mention.start}`,
      mention,
      text: value.slice(mention.start, mention.end),
    });
    cursor = mention.end;
  }
  if (cursor < value.length) {
    segments.push({
      key: `text-${cursor}`,
      mention: null,
      text: value.slice(cursor),
    });
  }
  return segments;
}

export interface PromptBoxShellProps {
  id?: string;
  value: string;
  mentionRanges: readonly PromptTextMention[];
  /** Raw placeholder; the shell applies the compact override like the editor. */
  placeholder: string;
  className?: string;
  header?: ReactNode;
  footerStart?: ReactNode;
  submission?: PromptBoxSubmissionConfig;
  minHeight?: number;
  attachments?: AttachmentsConfig;
  promptActions?: readonly PromptBoxAction[];
  suppressPluginComposerCustomizations?: boolean;
  editorLayout?: PromptBoxEditorLayout;
  onCollapse?: () => void;
  compact?: PromptBoxCompactConfig;
  containerCompactPlaceholder?: string;
  voice?: PromptVoiceConfig;
  onComposerLayoutChange?: (layout: ComposerView["layout"]) => void;
  /**
   * The buffered-input surface PromptBox overlays on the editor region while
   * the editor chunk loads: an invisible textarea that captures the tap,
   * opens the soft keyboard, and streams keystrokes into the draft.
   */
  interimSurface?: ReactNode;
  /** True while the interim surface is focused: paints the caret affordance. */
  showInterimCaret?: boolean;
  /**
   * The interim surface renders its own text natively (empty-draft handoff),
   * so the preview must not echo the draft underneath it.
   */
  suppressPreviewText?: boolean;
  /** Chrome mousedown outside interactive targets — mirror of the editor's focus-on-chrome-click. */
  onChromeMouseDown?: (event: ReactMouseEvent<HTMLFormElement>) => void;
  /** Submit from the form or the submit button (Enter in the interim surface routes here too). */
  onSubmitIntent: () => void;
  /** A prompt action picked from the plus menu before the editor exists. */
  onPromptAction: (action: PromptBoxAction) => void;
  /** Warm the editor chunk (pointerenter/focus). */
  onPreload?: () => void;
  /** Compose intent that must realize the editor without stealing focus (drop, voice, action). */
  onComposeIntent?: () => void;
}

export function PromptBoxShell({
  id,
  value,
  mentionRanges,
  placeholder,
  className,
  header,
  footerStart,
  submission = {},
  minHeight = PROMPTBOX_MIN_HEIGHT,
  attachments: attachmentConfig = {},
  promptActions,
  suppressPluginComposerCustomizations = false,
  editorLayout = "thread",
  onCollapse,
  compact,
  containerCompactPlaceholder,
  voice,
  onComposerLayoutChange,
  interimSurface,
  showInterimCaret = false,
  suppressPreviewText = false,
  onChromeMouseDown,
  onSubmitIntent,
  onPromptAction,
  onPreload,
  onComposeIntent,
}: PromptBoxShellProps) {
  const focusComposerShortcut = useAppCommandShortcut("composer.focus");
  const {
    isSubmitting = false,
    disabled: submitDisabled = false,
    disabledReason: submitDisabledReason,
    title: submitTitle = "Submit (Enter)",
    isRunning = false,
    onStop,
  } = submission;
  const {
    items: attachments = [],
    isAttaching = false,
    error: attachmentError = null,
    onAttachFiles,
    onRemove: onRemoveAttachment,
    projectId: attachmentProjectId,
  } = attachmentConfig;
  const isPointerCoarse = usePointerCoarse();
  const formRef = useRef<HTMLFormElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const isVoiceRecording = voice?.state === "recording";
  const isVoiceProcessing = voice?.state === "transcribing";
  const showVoiceActionGroup = isVoiceRecording || isVoiceProcessing;
  const isVoiceBusy = showVoiceActionGroup;
  const showCompactLayout = compact?.isCompact === true && !showVoiceActionGroup;
  const effectivePlaceholder = showCompactLayout
    ? (compact.placeholder ?? placeholder)
    : placeholder;

  useLayoutEffect(() => {
    const formElement = formRef.current;
    if (!formElement) return;
    if (containerCompactPlaceholder === undefined) {
      formElement.style.removeProperty(
        "--promptbox-container-compact-placeholder",
      );
      return;
    }
    formElement.style.setProperty(
      "--promptbox-container-compact-placeholder",
      JSON.stringify(containerCompactPlaceholder),
    );
  }, [containerCompactPlaceholder]);

  const pluginComposerHost = usePluginComposerHost();
  const composerLayout: ComposerView["layout"] = showCompactLayout
    ? "compact"
    : "expanded";
  const localComposerView = usePluginComposerViewModel({
    scope: pluginComposerHost?.scope ?? {
      kind: "new-thread",
      projectId: null,
    },
    layout: composerLayout,
    text: value,
    attachmentCount: attachments.length,
    isRunning,
    isSubmitting,
  });
  const composerView = useOptionalPluginComposerView() ?? localComposerView;
  useEffect(() => {
    onComposerLayoutChange?.(composerLayout);
  }, [composerLayout, onComposerLayoutChange]);

  const trimmedValue = value.trim();
  const hasAttachments = attachments.length > 0;
  const hasSubmittableInput = trimmedValue.length > 0 || hasAttachments;
  const canSubmit =
    hasSubmittableInput && !isSubmitting && !submitDisabled && !isVoiceBusy;
  const showStop = Boolean(isRunning && onStop && !canSubmit && !isVoiceBusy);
  const canStartVoiceInput =
    voice !== undefined && voice.isSupported && !isSubmitting;
  const showVoiceAsPrimaryAction =
    isPointerCoarse && !hasSubmittableInput && canStartVoiceInput;
  const effectiveSubmitTitle =
    !canSubmit && submitDisabledReason ? submitDisabledReason : submitTitle;

  const handleVoicePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (!isPointerCoarse || event.button !== 0) return;
    // Keep mobile voice activation from focusing the button and expanding
    // the follow-up composer before click can start recording.
    event.preventDefault();
  };
  const startVoiceInput = () => {
    onComposeIntent?.();
    void voice?.start();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmitIntent();
  };

  const handleAttachmentInputChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const fileList = event.target.files;
    if (!onAttachFiles || !fileList || fileList.length === 0) return;
    void onAttachFiles(Array.from(fileList));
    event.target.value = "";
  };

  const handleDrop = (event: ReactDragEvent<HTMLFormElement>) => {
    if (!onAttachFiles) return;
    event.preventDefault();
    if (!event.dataTransfer?.files || event.dataTransfer.files.length === 0)
      return;
    void onAttachFiles(Array.from(event.dataTransfer.files));
    onComposeIntent?.();
  };

  const isPreviewEmpty = value.length === 0;
  const previewSegments =
    isPreviewEmpty || suppressPreviewText
      ? []
      : promptBoxShellPreviewSegments(value, mentionRanges);

  return (
    <form
      ref={formRef}
      data-promptbox=""
      data-promptbox-compact={showCompactLayout ? "" : undefined}
      data-promptbox-voice-active={showVoiceActionGroup ? "" : undefined}
      onSubmit={handleSubmit}
      onMouseDown={onChromeMouseDown}
      onPointerEnter={onPreload}
      onFocusCapture={onPreload}
      onDragOver={(event) => {
        if (!onAttachFiles) return;
        event.preventDefault();
      }}
      onDrop={handleDrop}
      className={cn(
        "group/promptbox relative w-full rounded-xl border border-border bg-background shadow-lift",
        showCompactLayout && "overflow-hidden",
        className,
      )}
    >
      <input
        ref={attachmentInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleAttachmentInputChange}
      />
      <div
        data-promptbox-layout=""
        className={COLLAPSING_GRID_CLASS}
        style={{ gridTemplateRows: "1fr" }}
      >
        <div
          data-promptbox-main=""
          className={cn(
            "min-h-0 overflow-hidden transition-opacity duration-[180ms] motion-reduce:transition-none",
            showCompactLayout && "relative h-12",
            showVoiceActionGroup && "pointer-events-none",
          )}
        >
          {header && !showCompactLayout ? (
            <div
              data-promptbox-expanded-only=""
              inert={showVoiceActionGroup ? true : undefined}
              className="pl-4 pr-14 pt-3"
            >
              {header}
            </div>
          ) : null}
          <div data-promptbox-input-region="" className="relative">
            {!showCompactLayout ? (
              <>
                <div data-promptbox-expanded-only="">
                  <AppCommandShortcutHint
                    shortcut={focusComposerShortcut}
                    className={cn(
                      "absolute top-2 z-20 group-focus-within/promptbox:hidden",
                      onCollapse ? "right-10" : "right-2",
                    )}
                  />
                </div>
                {onCollapse ? (
                  <div
                    data-promptbox-expanded-only=""
                    data-promptbox-standard-actions=""
                    inert={showVoiceActionGroup ? true : undefined}
                    className="absolute right-2 top-2 z-20 flex items-center"
                  >
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={onCollapse}
                      aria-label="Collapse prompt box"
                      className={cn(
                        "text-subtle-foreground hover:text-muted-foreground",
                        COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
                      )}
                    >
                      <Icon name="ChevronDown" className="size-3" />
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
            <div
              data-promptbox-editor-scroll=""
              className={cn(
                "w-full overflow-y-auto bg-transparent px-4 pb-1 pr-14 pt-3 outline-none",
                COARSE_POINTER_TEXT_BASE_CLASS,
                "leading-relaxed",
                showCompactLayout && "h-12 overflow-hidden pb-0 pr-14 pt-0",
              )}
              style={{
                minHeight: showCompactLayout ? "48px" : `${minHeight}px`,
                height: showCompactLayout ? "48px" : undefined,
                maxHeight: showCompactLayout
                  ? "48px"
                  : COMPOSER_EDITOR_MAX_HEIGHT_BY_LAYOUT[editorLayout],
              }}
            >
              <div
                data-promptbox-editor-content=""
                data-promptbox-compact-content={
                  showCompactLayout ? "" : undefined
                }
                className={cn(
                  "h-full min-h-full",
                  showCompactLayout && "flex items-center",
                  "[&_.ProseMirror]:min-h-full [&_.ProseMirror]:leading-[1.7] [&_.ProseMirror]:outline-none",
                  "[&_.ProseMirror_p]:m-0",
                  "[&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none",
                  "[&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left",
                  "[&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0",
                  "[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-subtle-foreground",
                  "[&_.ProseMirror_p.is-editor-empty:first-child::before]:font-light",
                  "[&_.ProseMirror_p.is-editor-empty:first-child::before]:opacity-70",
                )}
              >
                {/* Non-editable stand-in for the ProseMirror root. It keeps the
                    editor's classes and [contenteditable] attribute shape so the
                    placeholder and compact-preview CSS in app.css style it
                    exactly like the resting editor. */}
                <div
                  data-promptbox-shell-preview=""
                  className="ProseMirror min-h-full whitespace-pre-wrap break-words outline-none"
                  contentEditable={false}
                  aria-hidden={interimSurface ? true : undefined}
                  {...(id && !interimSurface ? { id } : {})}
                >
                  {isPreviewEmpty && !suppressPreviewText ? (
                    <p
                      className="is-editor-empty"
                      data-placeholder={effectivePlaceholder}
                    >
                      <br />
                    </p>
                  ) : (
                    <p>
                      {previewSegments.map((segment) =>
                        segment.mention ? (
                          <span
                            key={segment.key}
                            className={PROMPT_MENTION_PILL_CLASS}
                            data-prompt-mention="true"
                          >
                            <PromptMentionIcon
                              resource={segment.mention.resource}
                              className="-ml-px size-4 shrink-0 self-center"
                            />
                            <span className="truncate">
                              {segment.mention.resource.label}
                            </span>
                          </span>
                        ) : (
                          <span key={segment.key}>{segment.text}</span>
                        ),
                      )}
                      {showInterimCaret ? (
                        <span
                          data-promptbox-shell-caret=""
                          className="ml-px inline-block h-[1.1em] w-px translate-y-[0.18em] animate-caret-blink bg-foreground duration-1000 motion-reduce:animate-none"
                        />
                      ) : null}
                    </p>
                  )}
                </div>
              </div>
            </div>
            {interimSurface}
          </div>

          {!showCompactLayout ? (
            <div
              data-promptbox-expanded-only=""
              inert={showVoiceActionGroup ? true : undefined}
            >
              <AttachmentPreview
                attachments={attachments}
                attachmentProjectId={attachmentProjectId}
                expandedImageIndex={null}
                onExpandedImageIndexChange={() => {}}
                onRemoveAttachment={onRemoveAttachment}
              />

              {attachmentError ? (
                <div className="mx-3 mb-1 mt-1 text-xs text-destructive">
                  {attachmentError}
                </div>
              ) : null}
            </div>
          ) : null}

          <PluginComposerViewProvider value={composerView}>
            <div
              data-promptbox-action-row=""
              className={cn(
                "relative flex shrink-0 select-none flex-row items-center gap-3 pb-2 pl-3.5 pr-2 pt-1.5",
                // z-20 keeps the compact action buttons above the interim
                // input overlay (z-10) that spans the h-12 input region.
                showCompactLayout && "absolute inset-y-0 right-2 z-20 gap-0 p-0",
              )}
            >
              {voice && showVoiceActionGroup ? (
                <div
                  data-promptbox-voice-controls=""
                  data-voice-transition="active"
                  className="pointer-events-auto absolute inset-0 z-10 min-w-0"
                >
                  <VoiceRecordingBar
                    state={isVoiceProcessing ? "transcribing" : "recording"}
                    stream={voice.stream}
                    onConfirm={voice.stop}
                    onCancel={voice.cancel}
                  />
                </div>
              ) : null}
              {!showCompactLayout ? (
                <div
                  data-promptbox-expanded-only=""
                  data-promptbox-standard-actions=""
                  className={cn(
                    "flex min-w-0 flex-1 flex-row items-center gap-1",
                    showVoiceActionGroup && "pointer-events-none opacity-0",
                  )}
                  inert={showVoiceActionGroup ? true : undefined}
                  aria-live="polite"
                >
                  <ComposerPlusMenuSlot
                    actions={promptActions}
                    isAttaching={isAttaching}
                    onAttach={
                      onAttachFiles
                        ? () => attachmentInputRef.current?.click()
                        : undefined
                    }
                    onAction={onPromptAction}
                    includePluginContributions={
                      !suppressPluginComposerCustomizations
                    }
                  />
                  {footerStart}
                </div>
              ) : null}
              <div
                data-promptbox-standard-actions=""
                className={cn(
                  "flex shrink-0 flex-row items-center gap-1",
                  showVoiceActionGroup && "pointer-events-none opacity-0",
                )}
                inert={showVoiceActionGroup ? true : undefined}
              >
                <ComposerActionsSlot
                  includePluginContributions={
                    !showCompactLayout && !suppressPluginComposerCustomizations
                  }
                >
                  {!showCompactLayout ? (
                    <>
                      {voice &&
                      !showVoiceActionGroup &&
                      (!showVoiceAsPrimaryAction || showStop) ? (
                        <Button
                          data-promptbox-expanded-only=""
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={
                            !voice.isSupported
                              ? "Voice input is not supported in this browser"
                              : "Start voice input"
                          }
                          disabled={!canStartVoiceInput}
                          onPointerDown={handleVoicePointerDown}
                          onClick={startVoiceInput}
                          className={
                            COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS
                          }
                        >
                          <Icon name="Mic" className="size-4" />
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  <div
                    data-promptbox-submit-group=""
                    className="flex shrink-0 flex-row items-center"
                  >
                    {showStop ? (
                      <Button
                        data-promptbox-submit-action=""
                        type="button"
                        size="icon"
                        variant="secondary"
                        aria-label="Stop run"
                        onClick={onStop}
                        className={
                          showCompactLayout
                            ? COMPACT_PROMPT_ACTION_BUTTON_CLASS
                            : COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS
                        }
                      >
                        <Icon
                          name="Square"
                          className="size-3.5 fill-current [&_*]:stroke-0"
                        />
                      </Button>
                    ) : showVoiceAsPrimaryAction ? (
                      <Button
                        data-promptbox-submit-action=""
                        type="button"
                        size={showCompactLayout ? "icon" : "sm"}
                        variant="default"
                        aria-label="Start voice input"
                        onPointerDown={handleVoicePointerDown}
                        onClick={startVoiceInput}
                        className={cn(
                          showCompactLayout
                            ? COMPACT_PROMPT_ACTION_BUTTON_CLASS
                            : [
                                "ml-1",
                                COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS,
                              ],
                          "transition-colors",
                        )}
                      >
                        <Icon name="Mic" className="size-4" />
                      </Button>
                    ) : (
                      <PromptSubmitButton
                        canSubmit={canSubmit}
                        className={cn(
                          showCompactLayout
                            ? COMPACT_PROMPT_ACTION_BUTTON_CLASS
                            : [
                                "ml-1",
                                COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS,
                              ],
                          "transition-colors",
                        )}
                        disabledReason={
                          !canSubmit ? submitDisabledReason : undefined
                        }
                        isCompact={showCompactLayout}
                        isSubmitting={isSubmitting}
                        onPointerDown={() => {}}
                        onClick={() => {}}
                        title={effectiveSubmitTitle}
                      />
                    )}
                  </div>
                </ComposerActionsSlot>
              </div>
            </div>
          </PluginComposerViewProvider>
        </div>
      </div>
    </form>
  );
}
