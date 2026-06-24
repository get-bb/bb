import { useEffect, useRef, useState, type ReactNode } from "react";
import { normalizeProjectPathInput } from "@bb/domain";
import { Button } from "@/components/ui/button.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { Icon } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import { useHostDirectory } from "@/hooks/queries/host-queries";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { cn } from "@/lib/utils";

interface Crumb {
  label: string;
  path: string;
}

/**
 * Splits an absolute directory into navigable ancestor crumbs. The host's
 * separator is inferred from the path string (the client can't know a remote
 * host's platform), so this handles both POSIX and Windows roots.
 */
export function toBreadcrumb(directory: string): Crumb[] {
  const isWindows = /^[A-Za-z]:/.test(directory);
  if (!isWindows) {
    const crumbs: Crumb[] = [{ label: "/", path: "/" }];
    let accumulated = "";
    for (const segment of directory.split("/").filter(Boolean)) {
      accumulated = `${accumulated}/${segment}`;
      crumbs.push({ label: segment, path: accumulated });
    }
    return crumbs;
  }

  const segments = directory.replace(/\//g, "\\").split("\\").filter(Boolean);
  const drive = segments[0] ?? "";
  const crumbs: Crumb[] = [{ label: drive, path: `${drive}\\` }];
  let accumulated = drive;
  for (const segment of segments.slice(1)) {
    accumulated = `${accumulated}\\${segment}`;
    crumbs.push({ label: segment, path: accumulated });
  }
  return crumbs;
}

interface RemotePathBrowserProps {
  hostId: string;
  /** Directory to open at; null starts at the host's home directory. */
  initialPath?: string | null;
  /**
   * Reports the resolved directory currently shown (the folder that would be
   * picked). Null while the first listing loads or a manual path fails to read.
   */
  onDirectoryChange: (directory: string | null) => void;
  disabled?: boolean;
}

export function RemotePathBrowser({
  hostId,
  initialPath = null,
  onDirectoryChange,
  disabled = false,
}: RemotePathBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string | null>(initialPath);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const { data, isError, error, isPlaceholderData } = useHostDirectory(
    hostId,
    currentPath,
  );

  const directory = data?.directory ?? null;
  const crumbs = directory ? toBreadcrumb(directory) : [];

  // Keep the dialog's pick target in sync with the resolved directory.
  useEffect(() => {
    onDirectoryChange(directory);
  }, [directory, onDirectoryChange]);

  useEffect(() => {
    if (isEditing) editInputRef.current?.focus();
  }, [isEditing]);

  const openEditor = () => {
    setEditValue(directory ?? "");
    setIsEditing(true);
  };

  const commitEditor = () => {
    const normalized = normalizeProjectPathInput(editValue);
    setIsEditing(false);
    if (normalized) setCurrentPath(normalized);
  };

  let body: ReactNode;
  if (isError) {
    body = (
      <EmptyState
        icon="AlertCircle"
        message={getMutationErrorMessage({
          error,
          fallbackMessage: "Couldn't read this folder.",
        })}
        messageClassName="text-destructive"
        className="px-2 py-3"
      />
    );
  } else if (!data) {
    body = (
      <EmptyState
        icon="Spinner"
        iconClassName="animate-spin"
        message="Loading…"
        className="px-2 py-3"
      />
    );
  } else if (data.entries.length === 0) {
    body = <EmptyState message="This folder is empty." className="px-2 py-3" />;
  } else {
    body = (
      <ul className="flex flex-col">
        {data.entries.map((entry) => {
          if (entry.kind === "file") {
            return (
              <li
                key={entry.path}
                className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground"
              >
                <Icon name="File" className="size-4 shrink-0" />
                <span className="truncate">{entry.name}</span>
              </li>
            );
          }
          return (
            <li key={entry.path}>
              <button
                type="button"
                disabled={disabled}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-muted disabled:pointer-events-none"
                onClick={() => setCurrentPath(entry.path)}
              >
                <Icon
                  name="Folder"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="truncate">{entry.name}</span>
                <Icon
                  name="ChevronRight"
                  className="ml-auto size-4 shrink-0 text-muted-foreground"
                />
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex flex-col rounded-md border">
      <div className="flex items-center gap-1 border-b px-1.5 py-1">
        {isEditing ? (
          <>
            <Input
              ref={editInputRef}
              aria-label="Project path"
              className="h-7 flex-1 text-xs"
              value={editValue}
              disabled={disabled}
              placeholder="/path/to/project"
              onChange={(event) => setEditValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitEditor();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setIsEditing(false);
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label="Go to path"
              disabled={disabled}
              onClick={commitEditor}
            >
              <Icon name="Check" />
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label="Go to parent folder"
              disabled={disabled || !data?.parent}
              onClick={() => {
                if (data?.parent) setCurrentPath(data.parent);
              }}
            >
              <Icon name="ArrowUp" />
            </Button>
            <div className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap text-xs text-muted-foreground">
              {crumbs.map((crumb, index) => (
                <span key={crumb.path} className="flex items-center">
                  {index > 0 ? (
                    <Icon
                      name="ChevronRight"
                      className="size-3 shrink-0 opacity-50"
                    />
                  ) : null}
                  <button
                    type="button"
                    disabled={disabled}
                    className={cn(
                      "rounded px-1 py-0.5 hover:bg-muted hover:text-foreground",
                      index === crumbs.length - 1 &&
                        "font-medium text-foreground",
                    )}
                    onClick={() => setCurrentPath(crumb.path)}
                  >
                    {crumb.label}
                  </button>
                </span>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label="Edit path"
              disabled={disabled}
              onClick={openEditor}
            >
              <Icon name="Edit" />
            </Button>
          </>
        )}
      </div>

      <div
        className={cn(
          "h-56 min-h-0 overflow-y-auto px-1.5 py-1",
          isPlaceholderData && "opacity-60",
        )}
      >
        {body}
      </div>
    </div>
  );
}
