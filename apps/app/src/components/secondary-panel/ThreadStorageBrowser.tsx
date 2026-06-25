import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { FileTree } from "@pierre/trees/react";
import { Button } from "@/components/ui/button.js";
import {
  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { Icon } from "@/components/ui/icon.js";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse.js";
import { Input } from "@/components/ui/input.js";
import { usePreferredTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import {
  describeLifecycleError,
  formatLifecycleErrorDescription,
} from "@/lib/lifecycle-errors";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import type { ThreadStorageBrowserController } from "./useThreadStorageBrowser";

interface FileTreeHostStyle extends CSSProperties {
  "--trees-accent-override": string;
  "--trees-bg-muted-override": string;
  "--trees-bg-override": string;
  "--trees-border-color-override": string;
  "--trees-fg-muted-override": string;
  "--trees-fg-override": string;
  "--trees-focus-ring-color-override": string;
  "--trees-font-family-override": string;
  "--trees-font-size-override": string;
  "--trees-icon-width-override": string;
  "--trees-item-margin-x-override": string;
  "--trees-padding-inline-override": string;
  "--trees-scrollbar-thumb-override": string;
  "--trees-selected-bg-override": string;
  "--trees-selected-fg-override": string;
  "--trees-selected-focused-border-color-override": string;
}

const FILE_TREE_BASE_HOST_STYLE: FileTreeHostStyle = {
  "--trees-accent-override": "var(--ring)",
  "--trees-bg-muted-override":
    "color-mix(in srgb, var(--muted) 45%, transparent)",
  "--trees-bg-override": "transparent",
  "--trees-border-color-override": "var(--border)",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-fg-override": "var(--foreground)",
  "--trees-focus-ring-color-override": "var(--ring)",
  "--trees-font-family-override": "var(--font-sans)",
  // Match the info page's compact text-xs rows and the app's smaller icon/caret
  // scale (the tree's chevron caret + file icons size off --trees-icon-width).
  "--trees-font-size-override": "var(--text-xs)",
  "--trees-icon-width-override": "14px",
  "--trees-item-margin-x-override": "0",
  "--trees-padding-inline-override": "0",
  "--trees-scrollbar-thumb-override":
    "color-mix(in srgb, var(--muted-foreground) 35%, transparent)",
  "--trees-selected-bg-override":
    "color-mix(in srgb, var(--accent) 65%, transparent)",
  "--trees-selected-fg-override": "var(--foreground)",
  "--trees-selected-focused-border-color-override": "var(--ring)",
  height: "100%",
};

interface ThreadStorageBrowserProps {
  controller: ThreadStorageBrowserController;
  filesError?: Error | null;
  isFilesLoading: boolean;
}

export function ThreadStorageBrowser({
  controller,
  filesError,
  isFilesLoading,
}: ThreadStorageBrowserProps) {
  const {
    closeSearch,
    filteredFiles,
    isSearchOpen,
    loadedFiles,
    model,
    searchQuery,
    setSearchQuery,
  } = controller;
  const preferredTheme = usePreferredTheme();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isPointerCoarse = usePointerCoarse();

  useEffect(() => {
    if (isSearchOpen && !isPointerCoarse) {
      searchInputRef.current?.focus();
    }
  }, [isPointerCoarse, isSearchOpen]);

  const fileTreeHostStyle = useMemo<FileTreeHostStyle>(
    () => ({
      ...FILE_TREE_BASE_HOST_STYLE,
      colorScheme: preferredTheme,
    }),
    [preferredTheme],
  );

  let body: ReactNode;
  if (filesError) {
    const lifecycleErrorDescription = describeLifecycleError({
      error: filesError,
      operation: "load_thread_storage",
    });
    body = (
      <EmptyState
        message={
          (lifecycleErrorDescription
            ? formatLifecycleErrorDescription(lifecycleErrorDescription)
            : null) ??
          getMutationErrorMessage({
            error: filesError,
            fallbackMessage: "Failed to load thread storage",
            lifecycleOperation: "load_thread_storage",
          })
        }
        messageClassName="text-destructive"
      />
    );
  } else if (isFilesLoading && loadedFiles.length === 0) {
    body = (
      <EmptyState
        icon="Spinner"
        message="Loading files..."
        iconClassName="animate-spin"
      />
    );
  } else if (loadedFiles.length === 0) {
    body = <EmptyState message="No files yet." />;
  } else if (filteredFiles.length === 0) {
    body = <EmptyState message="No files match search." />;
  } else {
    body = (
      <FileTree
        aria-label="Thread storage file tree"
        className="block h-full min-h-0"
        model={model}
        style={fileTreeHostStyle}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      {isSearchOpen ? (
        <div className="flex h-7 shrink-0 items-center gap-2 max-md:pointer-coarse:h-10">
          <div className="relative min-w-0 flex-1">
            <Icon
              name="Search"
              className={cn(
                "pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground",
                COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
              )}
            />
            <Input
              ref={searchInputRef}
              aria-label="Search files"
              className={cn(
                "h-7 pl-7 pr-2 focus-visible:ring-0 max-md:pointer-coarse:h-10",
                COARSE_POINTER_TEXT_SM_CLASS,
              )}
              placeholder="Search files"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeSearch();
                }
              }}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
              "shrink-0 text-muted-foreground",
            )}
            aria-label="Close search"
            onClick={closeSearch}
          >
            <Icon name="X" />
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}
