import { type DiffPatchEntry } from "./read-contract.js";
import { useCallback, useMemo, useState } from "react";
import { experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import type { WorkspaceDiffTarget } from "bb-git-contract";
import { gitRpcContract } from "./contract.js";

export interface DiffPatchState {
  status: "idle" | "loading" | "loaded" | "error";
  patch?: string;
  truncated?: boolean;
  error?: string;
}
export type LoadDiffPatchPath = (path: string) => void;
export type RetryDiffPatchPath = (path: string) => void;
const EMPTY_PATCHES: DiffPatchEntry[] = [];

export function useEnvironmentDiffPatches(
  environmentId: string,
  {
    target,
    ignoreWhitespace,
    initialPatches = EMPTY_PATCHES,
    paths,
  }: {
    target?: WorkspaceDiffTarget;
    ignoreWhitespace: boolean;
    initialPatches?: DiffPatchEntry[];
    paths?: readonly string[];
  },
) {
  const [requested, setRequested] = useState<string[]>([]);
  const [explicit, setExplicit] = useState<string[]>([]);
  const seeds = useMemo(
    () => new Map(initialPatches.map((patch) => [patch.path, patch])),
    [initialPatches],
  );
  const keyFor = useCallback(
    (path: string) =>
      JSON.stringify({ environmentId, target, path, ignoreWhitespace }),
    [environmentId, target, ignoreWhitespace],
  );
  const keys = useMemo(
    () =>
      [...new Set([...requested, ...explicit])]
        .filter(
          (path) =>
            !seeds.has(path) && (paths === undefined || paths.includes(path)),
        )
        .map(keyFor),
    [requested, explicit, seeds, keyFor, paths],
  );
  const query = experimental_useRpcKeyedQuery({
    contract: gitRpcContract,
    method: "patches",
    keys,
    enabled: target !== undefined && environmentId !== "",
  });
  const requestPaths = useCallback(
    ({ visible, overscan }: { visible: string[]; overscan: string[] }) => {
      const paths = [...new Set([...visible, ...overscan])];
      setRequested((prior) =>
        prior.length === paths.length &&
        prior.every((path, index) => path === paths[index])
          ? prior
          : paths,
      );
    },
    [],
  );
  const loadPath = useCallback(
    (path: string) =>
      setExplicit((paths) => (paths.includes(path) ? paths : [...paths, path])),
    [],
  );
  return {
    requestPaths,
    loadPath,
    retry(path: string) {
      loadPath(path);
      void query.refetch();
    },
    getPatchState(path: string): DiffPatchState {
      const patch = seeds.get(path) ?? query.data?.[keyFor(path)];
      if (patch)
        return {
          status: "loaded",
          patch: patch.patch,
          truncated: patch.truncated,
        };
      if (!requested.includes(path) && !explicit.includes(path))
        return { status: "idle" };
      if (query.error) return { status: "error", error: query.error.message };
      return { status: "loading" };
    },
  };
}
