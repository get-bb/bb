import { Button } from "@bb/shared-ui/button";
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
import { InfoList, InfoListRow, InfoRowAction, InfoSection } from "./info-list";

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

const STORAGE_ICON_BUTTON_CLASS =
  "shrink-0 text-subtle-foreground hover:text-foreground [&_[data-icon-root]]:size-3 max-md:pointer-coarse:size-9 max-md:pointer-coarse:[&_[data-icon-root]]:size-4";

export function ThreadStorageSection({
  controller,
  filesError,
}: ThreadStorageSectionProps) {
  const {
    closeSearch,
    filteredFiles,
    isSearchOpen,
    loadedFiles,
    openSearch,
    searchQuery,
    selectedPath,
    selectPath,
    setSearchQuery,
  } = controller;
  if (loadedFiles.length === 0 && filesError == null) return null;
  return (
    <InfoSection
      label="Thread storage"
      count={loadedFiles.length}
      trailing={
        isSearchOpen ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Search files"
            onClick={openSearch}
            className={cn(
              "size-5 max-md:pointer-coarse:-my-2",
              STORAGE_ICON_BUTTON_CLASS,
            )}
          >
            <Icon name="Search" />
          </Button>
        )
      }
    >
      {isSearchOpen ? (
        <div className="mb-1 flex h-7 items-center gap-1 max-md:pointer-coarse:h-10">
          <Input
            autoFocus
            aria-label="Search files"
            placeholder="Search files"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              }
            }}
            className={cn(
              "h-7 focus-visible:ring-0 max-md:pointer-coarse:h-10",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close search"
            onClick={closeSearch}
            className={cn("size-6", STORAGE_ICON_BUTTON_CLASS)}
          >
            <Icon name="X" />
          </Button>
        </div>
      ) : null}
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
              action={
                <InfoRowAction
                  icon="ExternalLink"
                  label="Open in tab"
                  onClick={() => selectPath(file.path)}
                />
              }
            />
          )}
        />
      )}
    </InfoSection>
  );
}
