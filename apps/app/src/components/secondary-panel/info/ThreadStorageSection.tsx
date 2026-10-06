import { useState } from "react";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  describeLifecycleError,
  formatLifecycleErrorDescription,
} from "@/lib/lifecycle-errors";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  getFileNameFromPath,
  getParentFolderNameFromPath,
  resolveRightPanelFileIconName,
} from "../rightPanelFileVisuals";
import type { ThreadStorageBrowserController } from "../useThreadStorageBrowser";
import {
  infoListCollapses,
  InfoList,
  InfoListRow,
  InfoSection,
} from "./info-list";
import { useInfoSectionCollapse } from "./useInfoSectionCollapse";

export interface ThreadStorageSectionProps {
  controller: ThreadStorageBrowserController;
  filesError?: Error | null;
}

function describeStorageError(error: Error): string {
  const lifecycleErrorDescription = describeLifecycleError({
    error,
    operation: "load_thread_storage",
  });
  return (
    (lifecycleErrorDescription
      ? formatLifecycleErrorDescription(lifecycleErrorDescription)
      : null) ??
    getMutationErrorMessage({
      error,
      fallbackMessage: "Failed to load thread storage",
      lifecycleOperation: "load_thread_storage",
    })
  );
}

const STORAGE_SEARCH_BUTTON_CLASS =
  "flex size-5 shrink-0 items-center justify-center rounded text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:pointer-coarse:-my-2 max-md:pointer-coarse:size-9";

export function ThreadStorageSection({
  controller,
  filesError,
}: ThreadStorageSectionProps) {
  const {
    filteredFiles,
    loadedFiles,
    searchQuery,
    selectedPath,
    selectPath,
    setSearchQuery,
  } = controller;
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const collapse = useInfoSectionCollapse("threadStorage");
  if (loadedFiles.length === 0 && filesError == null) return null;
  const closeSearch = () => {
    setIsSearchOpen(false);
    setSearchQuery("");
  };
  const searchable = infoListCollapses(loadedFiles.length);
  return (
    <InfoSection
      label="Thread storage"
      count={loadedFiles.length}
      collapse={collapse}
      trailing={
        !searchable ? null : isSearchOpen ? (
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <Input
              autoFocus
              aria-label="Search files"
              placeholder="Search files"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onBlur={() => {
                if (searchQuery === "") setIsSearchOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeSearch();
                }
              }}
              className={cn(
                "h-5 min-w-0 flex-1 rounded border-input/50 px-1.5 py-0 focus-visible:ring-0 max-md:pointer-coarse:-my-2 max-md:pointer-coarse:h-9",
                COARSE_POINTER_TEXT_SM_CLASS,
              )}
            />
            <button
              type="button"
              aria-label="Close search"
              onClick={closeSearch}
              className={STORAGE_SEARCH_BUTTON_CLASS}
            >
              <Icon name="X" className="size-3" aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label="Search files"
            onClick={() => setIsSearchOpen(true)}
            className={STORAGE_SEARCH_BUTTON_CLASS}
          >
            <Icon name="Search" className="size-3" aria-hidden />
          </button>
        )
      }
    >
      {filesError ? (
        <EmptyState
          message={describeStorageError(filesError)}
          messageClassName="text-destructive"
        />
      ) : filteredFiles.length === 0 ? (
        <EmptyState message="No files match search." />
      ) : (
        <InfoList
          items={filteredFiles}
          getKey={(file) => file.path}
          renderItem={(file) => (
            <InfoListRow
              leading={
                <Icon
                  name={resolveRightPanelFileIconName(file.path)}
                  className="size-3 text-subtle-foreground"
                  aria-hidden
                />
              }
              name={getFileNameFromPath({ path: file.path })}
              context={getParentFolderNameFromPath({ path: file.path })}
              title={`Open ${file.path}`}
              selected={selectedPath === file.path}
              target={{ kind: "button", onSelect: () => selectPath(file.path) }}
              actions={[
                {
                  icon: "ExternalLink",
                  label: "Open in tab",
                  onSelect: () => selectPath(file.path),
                },
              ]}
            />
          )}
        />
      )}
    </InfoSection>
  );
}
