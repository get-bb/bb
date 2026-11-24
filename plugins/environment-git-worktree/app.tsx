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
  BranchPickerNavigation,
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
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";
import { blurActiveKeyboardInputWithin } from "@bb/shared-ui/overlay-trigger";
import { Pill } from "@bb/shared-ui/pill";
import { TruncateStart } from "@bb/shared-ui/truncate-start";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import {
  definePluginApp,
  experimental_useBranches,
  useBbNavigate,
  useRealtime,
  useRpc,
  type JsonValue,
  type PluginEnvironmentProviderInputsProps,
} from "@get-bb/plugin-sdk/app";
import { WARM_POOLS_CHANGED_CHANNEL } from "./channels.js";
import type { DiscoveredWorktree } from "./contract.js";
import { GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";
import { WarmPoolSettings } from "./warm-pool-settings.js";
import type { WorktreeInputs, worktreeRpcContract } from "./server.js";
import type { WarmPoolStatus } from "./warm-pools.js";

const DEFAULT_INPUTS: WorktreeInputs = {
  branch: { kind: "default" },
  folders: [],
};
const NEW_WORKTREE_LABEL = "New worktree";
const BRANCH_FROM_PREFIX = "Branch from:";
const REUSE_PREFIX = "Reuse:";
const EXISTING_WORKTREE_LABEL = "Existing worktree";
const NEW_WORKTREE_ROW_VALUE = "intent:new";
const EXISTING_WORKTREE_ROW_VALUE = "intent:existing";
const DEFAULT_BRANCH_ROW_VALUE = "default-branch";
const WORKTREE_SETTINGS_ROW_VALUE = "worktree-settings";

type WorktreeIntent = "new" | "existing";

function selectedBranchName(value: JsonValue | null): string | null {
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

function selectedFolders(value: JsonValue | null): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  const folders = value.folders;
  return Array.isArray(folders)
    ? folders.filter((folder): folder is string => typeof folder === "string")
    : [];
}

const REMEMBERED_FOLDERS_KEY = "bb.environment-git-worktree.folders";

function rememberedFoldersKey(projectId: string, hostId: string): string {
  return `${REMEMBERED_FOLDERS_KEY}:${projectId}:${hostId}`;
}

function readRememberedFolders(
  projectId: string | null,
  hostId: string | null,
): string[] {
  if (projectId === null || hostId === null) return [];
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(rememberedFoldersKey(projectId, hostId)) ??
        "[]",
    );
    return Array.isArray(stored)
      ? stored.filter((folder): folder is string => typeof folder === "string")
      : [];
  } catch {
    return [];
  }
}

function rememberFolders(
  projectId: string | null,
  hostId: string | null,
  folders: readonly string[],
): void {
  if (projectId === null || hostId === null) return;
  try {
    const key = rememberedFoldersKey(projectId, hostId);
    if (folders.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(folders));
  } catch {
    return;
  }
}

function folderLabel(folderPath: string): string {
  return folderPath.split(/[\\/]/u).filter(Boolean).at(-1) ?? folderPath;
}

function folderRowValue(folderPath: string): string {
  return `folder:${folderPath}`;
}

function selectedExistingPath(value: JsonValue | null): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value.kind === "existing" && typeof value.path === "string"
    ? value.path
    : null;
}

function branchRowValue(branch: string): string {
  return `branch:${branch}`;
}

function worktreeRowValue(path: string): string {
  return `worktree:${path}`;
}

function worktreePathLabel(path: string): string {
  return path.split("/").filter(Boolean).slice(-2).join("/") || path;
}

function filterBranches(branches: readonly string[], query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return [...branches];
  return branches.filter((branch) => branch.toLowerCase().includes(normalized));
}

function warmReadyCount(
  status: WarmPoolStatus,
  projectId: string,
  hostId: string,
): number {
  const pool = status.pools.find((entry) => entry.projectId === projectId);
  if (pool === undefined) return 0;
  return pool.checkouts
    .filter((checkout) => checkout.hostId === hostId && checkout.size > 0)
    .reduce((total, checkout) => total + checkout.ready, 0);
}

function warmWorktreesLabel(count: number): string {
  return count === 1 ? "1 warm worktree" : `${count} warm worktrees`;
}

