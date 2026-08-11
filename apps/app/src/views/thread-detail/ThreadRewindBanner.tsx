import { useEffect } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { displacedTurnCountLabel } from "@/lib/thread-rewind";
import type { ThreadRewindEditingSession } from "./useThreadRewindEditing";

export interface ThreadRewindBannerProps {
  /** Live composer text for the edited-message preview. */
  editedText: string;
  onCancel: () => void;
  onCommit: () => void;
  onDismiss: () => void;
  onRevalidate: () => void;
  session: ThreadRewindEditingSession;
}

function formatEditedText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length === 0 ? "(no text — resend attachments only)" : trimmed;
}

/**
 * Confirmation card shown above the composer while a rewind edit session is
 * open. The composer holds the restored message; this card states the
 * consequence (displaced turns, unchanged workspace files), re-checks
 * eligibility, and either commits or explains why the edit can't continue.
 */
export function ThreadRewindBanner({
  editedText,
  onCancel,
  onCommit,
  onDismiss,
  onRevalidate,
  session,
}: ThreadRewindBannerProps) {
  const isBusy =
    session.status === "checking" || session.status === "submitting";
  const canCancel = !isBusy;

  // Escape cancels unless a commit is in flight.
  useEffect(() => {
    if (!canCancel) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canCancel, onCancel]);

  let title: string;
  let body: string;
  let tone: "confirming" | "error" | "info" | "stale" = "confirming";
  let primaryLabel: string | null = null;
  let primaryAction: (() => void) | null = null;
  let primaryDisabled = false;

  switch (session.status) {
    case "checking":
      title = "Checking this message…";
      body = "Confirming it can be edited before you continue.";
      break;
    case "confirming":
      title = "Edit and continue from this message";
      body = `${displacedTurnCountLabel(
        session.displacedTurnCount,
      )} after it will leave the active path. Workspace files stay unchanged.`;
      primaryLabel = "Rewind & continue";
      primaryAction = onCommit;
      break;
    case "stale":
      title = "This edit can't continue right now";
      body =
        session.message ?? "Eligibility changed while the editor was open.";
      tone = "stale";
      primaryLabel = "Re-check";
      primaryAction = onRevalidate;
      primaryDisabled = isBusy;
      break;
    case "submitting":
      title = "Rewinding…";
      body = "Creating the provider branch and sending your edit.";
      break;
    case "failed":
      title = "The edit wasn't sent";
      body =
        session.message ??
        "Your edit is preserved in the composer below. Try again or cancel.";
      tone = "error";
      primaryLabel = "Try again";
      primaryAction = onCommit;
      primaryDisabled = !session.retryable;
      break;
    case "draft-recovery":
      title = "Rewound — send your edit to continue";
      body =
        session.message ??
        "The rewound branch is active and your edit is preserved in the composer below.";
      tone = "info";
      primaryLabel = "Done";
      primaryAction = onDismiss;
      break;
  }

  return (
    <PromptStackCard ariaLabel="Rewind edit confirmation">
      <div
        data-testid="thread-rewind-banner"
        className="flex flex-col gap-2 p-2"
      >
        <div className="flex items-start gap-2">
          <Icon
            name={isBusy ? "Spinner" : "Edit"}
            className={cn(
              "mt-0.5 size-4 shrink-0",
              tone === "error" && "text-destructive",
              tone === "stale" && "text-warning-text",
              tone === "info" && "text-foreground",
              isBusy && "animate-spin",
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-5 text-foreground">
              {title}
            </p>
            <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
              {body}
            </p>
            <p className="mt-1 line-clamp-2 rounded border border-border-seam bg-surface-recessed px-2 py-1 text-xs leading-4 text-muted-foreground">
              {formatEditedText(editedText)}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          {canCancel ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : null}
          {primaryLabel !== null && primaryAction !== null ? (
            <Button
              type="button"
              size="sm"
              variant={tone === "confirming" ? "default" : "secondary"}
              disabled={primaryDisabled || isBusy}
              onClick={primaryAction}
            >
              {primaryLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </PromptStackCard>
  );
}
