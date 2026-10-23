import { useEffect } from "react";
import type { z } from "zod";
import {
  GIT_PLUGIN_ID,
  type WorkspaceDiffTarget,
  type JsonValue,
} from "@bb/domain";
import { gitPatchKey, type DiffPatchEntry, type GitPatchResult } from "bb-plugin-bb--git/contract";
import { gitRpcContract } from "bb-plugin-bb--git/rpc-contract";
import { sdk } from "@/lib/sdk";
import { wsManager } from "@/lib/ws";

type GitRpcContract = typeof gitRpcContract;
type GitReadMethod =
  | "workspaceStatus"
  | "files"
  | "patches"
  | "fileSide"
  | "branches";
type GitReadInput<Method extends GitReadMethod> = z.input<
  GitRpcContract[Method]["input"]
> &
  JsonValue;

function callGitRead<Output>(
  method: GitReadMethod,
  input: JsonValue,
  outputSchema: z.ZodType<Output>,
  signal: AbortSignal | undefined,
): Promise<Output> {
  return sdk.plugins.callRpc({
    pluginId: GIT_PLUGIN_ID,
    method,
    input,
    outputSchema,
    ...(signal === undefined ? {} : { signal }),
  });
}

export type GitPatchPage =
  | { outcome: "available"; patches: DiffPatchEntry[] }
  | Exclude<GitPatchResult, { outcome: "available" }>;

async function readPatchPage(args: {
  environmentId: string;
  target: WorkspaceDiffTarget;
  ignoreWhitespace: boolean;
  paths: string[];
  signal: AbortSignal;
}): Promise<GitPatchPage> {
  const keys = args.paths.map((path) =>
    gitPatchKey({
      environmentId: args.environmentId,
      target: args.target,
      ignoreWhitespace: args.ignoreWhitespace,
      path,
      revision: "current",
    }),
  );
  const rows = await callGitRead(
    "patches",
    { keys },
    gitRpcContract.patches.output,
    args.signal,
  );
  const patches: DiffPatchEntry[] = [];
  for (const key of keys) {
    const row = rows[key];
    if (row === undefined) continue;
    if (row.outcome !== "available") return row;
    patches.push(row.patch);
  }
  return { outcome: "available", patches };
}

export const gitPluginReads = {
  workspaceStatus: (
    input: GitReadInput<"workspaceStatus">,
    signal?: AbortSignal,
  ) =>
    callGitRead(
      "workspaceStatus",
      input,
      gitRpcContract.workspaceStatus.output,
      signal,
    ),
  files: (input: GitReadInput<"files">, signal?: AbortSignal) =>
    callGitRead("files", input, gitRpcContract.files.output, signal),
  patchPage: readPatchPage,
  fileSide: (input: GitReadInput<"fileSide">, signal?: AbortSignal) =>
    callGitRead("fileSide", input, gitRpcContract.fileSide.output, signal),
  branches: (input: GitReadInput<"branches">, signal?: AbortSignal) =>
    callGitRead("branches", input, gitRpcContract.branches.output, signal),
};

export function useGitPluginWatch(
  environmentId: string | null | undefined,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled || !environmentId) return;
    const target = {
      kind: "plugin-read",
      pluginId: GIT_PLUGIN_ID,
      method: "status",
      read: { key: environmentId },
    } as const;
    wsManager.subscribe(target);
    return () => wsManager.unsubscribe(target);
  }, [environmentId, enabled]);
}
