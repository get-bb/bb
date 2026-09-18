import { useEffect, useState } from "react";
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
const NEW_WORKTREE_VALUE = "";

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

function worktreeLabel(worktree: DiscoveredWorktree): string {
  const name = worktree.path.split("/").filter(Boolean).at(-1) ?? worktree.path;
  const suffix = worktree.locked ? " (locked)" : "";
  return worktree.branch === null
    ? `${name}${suffix}`
    : `${name} · ${worktree.branch}${suffix}`;
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

  if (worktrees.length === 0 && existingPath === null) {
    return (
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
  }

  return (
    <>
      <select
        aria-label="Worktree"
        value={existingPath ?? NEW_WORKTREE_VALUE}
        className="h-7 max-w-52 truncate rounded-md border border-input bg-background px-2 text-xs text-foreground"
        onChange={(event) => {
          onChange({
            status: "ready",
            value:
              event.target.value === NEW_WORKTREE_VALUE
                ? DEFAULT_INPUTS
                : { kind: "existing", path: event.target.value },
          });
        }}
      >
        <option value={NEW_WORKTREE_VALUE}>New worktree</option>
        {worktrees.map((worktree) => (
          <option key={worktree.path} value={worktree.path}>
            {worktreeLabel(worktree)}
          </option>
        ))}
        {existingPath !== null &&
        !worktrees.some((worktree) => worktree.path === existingPath) ? (
          <option value={existingPath}>{existingPath}</option>
        ) : null}
      </select>
      {existingPath === null ? (
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
      ) : null}
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_environmentProviderInputs({
    environmentProviderId: GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
    component: WorktreeInputsControl,
  });
});
