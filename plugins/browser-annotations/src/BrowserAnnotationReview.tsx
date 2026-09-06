import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import {
  PersistentResponsiveDrawerShell,
  usePersistentOverlayFocus,
  useResponsiveDrawerRealization,
  useResponsiveRoot,
} from "@bb/shared-ui/responsive-overlay";
import {
  BROWSER_ELEMENT_ANNOTATION_INTENTS,
  browserElementAnnotationsAgentText,
  type BrowserElementAnnotation,
  type BrowserElementAnnotationIntent,
} from "./element-capture";
import type { BrowserElementAnnotationNote } from "./element-types";

export interface BrowserElementAnnotationReviewProps {
  annotation: BrowserElementAnnotation;
  dialogLabel: string;
  screenshotUrl: string | null;
  captureError?: string | null;
  onRetryCapture?: () => void;
  comment: string;
  intent: BrowserElementAnnotationIntent;
  onCommentChange: (comment: string) => void;
  onIntentChange: (intent: BrowserElementAnnotationIntent) => void;
  submitLabel: string;
  onSubmit: (comment: string, intent: BrowserElementAnnotationIntent) => void;
  onClose: () => void;
}

export function BrowserAnnotationOverlay({
  open,
  onClose,
  label,
  fill,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  fill: boolean;
  children: ReactNode;
}) {
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  const { isCompactViewport, onOpenChange } = useResponsiveRoot(
    open,
    handleOpenChange,
  );
  const { isContentRealized } = useResponsiveDrawerRealization({
    open,
    enabled: isCompactViewport,
  });
  const retainedContent = useRef<ReactNode>(null);
  const desktopOverlayRef = useRef<HTMLDivElement>(null);
  const requestDesktopClose = useCallback(
    () => onOpenChange(false),
    [onOpenChange],
  );
  usePersistentOverlayFocus({
    open: open && !isCompactViewport,
    panelRef: desktopOverlayRef,
    requestClose: requestDesktopClose,
  });
  useLayoutEffect(() => {
    if (children != null && children !== false)
      retainedContent.current = children;
  }, [children]);
  if (!isCompactViewport) {
    return open ? (
      <div
        ref={desktopOverlayRef}
        role="dialog"
        aria-label={label}
        aria-modal="true"
        tabIndex={-1}
        className="absolute inset-0 z-30 outline-none"
      >
        {children}
      </div>
    ) : null;
  }
  return (
    <PersistentResponsiveDrawerShell
      open={open}
      onOpenChange={onOpenChange}
      srLabel={label}
      contentClassName={cn("overflow-hidden", fill && "h-[90dvh]")}
    >
      {isContentRealized ? (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-auto [&>aside]:static [&>aside]:w-full [&>section]:relative [&>section]:flex-1 [&_button]:min-h-9 [&_button]:min-w-9 [&_textarea]:text-base">
          {children == null || children === false
            ? retainedContent.current
            : children}
        </div>
      ) : null}
    </PersistentResponsiveDrawerShell>
  );
}

export function BrowserElementAnnotationReview({
  annotation,
  dialogLabel,
  screenshotUrl,
  captureError,
  onRetryCapture,
  comment,
  intent,
  onCommentChange,
  onIntentChange,
  submitLabel,
  onSubmit,
  onClose,
}: BrowserElementAnnotationReviewProps) {
  const canSubmit = comment.trim().length > 0;
  const cardWidth = 352;
  const inset = 12;
  const targetCenterX = annotation.rect.x + annotation.rect.width / 2;
  const left = Math.min(
    Math.max(inset, targetCenterX - cardWidth / 2),
    Math.max(inset, annotation.viewport.width - cardWidth - inset),
  );
  const belowTop = annotation.rect.y + annotation.rect.height + 10;
  const top =
    belowTop + 400 <= annotation.viewport.height - inset
      ? belowTop
      : Math.max(inset, annotation.rect.y - 410);
  return (
    <aside
      style={{ left, top }}
      className="absolute z-30 max-h-[min(25rem,calc(100dvh-1.5rem))] w-[min(22rem,calc(100%-1.5rem))] overflow-y-auto"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="rounded-xl border border-border bg-popover/95 p-3 text-popover-foreground shadow-xl backdrop-blur">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">{dialogLabel}</p>
          <button
            type="button"
            aria-label="Close page annotation"
            onClick={onClose}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Icon name="X" className="size-3.5" aria-hidden />
          </button>
        </div>
        {captureError === null || captureError === undefined ? null : (
          <div
            id="browser-annotation-capture-error"
            role="alert"
            className="mb-3 flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
          >
            <p className="min-w-0 text-xs text-destructive">
              <span className="font-medium">Preview unavailable.</span>{" "}
              {captureError}
            </p>
            {onRetryCapture === undefined ? null : (
              <button
                type="button"
                onClick={onRetryCapture}
                className="inline-flex h-11 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Icon name="RotateCcw" className="size-3.5" aria-hidden />
                Retry
              </button>
            )}
          </div>
        )}
        {screenshotUrl === null ? null : (
          <img
            src={screenshotUrl}
            alt="Selected page element"
            className="mb-3 max-h-28 w-full rounded-md border border-border bg-surface-recessed object-contain"
          />
        )}
        <div className="mb-3 rounded-md border border-border bg-surface-recessed px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground">
            Selected object
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-foreground">
            {(annotation.accessibility.name ?? annotation.text) ||
              annotation.dom.tag}
          </p>
          <code className="mt-1 block truncate text-xs text-muted-foreground">
            {annotation.dom.selector}
          </code>
        </div>
        <label className="sr-only" htmlFor="browser-annotation-feedback">
          Feedback
        </label>
        <textarea
          id="browser-annotation-feedback"
          value={comment}
          maxLength={2_000}
          autoFocus
          onChange={(event) => onCommentChange(event.target.value)}
          placeholder="Describe what the agent should change here..."
          className="h-28 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div
          className="mt-2 grid grid-cols-2 gap-2"
          role="group"
          aria-label="Annotation intent"
        >
          {BROWSER_ELEMENT_ANNOTATION_INTENTS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={intent === option}
              onClick={() => onIntentChange(option)}
              className={cn(
                "h-11 rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                intent === option
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground hover:bg-state-hover",
              )}
            >
              {option === "fix"
                ? "Fix"
                : option === "change"
                  ? "Change"
                  : option === "question"
                    ? "Question"
                    : "Approve"}
            </button>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              const trimmedComment = comment.trim();
              if (!canSubmit) return;
              onSubmit(trimmedComment, intent);
            }}
            className="inline-flex h-11 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
          >
            <Icon name="MessageSquarePlus" className="size-3.5" aria-hidden />
            {submitLabel}
          </button>
        </div>
      </div>
    </aside>
  );
}

