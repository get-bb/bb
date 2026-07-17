import { useState } from "react";
import type { ThreadTimelineModelFallback } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { rawStringLocalStorage } from "@/lib/browser-storage";

interface ThreadModelFallbackCardProps {
  fallback: ThreadTimelineModelFallback;
  threadId: string;
}

function dismissalStorageKey(threadId: string): string {
  return `bb.thread.model-fallback-dismissed.${threadId}`;
}

function modelLabel(model: string): string {
  const parts = model
    .replace(/^(?:anthropic[-/])?claude-/i, "")
    .split("-")
    .filter(Boolean);
  const versionStart = parts.findIndex((part) => /^\d+$/.test(part));
  const nameParts = versionStart === -1 ? parts : parts.slice(0, versionStart);
  const versionParts = versionStart === -1 ? [] : parts.slice(versionStart);
  const name = nameParts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const [major, minor, ...qualifiers] = versionParts;
  const version = major
    ? [minor ? `${major}.${minor}` : major, ...qualifiers].join(" ")
    : "";
  return [name, version].filter(Boolean).join(" ") || model;
}

export function ThreadModelFallbackCard({
  fallback,
  threadId,
}: ThreadModelFallbackCardProps) {
  const occurrence = String(fallback.sourceSeq);
  const storageKey = dismissalStorageKey(threadId);
  const [dismissedOccurrence, setDismissedOccurrence] = useState(() =>
    rawStringLocalStorage.getItem(storageKey, ""),
  );

  if (dismissedOccurrence === occurrence) {
    return null;
  }

  return (
    <PromptStackCard ariaLabel="Model fallback" className="overflow-hidden">
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-8 items-center gap-1.5 px-3 py-1.5 text-xs"
      >
        <Icon
          name="AlertTriangle"
          className="size-3.5 shrink-0 text-warning-text"
          aria-hidden="true"
        />
        <span className="shrink-0 font-medium text-foreground">
          Model fallback
        </span>
        <span
          className="min-w-0 flex-1 truncate text-muted-foreground"
          title={fallback.message}
        >
          Switched from {modelLabel(fallback.originalModel)} to{" "}
          {modelLabel(fallback.fallbackModel)}
        </span>
        <button
          type="button"
          aria-label="Dismiss model fallback"
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
          onClick={() => {
            rawStringLocalStorage.setItem(storageKey, occurrence);
            setDismissedOccurrence(occurrence);
          }}
        >
          <Icon name="X" className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </PromptStackCard>
  );
}
