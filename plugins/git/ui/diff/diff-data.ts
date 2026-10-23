import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  experimental_useRpcKeyedQuery as useRpcKeyedQuery,
  experimental_useRpcMutation as useRpcMutation,
  experimental_useRpcQuery as useRpcQuery,
} from "@get-bb/plugin-sdk/app";
import {
  GIT_PATCHES_MAX_KEYS,
  gitPatchKey,
  type DiffFileEntry,
  type DiffPatchEntry,
  type GitFilesResult,
  type GitPatchResult,
  type WorkspaceDiffTarget,
} from "../../contract.js";
import { gitRpcContract } from "../../rpc-contract.js";
import { useGitViewed } from "../queries.js";
import type { DiffViewedFile } from "@bb/server-contract";

const UNCOMMITTED_TARGET: WorkspaceDiffTarget = { type: "uncommitted" };
const PATCH_REQUEST_DEBOUNCE_MS = 80;

interface ShownDiffFiles {
  target: WorkspaceDiffTarget;
  ignoreWhitespace: boolean;
  result: GitFilesResult;
}

export function useDiffFiles(args: {
  environmentId: string;
  target: WorkspaceDiffTarget | undefined;
  ignoreWhitespace: boolean;
  enabled: boolean;
}) {
  const query = useRpcQuery({
    contract: gitRpcContract,
    method: "files",
    input: {
      environmentId: args.environmentId,
      target: args.target ?? UNCOMMITTED_TARGET,
      ignoreWhitespace: args.ignoreWhitespace,
    },
    enabled: args.enabled && args.target !== undefined,
  });
  const [shown, setShown] = useState<ShownDiffFiles | null>(null);
  if (
    query.data !== undefined &&
    args.target !== undefined &&
    shown?.result !== query.data
  ) {
    setShown({
      target: args.target,
      ignoreWhitespace: args.ignoreWhitespace,
      result: query.data,
    });
  }
  const current =
    query.data !== undefined && args.target !== undefined
      ? {
          target: args.target,
          ignoreWhitespace: args.ignoreWhitespace,
          result: query.data,
        }
      : query.isLoading
        ? shown
        : null;
  return {
    shown: current,
    error: query.error,
    isLoading: query.isLoading && current === null,
    isPlaceholder: query.data === undefined && current !== null,
  };
}

function viewedQueryInput(
  environmentId: string,
  target: WorkspaceDiffTarget,
  paths: readonly string[],
) {
  return { environmentId, target, paths: [...paths].sort() };
}

export function useDiffViewedRevisions(args: {
  environmentId: string;
  target: WorkspaceDiffTarget | undefined;
  paths: readonly string[];
  enabled: boolean;
}): {
  viewedRevisionByPath: ReadonlyMap<string, string>;
  isLoaded: boolean;
} {
  const { data } = useGitViewed({
    environmentId: args.environmentId,
    target: args.target,
    paths: args.paths,
    enabled: args.enabled && args.paths.length > 0,
  });
  const viewedRevisionByPath = useMemo(
    () =>
      new Map((data?.files ?? []).map((file) => [file.path, file.revision])),
    [data],
  );
  return { viewedRevisionByPath, isLoaded: data !== undefined };
}

function withViewed(
  files: readonly DiffViewedFile[],
  path: string,
  revision: string | null,
): DiffViewedFile[] {
  const rest = files.filter((file) => file.path !== path);
  return revision === null ? rest : [...rest, { path, revision }];
}

export function useSetDiffFileViewed(args: {
  environmentId: string;
  target: WorkspaceDiffTarget;
  paths: readonly string[];
}): (entry: DiffFileEntry, viewed: boolean) => void {
  const { environmentId, target, paths } = args;
  const viewedInput = viewedQueryInput(environmentId, target, paths);
  const { mutate: markViewed } = useRpcMutation({
    contract: gitRpcContract,
    method: "markViewed",
    optimistic: (input, cache) => {
      cache.update("viewed", viewedInput, (current) => ({
        files: withViewed(current.files, input.path, input.revision),
      }));
    },
  });
  const { mutate: clearViewed } = useRpcMutation({
    contract: gitRpcContract,
    method: "clearViewed",
    optimistic: (input, cache) => {
      const { path } = input;
      if (path === undefined) return;
      cache.update("viewed", viewedInput, (current) => ({
        files: withViewed(current.files, path, null),
      }));
    },
  });
  return useCallback(
    (entry: DiffFileEntry, viewed: boolean) => {
      const request = viewed
        ? markViewed({
            environmentId,
            target,
            path: entry.path,
            revision: entry.revision,
          })
        : clearViewed({ environmentId, target, path: entry.path });
      void request.catch(() => {
        toast.error("Failed to update Viewed.");
      });
    },
    [clearViewed, environmentId, markViewed, target],
  );
}

type DiffPatchStatus = "idle" | "loading" | "loaded" | "error";

export interface DiffPatchState {
  status: DiffPatchStatus;
  patch?: string;
  truncated?: boolean;
  error?: string;
}

const EMPTY_PATHS: ReadonlySet<string> = new Set();
const IDLE_PATCH_STATE: DiffPatchState = { status: "idle" };
const LOADING_PATCH_STATE: DiffPatchState = { status: "loading" };
const FAILED_PATCH_MESSAGE = "Failed to load file diff";

function patchResultState(result: GitPatchResult): DiffPatchState {
  switch (result.outcome) {
    case "available":
      return {
        status: "loaded",
        patch: result.patch.patch,
        truncated: result.patch.truncated,
      };
    case "not_applicable":
      return { status: "error", error: result.message };
    case "unavailable":
      return { status: "error", error: result.failure.message };
  }
}