export function BrowserElementAnnotationTray({
  annotations,
  onAddToChat,
  onClear,
  onCopy,
  onEdit,
  onRemove,
  onMove,
  onSelectElement,
  tabId,
}: {
  annotations: readonly BrowserElementAnnotationNote[];
  onAddToChat?: (text: string) => void;
  onClear: () => void;
  onCopy: (text: string) => void;
  onEdit: (note: BrowserElementAnnotationNote) => void;
  onRemove: (noteId: string) => void;
  onMove: (noteId: string, direction: "up" | "down") => void;
  onSelectElement: () => void;
  tabId: string;
}) {
  const agentText = browserElementAnnotationsAgentText(annotations, tabId);
  return (
    <aside
      aria-label="Page annotations"
      className="absolute bottom-3 right-3 z-30 flex max-h-[55%] w-[min(24rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl bg-popover/95 text-popover-foreground shadow-xl backdrop-blur"
    >
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              Page annotations
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Use the arrows to set the order sent to the prompt.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            {annotations.length}{" "}
            {annotations.length === 1 ? "annotation" : "annotations"}
          </span>
          <button
            type="button"
            aria-label="Clear page annotations"
            onClick={onClear}
            className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Icon name="Clean" className="size-3.5" aria-hidden />
          </button>
        </div>
      </header>
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {annotations.map((note, index) => (
          <li
            key={note.id}
            className="rounded-lg border border-border bg-background px-3 py-2.5 text-xs shadow-sm"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {(note.annotation.accessibility.name ??
                      note.annotation.text) ||
                      note.annotation.dom.tag}
                  </p>
                  <span className="rounded-full bg-surface-recessed px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
                    {note.intent}
                  </span>
                </div>
                <code className="mt-1 block truncate text-xs text-muted-foreground">
                  {note.annotation.dom.selector}
                </code>
                <p className="mt-1.5 whitespace-pre-wrap leading-5 text-foreground">
                  {note.comment}
                </p>
              </div>
              <div className="flex shrink-0 items-start gap-0.5">
                <button
                  type="button"
                  aria-label={`Move annotation ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => onMove(note.id, "up")}
                  className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
                >
                  <Icon name="ArrowUp" className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Move annotation ${index + 1} down`}
                  disabled={index === annotations.length - 1}
                  onClick={() => onMove(note.id, "down")}
                  className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
                >
                  <Icon name="ArrowDown" className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Edit annotation ${index + 1}`}
                  onClick={() => onEdit(note)}
                  className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Icon name="EditFile" className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Remove annotation ${index + 1}`}
                  onClick={() => onRemove(note.id)}
                  className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Icon name="X" className="size-3.5" aria-hidden />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <footer className="flex flex-wrap justify-end gap-1.5 border-t border-border bg-popover/85 px-3 py-2">
        <button
          type="button"
          onClick={onSelectElement}
          className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon name="MessageSquarePlus" className="size-3.5" aria-hidden />
          Add annotation
        </button>
        <button
          type="button"
          disabled={agentText === null}
          onClick={() => {
            if (agentText === null) return;
            onCopy(agentText);
          }}
          className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon name="Copy" className="size-3.5" aria-hidden />
          Copy
        </button>
        {onAddToChat === undefined ? null : (
          <button
            type="button"
            disabled={agentText === null}
            onClick={() => {
              if (agentText === null) return;
              onAddToChat(agentText);
            }}
          className="inline-flex h-11 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
          >
            <Icon name="Sent" className="size-3.5" aria-hidden />
            Add to chat
          </button>
        )}
      </footer>
    </aside>
  );
}
