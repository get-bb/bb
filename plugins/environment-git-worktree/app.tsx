import { useEffect, useState } from "react";
import {
  BRANCH_PICKER_CONTENT_CLASS_NAME,
  BranchPickerRow,
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
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import {
  definePluginApp,
  experimental_BranchPicker,
  useRpc,
  type JsonValue,
  type PluginEnvironmentProviderInputsProps,
} from "@get-bb/plugin-sdk/app";
import type { DiscoveredWorktree } from "./contract.js";
import { GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";
import type { WorktreeInputs, worktreeRpcContract } from "./server.js";

const BranchPicker = experimental_BranchPicker;
const DEFAULT_INPUTS: WorktreeInputs = { branch: { kind: "default" } };
const NEW_WORKTREE_LABEL = "New worktree";

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
  const existingPath = selectedExistingPath(value);

  useEffect(() => {
    if (value === null) {
      onChange({ status: "ready", value: DEFAULT_INPUTS });
    }
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

  const branchPicker = (
    <BranchPicker
      hostId={hostId}
      projectId={projectId}
      label="Branch from:"
      value={selectedBranchName(value)}
      onChange={(next) => {
        onChange({
          status: "ready",
          value:
            next === null
              ? DEFAULT_INPUTS
              : { branch: { kind: "named", name: next } },
        });
      }}
    />
  );

  if (worktrees.length === 0 && existingPath === null) return branchPicker;

  const selectWorktree = (path: string | null) => {
    onChange({
      status: "ready",
      value: path === null ? DEFAULT_INPUTS : { kind: "existing", path },
    });
    setOpen(false);
  };
  const triggerLabel =
    existingPath === null
      ? NEW_WORKTREE_LABEL
      : worktreeDirectoryName(existingPath);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
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
              title={existingPath ?? NEW_WORKTREE_LABEL}
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
          mobileTitle="Worktree"
          className={BRANCH_PICKER_CONTENT_CLASS_NAME}
        >
          <MenuHoverProvider>
            <div className="min-h-0 max-h-[60vh] overflow-y-auto overscroll-contain px-1 pb-1 pt-0 md:max-h-80">
              <BranchPickerSectionHeader label="Work in:" sticky={false} />
              <BranchPickerRow
                icon="Plus"
                selected={existingPath === null}
                title="Create a new worktree for this thread"
                onSelect={() => selectWorktree(null)}
              >
                <span className="min-w-0 flex-1 truncate">
                  {NEW_WORKTREE_LABEL}
                </span>
              </BranchPickerRow>
              {worktrees.length > 0 ? (
                <>
                  <div className="my-1 h-px bg-border/60" />
                  <BranchPickerSectionHeader label="Existing worktree:" />
                  {worktrees.map((worktree) => (
                    <BranchPickerRow
                      key={worktree.path}
                      icon="FolderGit"
                      selected={worktree.path === existingPath}
                      disabled={worktree.prunable}
                      title={worktree.path}
                      onSelect={() => selectWorktree(worktree.path)}
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
              ) : null}
            </div>
          </MenuHoverProvider>
        </PopoverContent>
      </Popover>
      {existingPath === null ? branchPicker : null}
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_environmentProviderInputs({
    environmentProviderId: GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
    component: WorktreeInputsControl,
  });
});
