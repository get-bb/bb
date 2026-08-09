import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFileTree, type UseFileTreeResult } from "@pierre/trees/react";
import type { WorkspaceDirectoryEntry } from "@bb/host-daemon-contract";
import { BbHttpError } from "@bb/sdk/browser";
import { parseLifecycleError } from "@/lib/lifecycle-errors";
import { sdk } from "@/lib/sdk";
import { createProgressiveTreeAdapter } from "../pierre-tree";

const DIRECTORY_PAGE_LIMIT = "200";

export type WorkspaceFileSelectHandler = (path: string) => void;

interface UseWorkspaceFileTreeArgs {
  environmentId: string | null | undefined;
  onSelectFile: WorkspaceFileSelectHandler;
}

export interface WorkspaceFileTreeController {
  error: Error | null;
  isLoading: boolean;
  model: UseFileTreeResult["model"];
  refresh: () => void;
}

export function workspaceEntryTreePath(entry: WorkspaceDirectoryEntry): string {
  return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

export function isPreparingWorktreeError(error: unknown): boolean {
  if (!(error instanceof BbHttpError) || error.status !== 409) return false;

  const lifecycleError = parseLifecycleError(error);
  return (
    lifecycleError?.code === "environment_not_ready" &&
    lifecycleError.details.environmentStatus === "provisioning"
  );
}

export function mergeWorkspaceDirectoryEntries(
  current: ReadonlyMap<string, WorkspaceDirectoryEntry>,
  entries: readonly WorkspaceDirectoryEntry[],
): Map<string, WorkspaceDirectoryEntry> {
  const merged = new Map(current);
  for (const entry of entries) merged.set(entry.path, entry);
  return merged;
}

export function useWorkspaceFileTree({
  environmentId,
  onSelectFile,
}: UseWorkspaceFileTreeArgs): WorkspaceFileTreeController {
  const entriesRef = useRef(new Map<string, WorkspaceDirectoryEntry>());
  const generationRef = useRef(0);
  const onSelectFileRef = useRef(onSelectFile);
  const loadDirectoryRef = useRef<(path: string) => void>(() => {});
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    onSelectFileRef.current = onSelectFile;
  }, [onSelectFile]);

  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      const selectedPath = selectedPaths[0];
      if (!selectedPath) return;
      const entry = entriesRef.current.get(selectedPath.replace(/\/$/u, ""));
      if (entry && entry.kind !== "directory") {
        onSelectFileRef.current(entry.path);
      }
    },
    [],
  );

  const { model } = useFileTree({
    density: "compact",
    flattenEmptyDirectories: false,
    initialExpansion: "closed",
    onSelectionChange: handleSelectionChange,
    paths: [],
    search: false,
  });

  const adapter = useMemo(
    () =>
      createProgressiveTreeAdapter(model, (path) => {
        loadDirectoryRef.current(path.replace(/\/$/u, ""));
      }),
    [model],
  );

  const loadDirectory = useCallback(
    async (directory: string, generation: number) => {
      if (!environmentId) return;
      setIsLoading(true);
      setError(null);
      try {
        let cursor: string | undefined;
        do {
          const response = await sdk.environments.directory({
            environmentId,
            path: directory,
            limit: DIRECTORY_PAGE_LIMIT,
            ...(cursor ? { cursor } : {}),
          });
          if (generationRef.current !== generation) return;
          if (response.outcome === "unavailable") {
            throw new Error(response.failure.message);
          }
          entriesRef.current = mergeWorkspaceDirectoryEntries(
            entriesRef.current,
            response.entries,
          );
          adapter.appendPaths(response.entries.map(workspaceEntryTreePath));
          cursor = response.nextCursor ?? undefined;
        } while (cursor);
        adapter.markDirectoryResolved(directory);
      } catch (cause) {
        if (generationRef.current !== generation) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        if (generationRef.current === generation) setIsLoading(false);
      }
    },
    [adapter, environmentId],
  );

  useEffect(() => {
    loadDirectoryRef.current = (path) => {
      void loadDirectory(path, generationRef.current);
    };
  }, [loadDirectory]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    entriesRef.current = new Map();
    adapter.reset();
    model.resetPaths([]);
    if (environmentId) void loadDirectory("", generation);
    return () => {
      generationRef.current += 1;
    };
  }, [adapter, environmentId, loadDirectory, model, refreshToken]);

  useEffect(() => () => adapter.dispose(), [adapter]);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  return { error, isLoading, model, refresh };
}
