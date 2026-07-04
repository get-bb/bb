import type { PluginFileOpenerProps, PluginFileOpenerSource } from "@bb/plugin-sdk";
import {
  createPluginPanelFixedPanelTab,
  type PluginPanelFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  resolvePreferredFileOpener,
  type FileOpenerPreferenceMap,
} from "@/lib/file-opener-preference";
import type { PluginFileOpenerSlot } from "@/lib/plugin-slots";
import type { OpenSecondaryPanelTabRequest } from "@/components/secondary-panel/useThreadFileTabs";

/**
 * Plugin file-opener tabs ride the existing `plugin-panel` tab kind: the
 * action id carries this prefix + the opener's id, and `paramsJson` persists
 * the opened file (`PluginFileOpenerProps`). Same identity semantics as
 * action tabs — same opener + same file focuses the existing tab.
 */
export const FILE_OPENER_ACTION_ID_PREFIX = "file-opener:";

export function isFileOpenerPanelTab(tab: PluginPanelFixedPanelTab): boolean {
  return tab.actionId.startsWith(FILE_OPENER_ACTION_ID_PREFIX);
}

export function fileOpenerIdFromActionId(actionId: string): string | null {
  return actionId.startsWith(FILE_OPENER_ACTION_ID_PREFIX)
    ? actionId.slice(FILE_OPENER_ACTION_ID_PREFIX.length)
    : null;
}

export function buildFileOpenerPanelTab(
  opener: Pick<PluginFileOpenerSlot, "id" | "pluginId">,
  file: PluginFileOpenerProps,
): PluginPanelFixedPanelTab {
  return createPluginPanelFixedPanelTab({
    actionId: `${FILE_OPENER_ACTION_ID_PREFIX}${opener.id}`,
    paramsJson: JSON.stringify({ path: file.path, source: file.source }),
    pluginId: opener.pluginId,
    title: file.path.split("/").at(-1) ?? file.path,
  });
}

/** Parse a persisted opener tab's params; null on any mismatch (degrade). */
export function parseFileOpenerParams(
  paramsJson: string | null,
): PluginFileOpenerProps | null {
  if (paramsJson === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(paramsJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { path, source } = parsed as { path?: unknown; source?: unknown };
  if (typeof path !== "string" || path.length === 0) return null;
  if (typeof source !== "object" || source === null) return null;
  const { kind, threadId, environmentId, projectId } = source as {
    kind?: unknown;
    threadId?: unknown;
    environmentId?: unknown;
    projectId?: unknown;
  };
  if (kind !== "workspace" && kind !== "host" && kind !== "thread-storage") {
    return null;
  }
  return {
    path,
    source: {
      kind,
      threadId: typeof threadId === "string" ? threadId : null,
      environmentId: typeof environmentId === "string" ? environmentId : null,
      projectId: typeof projectId === "string" ? projectId : null,
    },
  };
}

/**
 * A per-open viewer choice (the link context menu): "builtin" pins the
 * built-in preview; an opener ref forces that plugin opener. Absent =
 * follow the per-extension default.
 */
export type FileTabViewerOverride =
  | "builtin"
  | { pluginId: string; openerId: string };

export interface CreateFileOpenerTabForRequestArgs {
  fileOpeners: readonly PluginFileOpenerSlot[];
  preference: FileOpenerPreferenceMap;
  projectId: string | null;
  request: OpenSecondaryPanelTabRequest;
  resolvedEnvironmentId: string | null | undefined;
  threadId: string | null | undefined;
  viewer?: FileTabViewerOverride;
}

/**
 * The plugin-opener tab a file-open request should divert to, or null for
 * the built-in path. Diversion applies only to live file content — working
 * tree, host, and thread-storage previews; git-ref snapshots and deleted
 * files always use the built-in preview.
 */
export function createFileOpenerTabForRequest({
  fileOpeners,
  preference,
  projectId,
  request,
  resolvedEnvironmentId,
  threadId,
  viewer,
}: CreateFileOpenerTabForRequestArgs): PluginPanelFixedPanelTab | null {
  if (viewer === "builtin") return null;
  const file = fileForOpenRequest({
    projectId,
    request,
    resolvedEnvironmentId,
    threadId,
  });
  if (file === null) return null;
  const opener =
    viewer !== undefined
      ? (fileOpeners.find(
          (candidate) =>
            candidate.pluginId === viewer.pluginId &&
            candidate.id === viewer.openerId,
        ) ?? null)
      : resolvePreferredFileOpener({
          openers: fileOpeners,
          preference,
          path: file.path,
        });
  if (opener === null) return null;
  return buildFileOpenerPanelTab(opener, file);
}

function fileForOpenRequest({
  projectId,
  request,
  resolvedEnvironmentId,
  threadId,
}: Omit<CreateFileOpenerTabForRequestArgs, "fileOpeners" | "preference">):
  | PluginFileOpenerProps
  | null {
  switch (request.kind) {
    case "workspace-file-preview": {
      // Same guard as the built-in path, plus live-content-only rules.
      if (resolvedEnvironmentId === undefined) return null;
      if (request.tab.source.kind !== "working-tree") return null;
      if (request.tab.statusLabel === "deleted") return null;
      return {
        path: request.tab.path,
        source: buildSource("workspace", {
          environmentId: resolvedEnvironmentId,
          projectId: resolvedEnvironmentId === null ? projectId : null,
          threadId: threadId ?? null,
        }),
      };
    }
    case "host-file-preview": {
      if (!threadId || !resolvedEnvironmentId) return null;
      return {
        path: request.tab.path,
        source: buildSource("host", {
          environmentId: resolvedEnvironmentId,
          projectId: null,
          threadId,
        }),
      };
    }
    case "thread-storage-file-preview": {
      if (!threadId) return null;
      return {
        path: request.tab.path,
        source: buildSource("thread-storage", {
          environmentId: resolvedEnvironmentId ?? null,
          projectId: null,
          threadId,
        }),
      };
    }
    default:
      return null;
  }
}

function buildSource(
  kind: PluginFileOpenerSource["kind"],
  fields: {
    environmentId: string | null;
    projectId: string | null;
    threadId: string | null;
  },
): PluginFileOpenerSource {
  return { kind, ...fields };
}
