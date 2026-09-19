import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
const BRANCH_FROM_PREFIX = "Branch from:";
const REUSE_PREFIX = "Reuse:";
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

export function worktreePathLabel(path: string): string {
  return path.split("/").filter(Boolean).slice(-2).join("/") || path;
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
  const [worktreeResult, setWorktreeResult] = useState<{
    projectId: string;
    hostId: string;
    worktrees: readonly DiscoveredWorktree[];
    loading: boolean;
    error: boolean;
  } | null>(null);
  const worktreeRequest = useRef(0);
  const scopedWorktreeResult =
    worktreeResult?.projectId === projectId && worktreeResult?.hostId === hostId
      ? worktreeResult
      : null;
  const worktrees = scopedWorktreeResult?.worktrees ?? [];
  const [baseResult, setBaseResult] = useState<{
    projectId: string;
    hostId: string | null;
    branch: string | null;
  } | null>(null);
  const [baseRefresh, setBaseRefresh] = useState(0);
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
    query: intent === "new" ? deferredQuery.trim().toLowerCase() : "",
  });

  useEffect(() => {
    if (value === null) onChange({ status: "ready", value: DEFAULT_INPUTS });
  }, [value, onChange]);

  const refreshWorktrees = useCallback(async () => {
    const request = ++worktreeRequest.current;
    if (projectId === null || hostId === null) {
      setWorktreeResult(null);
      return;
    }
    setWorktreeResult({
      projectId,
      hostId,
      worktrees: [],
      loading: true,
      error: false,
    });
    try {
      const result = await rpc.call("listExistingWorktrees", {
        projectId,
        hostId,
      });
      if (request === worktreeRequest.current) {
        setWorktreeResult({
          projectId,
          hostId,
          worktrees: result.worktrees,
          loading: false,
          error: false,
        });
      }
    } catch {
      if (request === worktreeRequest.current)
        setWorktreeResult({
          projectId,
          hostId,
          worktrees: [],
          loading: false,
          error: true,
        });
    }
  }, [projectId, hostId, rpc]);

  useEffect(() => {
    return () => {
      worktreeRequest.current += 1;
    };
  }, [refreshWorktrees]);

  useEffect(() => {
    if (projectId === null || branchName !== null || existingPath !== null)
      return;
    let active = true;
    void rpc
      .call("defaultBaseBranch", { projectId, hostId })
      .then((result) => {
        if (active) setBaseResult({ projectId, hostId, branch: result.branch });
      })
      .catch(() => {
        if (active) setBaseResult({ projectId, hostId, branch: null });
      });
    return () => {
      active = false;
    };
  }, [projectId, hostId, branchName, existingPath, baseRefresh, rpc]);

  useEffect(() => {
    if (open) setIntent(selectedIntent);
  }, [open, selectedIntent]);

  useEffect(() => {
    if (optionsScrollRef.current) optionsScrollRef.current.scrollTop = 0;
  }, [intent, query]);

  const branchOptions = useMemo(
    () =>
      filterBranches(
        [...new Set([...branchState.branches, ...branchState.remoteBranches])],
        deferredQuery,
      ),
    [branchState.branches, branchState.remoteBranches, deferredQuery],
  );

  const worktreeOptions = worktrees.filter((worktree) =>
    [worktree.path, worktree.branch ?? ""].some((value) =>
      value.toLowerCase().includes(deferredQuery.trim().toLowerCase()),
    ),
  );

  const defaultBase =
    baseResult?.projectId === projectId && baseResult?.hostId === hostId
      ? baseResult.branch
      : null;
  const baseBranchLabel = branchName ?? defaultBase ?? "default";
  const triggerLabel =
    existingPath === null
      ? `${BRANCH_FROM_PREFIX} ${baseBranchLabel}`
      : `${REUSE_PREFIX} ${worktreePathLabel(existingPath)}`;
  const triggerTitle =
    existingPath ?? `Create a worktree from ${baseBranchLabel}`;

  const updateOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      blurActiveKeyboardInputWithin(inputRef.current);
      setQuery("");
    } else {
      void branchState
        .refresh()
        .then(() => setBaseRefresh((value) => value + 1))
        .catch(() => undefined);
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
              name="GitMerge"
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
        autoFocusRef={inputRef}
        className={cn(BRANCH_PICKER_CONTENT_CLASS_NAME, "md:w-72")}
      >
        <MenuHoverProvider>
          <BranchPickerSearch
            inputRef={inputRef}
            query={query}
            enterSelection={
              intent === "new"
                ? branchOptions[0]
                : worktreeOptions.find((worktree) => !worktree.prunable)?.path
            }
            onEnterSelection={(selection) =>
              submit(
                intent === "new"
                  ? { branch: { kind: "named", name: selection } }
                  : { kind: "existing", path: selection },
              )
            }
            onQueryChange={setQuery}
            ariaLabel={
              intent === "new" ? "Search branches" : "Search worktrees"
            }
            placeholder={
              intent === "new" ? "Search branches" : "Search worktrees"
            }
          />
          <div
            ref={optionsScrollRef}
            className="h-80 min-h-0 max-h-[60vh] overflow-y-auto overscroll-contain px-1 pb-1 pt-0"
            onWheel={(event) => event.stopPropagation()}
          >
            <BranchPickerSectionHeader label="Work in:" sticky={false} />
            <BranchPickerRow
              icon="Plus"
              selected={intent === "new"}
              title="Create a worktree for this thread"
              onSelect={() => {
                setIntent("new");
                setQuery("");
              }}
            >
              <span className="min-w-0 flex-1 truncate">
                {NEW_WORKTREE_LABEL}
              </span>
            </BranchPickerRow>
            <BranchPickerRow
              icon="FolderGit"
              disabled={projectId === null || hostId === null}
              selected={intent === "existing"}
              title="Use a worktree you already have"
              onSelect={() => {
                setIntent("existing");
                setQuery("");
                void refreshWorktrees();
              }}
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
                {worktreeOptions.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    {scopedWorktreeResult?.loading
                      ? "Loading worktrees..."
                      : scopedWorktreeResult?.error
                        ? "Could not load worktrees. Select Existing worktree to retry."
                        : scopedWorktreeResult === null
                          ? "Select Existing worktree to load worktrees."
                          : worktrees.length === 0
                            ? "No existing worktrees found."
                            : "No matching worktrees found."}
                  </p>
                ) : null}
                {worktreeOptions.map((worktree) => (
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
                      <span className="min-w-0 truncate text-left [direction:rtl]">
                        <bdi dir="ltr">{worktree.path}</bdi>
                      </span>
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        {worktree.branch ?? "Detached HEAD"}
                        {worktree.locked ? " · locked" : ""}
                        {worktree.prunable ? " · prunable" : ""}
                      </span>
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