export interface DiffPatchStates {
  getPatchState(path: string): DiffPatchState;
  loadPath(path: string): void;
  retry(path: string): void;
}

export function useDiffPatchStates(args: {
  environmentId: string;
  target: WorkspaceDiffTarget;
  ignoreWhitespace: boolean;
  files: readonly DiffFileEntry[];
  initialPatches: readonly DiffPatchEntry[];
  requestedPaths: readonly string[];
  enabled: boolean;
}): DiffPatchStates {
  const {
    environmentId,
    target,
    ignoreWhitespace,
    files,
    initialPatches,
    requestedPaths,
    enabled,
  } = args;
  const keyByPath = useMemo(
    () =>
      new Map(
        files.map((file) => [
          file.path,
          gitPatchKey({
            environmentId,
            target,
            ignoreWhitespace,
            path: file.path,
            revision: file.revision,
          }),
        ]),
      ),
    [environmentId, files, ignoreWhitespace, target],
  );
  const initialPatchByPath = useMemo(
    () => new Map(initialPatches.map((entry) => [entry.path, entry])),
    [initialPatches],
  );
  const scope = JSON.stringify([environmentId, target, ignoreWhitespace]);
  const [retained, setRetained] = useState<
    ReadonlyMap<string, GitPatchResult>
  >(() => new Map());
  const [manual, setManual] = useState<{
    scope: string;
    paths: ReadonlySet<string>;
  }>(() => ({ scope, paths: new Set() }));
  const manualPaths = manual.scope === scope ? manual.paths : EMPTY_PATHS;
  const keys = useMemo(() => {
    const ordered: string[] = [];
    for (const path of [...requestedPaths, ...manualPaths]) {
      const key = keyByPath.get(path);
      if (
        key === undefined ||
        initialPatchByPath.has(path) ||
        retained.get(key)?.outcome === "available" ||
        ordered.includes(key)
      ) {
        continue;
      }
      ordered.push(key);
    }
    return ordered.slice(0, GIT_PATCHES_MAX_KEYS);
  }, [initialPatchByPath, keyByPath, manualPaths, requestedPaths, retained]);
  const keysSignature = keys.join("\n");
  const [requestedSignature, setRequestedSignature] = useState(keysSignature);
  useEffect(() => {
    const timer = setTimeout(
      () => setRequestedSignature(keysSignature),
      PATCH_REQUEST_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [keysSignature]);
  const requestedKeys = useMemo(
    () => (requestedSignature === "" ? [] : requestedSignature.split("\n")),
    [requestedSignature],
  );
  const query = useRpcKeyedQuery({
    contract: gitRpcContract,
    method: "patches",
    keys: requestedKeys,
    enabled: enabled && requestedKeys.length > 0,
  });
  const rows = query.data;
  useEffect(() => {
    const liveKeys = new Set(keyByPath.values());
    setRetained((current) => {
      const next = new Map(
        [...current].filter(([key]) => liveKeys.has(key)),
      );
      for (const [path, entry] of initialPatchByPath) {
        const key = keyByPath.get(path);
        if (key !== undefined && !next.has(key)) {
          next.set(key, { outcome: "available", patch: entry });
        }
      }
      for (const [key, value] of Object.entries(rows ?? {})) {
        if (liveKeys.has(key)) next.set(key, value);
      }
      const unchanged =
        next.size === current.size &&
        [...next].every(([key, value]) => current.get(key) === value);
      return unchanged ? current : next;
    });
  }, [initialPatchByPath, keyByPath, rows]);

  const { error, isFetching, refetchKeys } = query;
  const [retryingKeys, setRetryingKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const subscribedKeys = useMemo(() => new Set(keys), [keys]);
  const getPatchState = useCallback(
    (path: string): DiffPatchState => {
      const initial = initialPatchByPath.get(path);
      if (initial !== undefined) {
        return {
          status: "loaded",
          patch: initial.patch,
          truncated: initial.truncated,
        };
      }
      const key = keyByPath.get(path);
      if (key === undefined) return IDLE_PATCH_STATE;
      if (retryingKeys.has(key)) return LOADING_PATCH_STATE;
      const row = rows?.[key] ?? retained.get(key);
      if (row !== undefined) return patchResultState(row);
      if (!subscribedKeys.has(key)) return IDLE_PATCH_STATE;
      if (error !== null && !isFetching) {
        return {
          status: "error",
          error: error.message || FAILED_PATCH_MESSAGE,
        };
      }
      return LOADING_PATCH_STATE;
    },
    [
      error,
      initialPatchByPath,
      isFetching,
      keyByPath,
      retained,
      retryingKeys,
      rows,
      subscribedKeys,
    ],
  );
  const loadPath = useCallback(
    (path: string) => {
      setManual((current) => {
        const paths = current.scope === scope ? current.paths : EMPTY_PATHS;
        return paths.has(path)
          ? current
          : { scope, paths: new Set([...paths, path]) };
      });
    },
    [scope],
  );
  const retry = useCallback(
    (path: string) => {
      loadPath(path);
      const key = keyByPath.get(path);
      if (key === undefined) return;
      setRetryingKeys((current) => new Set([...current, key]));
      void refetchKeys([key]).finally(() => {
        setRetryingKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      });
    },
    [keyByPath, loadPath, refetchKeys],
  );
  return useMemo(
    () => ({ getPatchState, loadPath, retry }),
    [getPatchState, loadPath, retry],
  );
}
