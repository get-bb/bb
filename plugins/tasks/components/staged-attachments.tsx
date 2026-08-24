import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, File01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@bb/shared-ui/lib/utils";
import { formatFileSize } from "../views/activity/time.js";
import type { AttachmentOwnerRef } from "../views/detail/attachments.js";

/** Frontend mirror of attachments/index.ts `MAX_ATTACHMENT_SIZE_BYTES`. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface StagedAttachment {
  id: number;
  file: File;
  /**
   * staged: waiting for send · oversized: rejected at pick time, never sent ·
   * failed: the owner was created but this upload failed; retry targets owner.
   */
  status: "staged" | "oversized" | "failed";
  owner?: AttachmentOwnerRef;
  error?: string;
  /** A retry for this entry is in flight; the chip disables its Retry button. */
  busy?: boolean;
}

let nextStagedId = 0;

/** Size-validates picked files: oversized ones become rejected chips. */
export function stageFiles(files: readonly File[]): StagedAttachment[] {
  return files.map((file) =>
    file.size > MAX_ATTACHMENT_BYTES
      ? {
          id: nextStagedId++,
          file,
          status: "oversized" as const,
          error: `Over the 25 MB attachment limit (${formatFileSize(file.size)})`,
        }
      : { id: nextStagedId++, file, status: "staged" as const },
  );
}

function ChipThumbnail({ file }: { file: File }) {
  // Created inside an effect so abandoned renders never leak object URLs.
  // jsdom has no URL.createObjectURL; fall back to the generic file icon.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (
      !file.type.startsWith("image/") ||
      typeof URL.createObjectURL !== "function"
    ) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (!previewUrl) return null;
  return (
    <img
      src={previewUrl}
      alt=""
      aria-hidden
      className="size-5 shrink-0 rounded-sm border border-border object-cover"
    />
  );
}

export function AttachmentChip({
  entry,
  onRemove,
  onRetry,
  disabled = false,
}: {
  entry: StagedAttachment;
  onRemove: () => void;
  onRetry?: () => void;
  /** Locks remove/retry, e.g. while the owning form is submitting. */
  disabled?: boolean;
}) {
  const broken = entry.status !== "staged";
  const image = entry.file.type.startsWith("image/");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
        broken
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-border bg-background",
      )}
      title={entry.error}
    >
      {!broken && image ? (
        <ChipThumbnail file={entry.file} />
      ) : (
        <HugeiconsIcon
          icon={File01Icon}
          className={cn("size-3", broken ? undefined : "text-muted-foreground")}
        />
      )}
      <span className="max-w-40 truncate">{entry.file.name}</span>
      <span
        className={cn(
          "text-2xs",
          broken ? "text-destructive/80" : "text-muted-foreground",
        )}
      >
        {formatFileSize(entry.file.size)}
      </span>
      {entry.error ? <span className="sr-only">{entry.error}</span> : null}
      {entry.status === "failed" && onRetry ? (
        <button
          type="button"
          aria-label={`Retry upload of ${entry.file.name}`}
          aria-busy={entry.busy === true}
          disabled={disabled || entry.busy === true}
          className="font-medium underline underline-offset-2 disabled:opacity-60"
          onClick={onRetry}
        >
          {entry.busy ? "Retrying…" : "Retry"}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`Remove ${entry.file.name}`}
        disabled={disabled || entry.busy === true}
        className={cn(
          "disabled:opacity-60",
          !broken && "text-muted-foreground hover:text-foreground",
        )}
        onClick={onRemove}
      >
        <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
      </button>
    </span>
  );
}
