import {
  createContext,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { timelineRowChildren, type TimelineRow } from "@bb/server-contract";
import {
  buildMarkdownTouchedFiles,
  resolveTouchedFilePath,
  selectMentionedTouchedFiles,
  type MarkdownTouchedFiles,
} from "@/components/ui/markdown-local-file-link";

const TOUCHED_FILE_KEY_SEPARATOR = "\0";

type TimelineTouchedFilesListener = () => void;

export interface TimelineTouchedFilesStore {
  getSnapshot: () => MarkdownTouchedFiles | undefined;
  subscribe: (listener: TimelineTouchedFilesListener) => () => void;
}

interface PublishingTimelineTouchedFilesStore extends TimelineTouchedFilesStore {
  publish: (touchedFiles: MarkdownTouchedFiles) => void;
}

const NO_TIMELINE_TOUCHED_FILES: TimelineTouchedFilesStore = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
};

export const TimelineTouchedFilesContext =
  createContext<TimelineTouchedFilesStore>(NO_TIMELINE_TOUCHED_FILES);

interface TouchedFilePaths {
  paths: Set<string>;
  rootPath: string | null;
}

function touchFilePath(touched: TouchedFilePaths, path: string): void {
  const touchedPath = resolveTouchedFilePath({
    path,
    rootPath: touched.rootPath,
  });
  if (touchedPath !== null) {
    touched.paths.delete(touchedPath);
    touched.paths.add(touchedPath);
  }
}

function forgetFilePath(touched: TouchedFilePaths, path: string): void {
  const touchedPath = resolveTouchedFilePath({
    path,
    rootPath: touched.rootPath,
  });
  if (touchedPath !== null) {
    touched.paths.delete(touchedPath);
  }
}

function applyRowTouchedFilePaths(
  touched: TouchedFilePaths,
  row: TimelineRow,
): void {
  if (row.kind === "turn") {
    for (const path of row.experimental_touchedFilePaths) {
      touchFilePath(touched, path);
    }
    return;
  }
  if (row.kind !== "work") {
    return;
  }
  switch (row.workKind) {
    case "file-change":
      if (row.change.kind === "delete") {
        forgetFilePath(touched, row.change.path);
      } else if (row.change.movePath !== null) {
        forgetFilePath(touched, row.change.path);
        touchFilePath(touched, row.change.movePath);
      } else {
        touchFilePath(touched, row.change.path);
      }
      return;
    case "file-read":
    case "image-view":
      touchFilePath(touched, row.path);
      return;
    default:
      return;
  }
}

function applyRowsTouchedFilePaths(
  touched: TouchedFilePaths,
  rows: readonly TimelineRow[],
): void {
  for (const row of rows) {
    applyRowTouchedFilePaths(touched, row);
    applyRowsTouchedFilePaths(touched, timelineRowChildren(row) ?? []);
  }
}

export function collectTimelineTouchedFilePaths(
  rows: readonly TimelineRow[],
  rootPath: string | null,
): string[] {
  const touched: TouchedFilePaths = { paths: new Set(), rootPath };
  applyRowsTouchedFilePaths(touched, rows);
  return [...touched.paths].sort();
}

function splitTouchedFileKey(key: string): string[] {
  return key.length === 0 ? [] : key.split(TOUCHED_FILE_KEY_SEPARATOR);
}

function useTimelineTouchedFiles(
  rows: readonly TimelineRow[],
  workspaceRootPath: string | undefined,
): MarkdownTouchedFiles {
  const rootPath = workspaceRootPath ?? null;
  const pathsKey = useMemo(
    () =>
      collectTimelineTouchedFilePaths(rows, rootPath).join(
        TOUCHED_FILE_KEY_SEPARATOR,
      ),
    [rootPath, rows],
  );
  return useMemo(
    () =>
      buildMarkdownTouchedFiles({
        paths: splitTouchedFileKey(pathsKey),
        rootPath,
      }),
    [pathsKey, rootPath],
  );
}

function createTimelineTouchedFilesStore(
  initialTouchedFiles: MarkdownTouchedFiles,
): PublishingTimelineTouchedFilesStore {
  let touchedFiles = initialTouchedFiles;
  const listeners = new Set<TimelineTouchedFilesListener>();
  return {
    getSnapshot: () => touchedFiles,
    publish: (nextTouchedFiles) => {
      if (nextTouchedFiles === touchedFiles) return;
      touchedFiles = nextTouchedFiles;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useTimelineTouchedFilesStore(
  rows: readonly TimelineRow[],
  workspaceRootPath: string | undefined,
): TimelineTouchedFilesStore {
  const touchedFiles = useTimelineTouchedFiles(rows, workspaceRootPath);
  const [store] = useState(() => createTimelineTouchedFilesStore(touchedFiles));
  useLayoutEffect(() => {
    store.publish(touchedFiles);
  }, [store, touchedFiles]);
  return store;
}

function selectMessageTouchedFilesKey(
  markdown: string,
  touchedFiles: MarkdownTouchedFiles | undefined,
): string {
  return touchedFiles === undefined || touchedFiles.pathsBySuffix.size === 0
    ? ""
    : selectMentionedTouchedFiles({ markdown, touchedFiles })
        .flat()
        .join(TOUCHED_FILE_KEY_SEPARATOR);
}

export function useMessageTouchedFiles(
  markdown: string,
  store: TimelineTouchedFilesStore,
): MarkdownTouchedFiles | undefined {
  const getSelectionKey = useCallback(
    () => selectMessageTouchedFilesKey(markdown, store.getSnapshot()),
    [markdown, store],
  );
  const selectionKey = useSyncExternalStore(
    store.subscribe,
    getSelectionKey,
    getSelectionKey,
  );
  return useMemo(() => {
    const parts = splitTouchedFileKey(selectionKey);
    const pathsBySuffix = new Map<string, string>();
    for (let index = 0; index + 1 < parts.length; index += 2) {
      const suffix = parts[index];
      const path = parts[index + 1];
      if (suffix !== undefined && path !== undefined) {
        pathsBySuffix.set(suffix, path);
      }
    }
    return pathsBySuffix.size === 0 ? undefined : { pathsBySuffix };
  }, [selectionKey]);
}