function WorktreeInputsControl({
  projectId,
  target,
  value,
  onChange,
}: PluginEnvironmentProviderInputsProps) {
  const hostId = target.kind === "existing-host" ? target.hostId : null;
  const rpc = useRpc<typeof worktreeRpcContract>();
  const navigate = useBbNavigate();
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
  const [warmResult, setWarmResult] = useState<{
    projectId: string;
    hostId: string;
    ready: number;
  } | null>(null);
  const warmRequest = useRef(0);
  const [folderResult, setFolderResult] = useState<{
    projectId: string;
    hostId: string;
    folders: readonly string[] | null;
  } | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionsScrollRef = useRef<HTMLDivElement>(null);

  const existingPath = selectedExistingPath(value);
  const branchName = selectedBranchName(value);
  const folders = selectedFolders(value);
  const selectedIntent: WorktreeIntent =
    existingPath === null ? "new" : "existing";
  const [intent, setIntent] = useState<WorktreeIntent>(selectedIntent);

  const branchState = experimental_useBranches({
    hostId,
    projectId,
    query: intent === "new" ? deferredQuery.trim().toLowerCase() : "",
  });

  useEffect(() => {
    if (value !== null) return;
    onChange({
      status: "ready",
      value: {
        ...DEFAULT_INPUTS,
        folders: readRememberedFolders(projectId, hostId),
      },
    });
  }, [value, onChange, projectId, hostId]);

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

  const refreshWarmPool = useCallback(() => {
    const request = ++warmRequest.current;
    if (!open || projectId === null || hostId === null) return;
    rpc.call("warmPoolStatus", {}).then(
      (status) => {
        if (request === warmRequest.current)
          setWarmResult({
            projectId,
            hostId,
            ready: warmReadyCount(status, projectId, hostId),
          });
      },
      () => {
        if (request === warmRequest.current)
          setWarmResult({ projectId, hostId, ready: 0 });
      },
    );
  }, [open, projectId, hostId, rpc]);

  useEffect(() => {
    refreshWarmPool();
    return () => {
      warmRequest.current += 1;
    };
  }, [refreshWarmPool]);
  useRealtime(WARM_POOLS_CHANGED_CHANNEL, refreshWarmPool);

  const hasFolders = folders.length > 0;
  useEffect(() => {
    if ((!open && !hasFolders) || projectId === null || hostId === null) return;
    let active = true;
    rpc.call("listBranchableFolders", { projectId, hostId }).then(
      (result) => {
        if (active)
          setFolderResult({ projectId, hostId, folders: result.folders });
      },
      () => {
        if (active) setFolderResult({ projectId, hostId, folders: null });
      },
    );
    return () => {
      active = false;
    };
  }, [open, hasFolders, projectId, hostId, rpc]);

  const loadedFolders =
    folderResult?.projectId === projectId && folderResult?.hostId === hostId
      ? folderResult.folders
      : null;
  useEffect(() => {
    if (loadedFolders === null) return;
    const current = selectedFolders(value);
    const kept = current.filter((folder) => loadedFolders.includes(folder));
    if (kept.length === current.length) return;
    rememberFolders(
      projectId,
      hostId,
      readRememberedFolders(projectId, hostId).filter((folder) =>
        loadedFolders.includes(folder),
      ),
    );
    onChange({
      status: "ready",
      value: {
        branch:
          branchName === null
            ? { kind: "default" }
            : { kind: "named", name: branchName },
        folders: kept,
      },
    });
  }, [value, loadedFolders, branchName, onChange, projectId, hostId]);

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

  const firstSelectableWorktree = worktreeOptions.find(
    (worktree) => !worktree.prunable,
  );
  const searchHighlight =
    intent === "new"
      ? branchOptions[0] === undefined
        ? undefined
        : branchRowValue(branchOptions[0])
      : firstSelectableWorktree === undefined
        ? undefined
        : worktreeRowValue(firstSelectableWorktree.path);

  const defaultBase =
    baseResult?.projectId === projectId && baseResult?.hostId === hostId
      ? baseResult.branch
      : null;
  const baseBranchLabel = branchName ?? defaultBase ?? "default";
  const warmReady =
    warmResult?.projectId === projectId && warmResult?.hostId === hostId
      ? warmResult.ready
      : 0;
  const offeredFolders = loadedFolders ?? [];
  const folderOptions = [
    ...offeredFolders,
    ...folders.filter((folder) => !offeredFolders.includes(folder)),
  ];
  const triggerPrefix =
    existingPath === null ? BRANCH_FROM_PREFIX : REUSE_PREFIX;
  const triggerValue =
    existingPath === null
      ? folders.length === 0
        ? baseBranchLabel
        : `${baseBranchLabel} +${folders.length} ${folders.length === 1 ? "folder" : "folders"}`
      : worktreePathLabel(existingPath);
  const triggerTitle =
    existingPath ??
    (folders.length === 0
      ? `Create a worktree from ${baseBranchLabel}`
      : `Create a worktree from ${baseBranchLabel}, and worktrees of ${folders.join(", ")} from their default branches`);

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
  const toggleFolder = (folder: string) => {
    const nextFolders = folders.includes(folder)
      ? folders.filter((entry) => entry !== folder)
      : [...folders, folder];
    rememberFolders(projectId, hostId, nextFolders);
    onChange({
      status: "ready",
      value: {
        branch:
          branchName === null
            ? { kind: "default" }
            : { kind: "named", name: branchName },
        folders: nextFolders,
      },
    });
  };
  const openWorktreeSettings = () => {
    updateOpen(false);
    navigate.experimental_toSettings();
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
            <span className="flex min-w-0 items-baseline gap-1 truncate">
              <span
                data-promptbox-hide-compact=""
                className="shrink-0 text-muted-foreground"
              >
                {triggerPrefix}
              </span>
              <span className="min-w-0 truncate font-medium text-foreground">
                {triggerValue}
              </span>
            </span>
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
        <BranchPickerNavigation
          highlight={searchHighlight}
          query={deferredQuery}
        >
          <BranchPickerSearch
            inputRef={inputRef}
            query={query}
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
            className="min-h-0 max-h-[60vh] overflow-y-auto overscroll-contain px-1 pb-1 pt-0 md:h-80"
            onWheel={(event) => event.stopPropagation()}
          >
            <BranchPickerSectionHeader label="Work in:" sticky={false} />
            <BranchPickerRow
              value={NEW_WORKTREE_ROW_VALUE}
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
              value={EXISTING_WORKTREE_ROW_VALUE}
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
                {folderOptions.length > 0 && query.trim() === "" ? (
                  <>
                    <BranchPickerSectionHeader label="Folder worktrees:" />
                    {folderOptions.map((folder) => (
                      <BranchPickerRow
                        key={folder}
                        value={folderRowValue(folder)}
                        icon="FolderGit"
                        selected={folders.includes(folder)}
                        title={`Give this thread its own worktree of ${folder}, started from that repository's default branch and named like the thread's branch, instead of the shared folder`}
                        onSelect={() => toggleFolder(folder)}
                        align="first-line"
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="min-w-0 truncate">
                            {folderLabel(folder)}
                          </span>
                          <TruncateStart className="text-muted-foreground">
                            {folder}
                          </TruncateStart>
                        </span>
                      </BranchPickerRow>
                    ))}
                    <div className="my-1 h-px bg-border/60" />
                  </>
                ) : null}
                <BranchPickerSectionHeader label="Branch from:" />
                <BranchPickerRow
                  value={DEFAULT_BRANCH_ROW_VALUE}
                  icon="GitMerge"
                  selected={existingPath === null && branchName === null}
                  title={
                    warmReady > 0
                      ? `Use the repository's default branch. ${warmWorktreesLabel(warmReady)} ready, so the thread starts right away.`
                      : "Use the repository's default branch"
                  }
                  onSelect={() =>
                    submit({ branch: { kind: "default" }, folders })
                  }
                >
                  <span className="min-w-0 flex-1 truncate">
                    Default branch
                  </span>
                  {warmReady > 0 ? (
                    <>
                      {" "}
                      <Pill variant="secondary" size="sm" className="shrink-0">
                        {warmReady} warm
                      </Pill>
                    </>
                  ) : null}
                </BranchPickerRow>
                {branchOptions.map((branch) => (
                  <BranchPickerRow
                    key={branch}
                    value={branchRowValue(branch)}
                    icon="GitMerge"
                    selected={branch === branchName}
                    title={branch}
                    onSelect={() =>
                      submit({
                        branch: { kind: "named", name: branch },
                        folders,
                      })
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
                    value={worktreeRowValue(worktree.path)}
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
          <div className="border-t border-border/60 p-1">
            <BranchPickerRow
              value={WORKTREE_SETTINGS_ROW_VALUE}
              icon="Settings"
              selected={false}
              title="Open worktree settings, such as warm worktrees"
              onSelect={openWorktreeSettings}
            >
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                Worktree settings
              </span>
            </BranchPickerRow>
          </div>
        </BranchPickerNavigation>
      </PopoverContent>
    </Popover>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "warm-worktrees",
    title: "Warm worktrees",
    description:
      "Worktrees set up ahead of time, so new threads on the default branch start right away. Each machine keeps the project's count unless you set its own.",
    component: WarmPoolSettings,
  });
  app.slots.experimental_environmentProviderInputs({
    environmentProviderId: GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
    component: WorktreeInputsControl,
  });
});
