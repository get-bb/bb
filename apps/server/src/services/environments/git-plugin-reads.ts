import { GIT_PLUGIN_ID } from "@bb/domain";
import {
  type ThreadGitDiffResponse,
  type WorkspaceStatus,
  gitDiffResultSchema,
  gitStatusResultSchema,
} from "bb-plugin-bb--git/contract";
import type {
  WorkspaceResolutionFailure,
} from "@bb/host-daemon-contract/workspace";
import { ApiError } from "../../errors.js";
import type { PluginService } from "../plugins/plugin-service.js";

export type GitPluginRpc = Pick<
  PluginService,
  "getRpcHandler" | "invokeRpcHandler"
>;

type UnavailableLookup = Exclude<
  ReturnType<GitPluginRpc["getRpcHandler"]>,
  { outcome: "found" }
>;

const PLUGIN_STATE_TEXT = {
  disabled: null,
  starting: "still starting",
  error: "failing to load",
  incompatible: "incompatible with this bb",
  missing: "missing its files",
  degraded: "degraded",
  "needs-configuration": "waiting for configuration",
  running: "loaded without its reads",
} as const;

function pluginState(lookup: UnavailableLookup): string | null {
  if (lookup.outcome === "unknown-plugin") return null;
  if (lookup.outcome !== "not-running") return PLUGIN_STATE_TEXT.running;
  return PLUGIN_STATE_TEXT[lookup.status];
}

function unavailableMessage(lookup: UnavailableLookup): string {
  const state = pluginState(lookup);
  if (state === null) {
    return "Turn on the Git plugin to read this environment's changes";
  }
  const detail =
    lookup.outcome === "not-running" && lookup.detail !== null
      ? ` (${lookup.detail})`
      : "";
  return `The Git plugin is ${state}${detail}. Reload it in Settings → Plugins to read this environment's changes`;
}

async function callGitPlugin(
  plugins: GitPluginRpc,
  method: string,
  input: unknown,
): Promise<unknown> {
  const lookup = plugins.getRpcHandler(GIT_PLUGIN_ID, method);
  if (lookup.outcome !== "found") {
    throw new ApiError(409, "git_plugin_unavailable", unavailableMessage(lookup));
  }
  const outcome = await plugins.invokeRpcHandler(
    lookup.owner,
    method,
    lookup.value,
    input,
    { kind: "client" },
    null,
  );
  if (!outcome.ok) {
    throw new ApiError(
      outcome.error.code === "conflict" ? 409 : 502,
      outcome.error.code === "conflict"
        ? "environment_not_ready"
        : "git_plugin_failed",
      outcome.error.message,
    );
  }
  return outcome.result;
}

function throwWorkspaceUnavailable(failure: WorkspaceResolutionFailure): never {
  throw new ApiError(409, "workspace_unavailable", failure.message, {
    details: { kind: "workspace_unavailable", failure },
  });
}

function throwUnavailableRead(
  result:
    | { outcome: "not_applicable"; message: string }
    | { outcome: "unavailable"; failure: WorkspaceResolutionFailure },
  workspacePath: string,
): never {
  if (result.outcome === "unavailable") throwWorkspaceUnavailable(result.failure);
  throwWorkspaceUnavailable({
    code: "not_git_repo",
    message: result.message,
    workspacePath,
  });
}

export async function refreshGitState(
  plugins: GitPluginRpc,
  environmentId: string,
): Promise<void> {
  const lookup = plugins.getRpcHandler(GIT_PLUGIN_ID, "refresh");
  if (lookup.outcome !== "found") return;
  await plugins.invokeRpcHandler(
    lookup.owner,
    "refresh",
    lookup.value,
    { environmentId },
    { kind: "client" },
    null,
  );
}

export async function readCommitInputs(
  plugins: GitPluginRpc,
  args: {
    environmentId: string;
    workspacePath: string;
    maxDiffBytes: number;
    maxFileListBytes: number;
  },
): Promise<{ status: WorkspaceStatus; diff: ThreadGitDiffResponse }> {
  const [status, diff] = await Promise.all([
    callGitPlugin(plugins, "workspaceStatus", {
      environmentId: args.environmentId,
    }).then((raw) => gitStatusResultSchema.parse(raw)),
    callGitPlugin(plugins, "diff", {
      environmentId: args.environmentId,
      target: { type: "uncommitted" },
      maxDiffBytes: args.maxDiffBytes,
      maxFileListBytes: args.maxFileListBytes,
    }).then((raw) => gitDiffResultSchema.parse(raw)),
  ]);
  if (status.outcome !== "available") {
    throwUnavailableRead(status, args.workspacePath);
  }
  if (diff.outcome !== "available") {
    throwUnavailableRead(diff, args.workspacePath);
  }
  return { status: status.workspace, diff: diff.diff };
}
