import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, File01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@bb/shared-ui/lib/utils";
import { MAX_ATTACHMENT_SIZE_BYTES } from "../shared/attachments.js";
import { errorMessage } from "../shared/errors.js";
import { formatFileSize } from "../views/activity/time.js";
import {
  uploadAttachment,
  type AttachmentOwnerRef,
} from "../views/detail/attachments.js";

export interface StagedAttachment {
  id: number;
  file: File;
  status: "staged" | "oversized" | "failed";
  owner?: AttachmentOwnerRef;
  error?: string;
  busy?: boolean;
}

let nextStagedId = 0;

export function stageFiles(files: readonly File[]): StagedAttachment[] {
  return files.map((file) =>
    file.size > MAX_ATTACHMENT_SIZE_BYTES
      ? {
          id: nextStagedId++,
          file,
          status: "oversized" as const,
          error: `Over the 25 MB attachment limit (${formatFileSize(file.size)})`,
        }
      : { id: nextStagedId++, file, status: "staged" as const },
  );
}

export async function uploadStagedAttachments(
  staged: readonly StagedAttachment[],
  owner: AttachmentOwnerRef,
): Promise<StagedAttachment[]> {
  const failed: StagedAttachment[] = [];
  for (const entry of staged) {
    try {
      await uploadAttachment(entry.file, owner);
    } catch (cause) {
      failed.push({
        ...entry,
        status: "failed",
        owner,
        error: errorMessage(cause),
      });
    }
  }
  return failed;
}

export function settleStagedUploads(
  files: readonly StagedAttachment[],
  staged: readonly StagedAttachment[],
  failed: readonly StagedAttachment[],
): StagedAttachment[] {
  return files.flatMap((entry) => {
    const failure = failed.find((candidate) => candidate.id === entry.id);
    if (failure) return [failure];
    return staged.some((candidate) => candidate.id === entry.id) ? [] : [entry];
  });
}

export function useStagedAttachmentRetry(
  setPendingFiles: Dispatch<SetStateAction<StagedAttachment[]>>,
  onUploaded?: () => void,
) {
  const retryingRef = useRef(new Set<number>());
  return async (entry: StagedAttachment) => {
    if (entry.owner === undefined || retryingRef.current.has(entry.id)) return;
    retryingRef.current.add(entry.id);
    setPendingFiles((files) =>
      files.map((candidate) =>
        candidate.id === entry.id ? { ...candidate, busy: true } : candidate,
      ),
    );
    try {
      await uploadAttachment(entry.file, entry.owner);
      setPendingFiles((files) =>
        files.filter((candidate) => candidate.id !== entry.id),
      );
      onUploaded?.();
    } catch (cause) {
      const message = errorMessage(cause);
      setPendingFiles((files) =>
        files.map((candidate) =>
          candidate.id === entry.id
            ? { ...candidate, busy: false, error: message }
            : candidate,
        ),
      );
    } finally {
      retryingRef.current.delete(entry.id);
    }
  };
}

function ChipThumbnail({ file }: { file: File }) {
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
