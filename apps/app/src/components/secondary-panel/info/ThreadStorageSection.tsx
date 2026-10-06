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
  InfoRowAction,
  InfoSection,
} from "./info-list";

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
  if (loadedFiles.length === 0 && filesError == null) return null;
  return (
    <InfoSection label="Thread storage" count={loadedFiles.length}>
      {infoListCollapses(loadedFiles.length) ? (
        <div className="relative -mx-1">
          <Icon
            name="Search"
            className="pointer-events-none absolute top-1/2 left-1 size-3 -translate-y-1/2 text-subtle-foreground"
            aria-hidden
          />
          <Input
            aria-label="Search files"
            placeholder="Search files"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && searchQuery !== "") {
                event.preventDefault();
                setSearchQuery("");
              }
            }}
            className={cn(
              "h-6 rounded border-transparent py-0 pr-6 pl-5.5 placeholder:text-subtle-foreground hover:bg-state-hover focus-visible:bg-state-hover focus-visible:ring-0 max-md:pointer-coarse:h-9",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
          />
          {searchQuery === "" ? null : (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchQuery("")}
              className="absolute top-1/2 right-1 flex size-4 -translate-y-1/2 items-center justify-center rounded text-subtle-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:pointer-coarse:size-8"
            >
              <Icon name="X" className="size-3" aria-hidden />
            </button>
          )}
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
