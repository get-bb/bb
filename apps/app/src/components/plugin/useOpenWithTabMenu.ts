import { useCallback } from "react";
import type { PluginFileOpenerProps } from "@bb/plugin-sdk";
import {
  createHostFilePreviewFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  type FixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  buildFileOpenerRef,
  findFileOpenersForPath,
  getFileExtension,
  resolvePreferredFileOpener,
  useFileOpenerPreference,
} from "@/lib/file-opener-preference";
import { usePluginSlots } from "@/lib/plugin-slots";
import type { SecondaryPanelTabMenuItem } from "@/components/secondary-panel/secondaryPanelFileTab";
import {
  buildFileOpenerPanelTab,
  fileOpenerIdFromActionId,
  parseFileOpenerParams,
} from "./file-opener-tabs";

/**
 * The "Open with" context menu for file tabs: switch the tab between the
 * built-in preview and registered plugin `fileOpener`s, and pin the current
 * viewer as the extension's default. Returns undefined (no menu) for tabs
 * that aren't live file content or have no alternative viewer.
 */

interface OpenWithFile {
  file: PluginFileOpenerProps;
  /** null = the built-in preview. */
  currentOpenerRef: string | null;
}

function fileFromTab(tab: FixedPanelTab): OpenWithFile | null {
  switch (tab.kind) {
    case "workspace-file-preview":
      // Live working-tree content only — ref snapshots and deleted files
      // stay on the built-in preview (nothing on disk to edit).
      if (tab.source.kind !== "working-tree" || tab.statusLabel === "deleted") {
        return null;
      }
      return {
        currentOpenerRef: null,
        file: {
          path: tab.path,
          source: {
            kind: "workspace",
            threadId: null,
            environmentId: tab.environmentId,
            projectId: tab.projectId,
          },
        },
      };
    case "host-file-preview":
      return {
        currentOpenerRef: null,
        file: {
          path: tab.path,
          source: {
            kind: "host",
            threadId: tab.threadId,
            environmentId: tab.environmentId,
            projectId: null,
          },
        },
      };
    case "thread-storage-file-preview":
      if (tab.isPinned) return null;
      return {
        currentOpenerRef: null,
        file: {
          path: tab.path,
          source: {
            kind: "thread-storage",
            threadId: tab.threadId,
            environmentId: tab.environmentId,
            projectId: null,
          },
        },
      };
    case "plugin-panel": {
      const openerId = fileOpenerIdFromActionId(tab.actionId);
      if (openerId === null) return null;
      const file = parseFileOpenerParams(tab.paramsJson);
      if (file === null) return null;
      return {
        currentOpenerRef: buildFileOpenerRef({
          pluginId: tab.pluginId,
          id: openerId,
        }),
        file,
      };
    }
    default:
      return null;
  }
}

function buildBuiltinTab(file: PluginFileOpenerProps): FixedPanelTab | null {
  const { path, source } = file;
  switch (source.kind) {
    case "workspace":
      return createWorkspaceFilePreviewFixedPanelTab({
        environmentId: source.environmentId,
        projectId: source.projectId,
        tab: {
          lineRange: null,
          path,
          source: { kind: "working-tree" },
          statusLabel: null,
        },
      });
    case "host":
      if (source.threadId === null || source.environmentId === null) {
        return null;
      }
      return createHostFilePreviewFixedPanelTab({
        environmentId: source.environmentId,
        tab: { lineRange: null, path },
        threadId: source.threadId,
      });
    case "thread-storage":
      if (source.threadId === null) return null;
      return createThreadStorageFilePreviewFixedPanelTab({
        environmentId: source.environmentId,
        isPinned: false,
        tab: { lineRange: null, path },
        threadId: source.threadId,
      });
  }
}

export type BuildTabMenuItems = (
  tab: FixedPanelTab,
) => readonly SecondaryPanelTabMenuItem[] | undefined;

export function useOpenWithTabMenu({
  replaceTab,
}: {
  replaceTab: (args: { fromTabId: string; toTab: FixedPanelTab }) => void;
}): BuildTabMenuItems {
  const { fileOpeners } = usePluginSlots();
  const [preference, setPreference] = useFileOpenerPreference();

  return useCallback(
    (tab) => {
      const resolved = fileFromTab(tab);
      if (resolved === null) return undefined;
      const { file, currentOpenerRef } = resolved;
      const matchingOpeners = findFileOpenersForPath(fileOpeners, file.path);
      // No menu when the built-in preview is the only possible viewer.
      if (matchingOpeners.length === 0 && currentOpenerRef === null) {
        return undefined;
      }

      const items: SecondaryPanelTabMenuItem[] = [];
      if (currentOpenerRef !== null) {
        const builtinTab = buildBuiltinTab(file);
        if (builtinTab !== null) {
          items.push({
            id: "open-with:builtin",
            label: "Open with built-in preview",
            onSelect: () =>
              replaceTab({ fromTabId: tab.id, toTab: builtinTab }),
          });
        }
      }
      for (const opener of matchingOpeners) {
        const openerRef = buildFileOpenerRef(opener);
        if (openerRef === currentOpenerRef) continue;
        items.push({
          id: `open-with:${openerRef}`,
          label: `Open with ${opener.title}`,
          onSelect: () =>
            replaceTab({
              fromTabId: tab.id,
              toTab: buildFileOpenerPanelTab(opener, file),
            }),
        });
      }

      const extension = getFileExtension(file.path);
      if (extension !== null) {
        const defaultOpener = resolvePreferredFileOpener({
          openers: fileOpeners,
          preference,
          path: file.path,
        });
        const defaultRef =
          defaultOpener === null ? null : buildFileOpenerRef(defaultOpener);
        const currentOpener =
          currentOpenerRef === null
            ? null
            : (matchingOpeners.find(
                (opener) => buildFileOpenerRef(opener) === currentOpenerRef,
              ) ?? null);
        const currentTitle =
          currentOpenerRef === null
            ? "built-in preview"
            : (currentOpener?.title ?? "this opener");
        // Only offer pinning viewers that are actually registered.
        if (currentOpenerRef === null || currentOpener !== null) {
          items.push({
            id: "open-with:set-default",
            label: `Always open .${extension} with ${currentTitle}`,
            checked: defaultRef === currentOpenerRef,
            onSelect: () =>
              setPreference((previous) => {
                const next = { ...previous };
                if (
                  currentOpenerRef === null ||
                  defaultRef === currentOpenerRef
                ) {
                  // Built-in is the implicit default; unchecking an opener
                  // default also reverts to it.
                  delete next[extension];
                } else {
                  next[extension] = currentOpenerRef;
                }
                return next;
              }),
          });
        }
      }

      return items.length > 0 ? items : undefined;
    },
    [fileOpeners, preference, replaceTab, setPreference],
  );
}
