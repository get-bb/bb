import type { CSSProperties, ReactNode, Ref } from "react";
import { SourceLoadingSkeleton } from "@/components/code/code-loading-skeletons";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { TruncateStart } from "@/components/ui/truncate-start.js";
import { copyToClipboardWithToast } from "@/lib/clipboard";

export const FILE_PREVIEW_WRAPPER_STYLE = {
  "--md-content-w": "100cqi",
} as CSSProperties;

export function FilePreviewHeaderFrame({
  children,
  headerRef,
}: {
  children: ReactNode;
  headerRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={headerRef} className="sticky top-0 z-10 bg-sidebar">
      <div className="flex h-9 items-center gap-2 bg-surface-raised px-4 max-md:pointer-coarse:h-12 max-md:pointer-coarse:px-3">
        {children}
      </div>
    </div>
  );
}

export function FilePreviewPath({
  path,
  copyPath,
}: {
  path: string;
  copyPath: string | null;
}) {
  const copyTarget = copyPath ?? path;
  const label = "Copy file path";
  const className = cn(
    "min-w-0 font-mono font-medium leading-5 text-file-accent",
    COARSE_POINTER_TEXT_SM_CLASS,
  );

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              className,
              "cursor-pointer rounded-sm text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
            aria-label={label}
            onClick={() => {
              void copyToClipboardWithToast(copyTarget, {
                successMessage: "File path copied",
                errorMessage: "Failed to copy file path",
              });
            }}
          >
            <TruncateStart>{path}</TruncateStart>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function FilePreviewLoading({
  path,
  copyPath,
  showHeader = true,
}: {
  path: string;
  copyPath: string | null;
  showHeader?: boolean;
}) {
  return (
    <div
      role="status"
      aria-label="Loading file preview"
      className="@container/page min-h-full"
      style={FILE_PREVIEW_WRAPPER_STYLE}
    >
      {showHeader ? (
        <FilePreviewHeaderFrame>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className={cn(
              "flex items-center justify-center text-subtle-foreground",
              COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
            )}
          >
            <Icon name="File" className="size-full" aria-hidden />
          </span>
          <FilePreviewPath path={path} copyPath={copyPath} />
          </div>
        </FilePreviewHeaderFrame>
      ) : null}
      <SourceLoadingSkeleton />
    </div>
  );
}
