import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  BRANCH_PICKER_CONTENT_CLASS_NAME,
  BranchPickerRow,
  BranchPickerSearch,
  BranchPickerSectionHeader,
} from "@bb/shared-ui/branch-picker-primitives";
import { Button } from "@bb/shared-ui/button";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { MenuHoverProvider } from "@bb/shared-ui/menu-item-hover";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";
import { blurActiveKeyboardInputWithin } from "@bb/shared-ui/overlay-trigger";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import {
  definePluginApp,
  experimental_useBranches,
  useRpc,
  type JsonValue,
  type PluginEnvironmentProviderInputsProps,
} from "@get-bb/plugin-sdk/app";
import type { DiscoveredWorktree } from "./contract.js";
import { GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";
import type { WorktreeInputs, worktreeRpcContract } from "./server.js";

const DEFAULT_INPUTS: WorktreeInputs = { branch: { kind: "default" } };
const NEW_WORKTREE_LABEL = "New worktree";
const EXISTING_WORKTREE_LABEL = "Existing worktree";

type WorktreeIntent = "new" | "existing";

export function selectedBranchName(value: JsonValue | null): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const branch = value.branch;
  if (typeof branch !== "object" || branch === null || Array.isArray(branch)) {
    return null;
  }
  return branch.kind === "named" && typeof branch.name === "string"
    ? branch.name
    : null;
}

export function selectedExistingPath(value: JsonValue | null): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value.kind === "existing" && typeof value.path === "string"
    ? value.path
    : null;
}

export function worktreeDirectoryName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function filterBranches(branches: readonly string[], query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return [...branches];
  return branches.filter((branch) => branch.toLowerCase().includes(normalized));
}

function WorktreeInputsControl({
  projectId,
  target,
  value,
  onChange,
}: PluginEnvironmentProviderInputsProps) {
  const hostId = target.kind === "existing-host" ? target.hostId : null;
  const rpc = useRpc<typeof worktreeRpcContract>();
  const [worktrees, setWorktrees] = useState<readonly DiscoveredWorktree[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionsScrollRef = useRef<HTMLDivElement>(null);

  const existingPath = selectedExistingPath(value);
  const branchName = selectedBranchName(value);
  const selectedIntent: WorktreeIntent =
    existingPath === null ? "new" : "existing";
  const [intent, setIntent] = useState<WorktreeIntent>(selectedIntent);

  const branchState = experimental_useBranches({
    hostId,
    projectId,
    query: deferredQuery.trim().toLowerCase(),
  });

  useEffect(() => {
    if (value === null) onChange({ status: "ready", value: DEFAULT_INPUTS });
  }, [value, onChange]);

  useEffect(() => {
    if (projectId === null || hostId === null) {
      setWorktrees([]);
      return;
    }
    let active = true;
    void rpc
      .call("listExistingWorktrees", { projectId, hostId })
      .then((result) => {
        if (active) setWorktrees(result.worktrees);
      })
      .catch(() => {
        if (active) setWorktrees([]);
      });
    return () => {
      active = false;
    };
  }, [projectId, hostId, rpc]);

  useEffect(() => {
    if (open) setIntent(selectedIntent);
  }, [open, selectedIntent]);

  useEffect(() => {
    if (optionsScrollRef.current) optionsScrollRef.current.scrollTop = 0;
  }, [intent, query]);

  const branchOptions = useMemo(
    () => filterBranches(branchState.branches, deferredQuery),
    [branchState.branches, deferredQuery],
  );

  const triggerLabel =
    existingPath === null
      ? branchName === null
        ? NEW_WORKTREE_LABEL
        : `New worktree from: ${branchName}`
      : worktreeDirectoryName(existingPath);
  const triggerTitle =
    existingPath ??
    (branchName === null
      ? "Create a worktree from the default branch"
      : `Create a worktree from ${branchName}`);

  const updateOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      blurActiveKeyboardInputWithin(inputRef.current);
      setQuery("");
    } else {
      void branchState.refresh().catch(() => undefined);
    }
    setOpen(nextOpen);
  };
  const submit = (next: WorktreeInputs) => {
    onChange({ status: "ready", value: next });
    updateOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={updateOpen}>
      <PopoverTrigger asChild disabled={projectId === null}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={projectId === null}
          aria-label="Worktree"
          role="combobox"
          aria-expanded={open}
          className={cn(
            LIST_HOVER_TRANSITION,
            OPTION_BASE_CLASS_NAME,
            OPTION_INTERACTIVE_CLASS_NAME,
            OPTION_MUTED_CLASS_NAME,
          )}
        >
          <span
            className={OPTION_TRIGGER_CONTENT_CLASS_NAME}
            title={triggerTitle}
          >
            <Icon
              name="FolderGit"
              className={COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS}
            />
            <span className="min-w-0 truncate">{triggerLabel}</span>
          </span>
          <Icon
            name="ChevronDown"
            className={cn(
              "shrink-0 text-muted-foreground",
              COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={16}
        mobileTitle="Work in:"
        autoFocusRef={intent === "new" ? inputRef : undefined}
        className={cn(BRANCH_PICKER_CONTENT_CLASS_NAME, "md:min-w-40")}
      >
        <MenuHoverProvider>
          {intent === "new" ? (
            <BranchPickerSearch
              inputRef={inputRef}
              query={query}
              enterSelection={branchOptions[0]}
              onEnterSelection={(branch) =>
                submit({ branch: { kind: "named", name: branch } })
              }
              onQueryChange={setQuery}
              ariaLabel="Search branches"
            />
          ) : null}
          <div
            ref={optionsScrollRef}
            className="min-h-0 max-h-[60vh] overflow-y-auto overscroll-contain px-1 pb-1 pt-0 md:max-h-80"
            onWheel={(event) => event.stopPropagation()}
          >
            <BranchPickerSectionHeader label="Work in:" sticky={false} />
            <BranchPickerRow
              icon="Plus"
              selected={selectedIntent === "new"}
              title="Create a worktree for this thread"
              onSelect={() => setIntent("new")}
            >
              <span className="min-w-0 flex-1 truncate">
                {NEW_WORKTREE_LABEL}
              </span>
            </BranchPickerRow>
            <BranchPickerRow
              icon="FolderGit"
              disabled={worktrees.length === 0}
              selected={selectedIntent === "existing"}
              title={
                worktrees.length === 0
                  ? "No worktrees outside bb to use"
                  : "Use a worktree you already have"
              }
              onSelect={() => setIntent("existing")}
            >
              <span className="min-w-0 flex-1 truncate">
                {EXISTING_WORKTREE_LABEL}
              </span>
            </BranchPickerRow>
            <div className="my-1 h-px bg-border/60" />
            {intent === "new" ? (
              <>
                <BranchPickerSectionHeader label="Branch from:" />
                <BranchPickerRow
                  icon="GitMerge"
                  selected={existingPath === null && branchName === null}
                  title="Use the repository's default branch"
                  onSelect={() => submit(DEFAULT_INPUTS)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    Default branch
                  </span>
                </BranchPickerRow>
                {branchOptions.map((branch) => (
                  <BranchPickerRow
                    key={branch}
                    icon="GitMerge"
                    selected={branch === branchName}
                    title={branch}
                    onSelect={() =>
                      submit({ branch: { kind: "named", name: branch } })
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{branch}</span>
                  </BranchPickerRow>
                ))}
                {branchOptions.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    {branchState.isLoading
                      ? "Loading branches..."
                      : "No branches found."}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <BranchPickerSectionHeader label="Existing worktree:" />
                {worktrees.map((worktree) => (
                  <BranchPickerRow
                    key={worktree.path}
                    icon="FolderGit"
                    selected={worktree.path === existingPath}
                    disabled={worktree.prunable}
                    title={worktree.path}
                    onSelect={() =>
                      submit({ kind: "existing", path: worktree.path })
                    }
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="min-w-0 truncate">
                        {worktreeDirectoryName(worktree.path)}
                      </span>
                      {worktree.branch === null ? null : (
                        <span className="min-w-0 truncate text-xs text-muted-foreground">
                          {worktree.branch}
                          {worktree.locked ? " · locked" : ""}
                        </span>
                      )}
                    </span>
                  </BranchPickerRow>
                ))}
              </>
            )}
          </div>
        </MenuHoverProvider>
      </PopoverContent>
    </Popover>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_environmentProviderInputs({
    environmentProviderId: GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
    component: WorktreeInputsControl,
  });
});
