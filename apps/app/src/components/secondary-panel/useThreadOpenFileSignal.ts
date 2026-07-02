import { useEffect } from "react";
import type { ThreadOpenFileSignal } from "@bb/server-contract";
import { createFilePreviewLineRange } from "@/lib/file-preview";
import { wsManager } from "@/lib/ws";
import type { OpenSecondaryPanelTabRequest } from "./useThreadFileTabs";

interface UseThreadOpenFileSignalParams {
  threadId: string | null | undefined;
  /**
   * The thread's environment id. `undefined` while the thread is still loading;
   * `string | null` once resolved. We wait until it is resolved before draining
   * buffered intents so a workspace file (which needs a resolved environment to
   * open) is not consumed and lost during navigation.
   */
  environmentId: string | null | undefined;
  openTab: (request: OpenSecondaryPanelTabRequest) => void;
}

function toOpenRequest(
  signal: ThreadOpenFileSignal,
): OpenSecondaryPanelTabRequest {
  const lineRange =
    signal.lineNumber === null
      ? null
      : createFilePreviewLineRange({
          startLineNumber: signal.lineNumber,
          endLineNumber: signal.lineNumber,
        });
  if (signal.source === "workspace") {
    return {
      kind: "workspace-file-preview",
      tab: {
        lineRange,
        path: signal.path,
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    };
  }
  return {
    kind: "thread-storage-file-preview",
    tab: { lineRange, path: signal.path },
  };
}

/**
 * Open files requested via `bb thread open` in the secondary panel.
 * The intent is broadcast to every client and buffered in {@link wsManager}; this
 * hook drains the buffer for the active thread when it becomes viewable (so a
 * file requested while a different thread was open opens on navigation) and
 * reacts to live signals while the thread is already in view.
 */
export function useThreadOpenFileSignal({
  threadId,
  environmentId,
  openTab,
}: UseThreadOpenFileSignalParams): void {
  useEffect(() => {
    if (threadId == null || environmentId === undefined) {
      // Not yet ready to open. wsManager keeps buffering; this effect re-runs
      // and drains once the thread (and its environment) resolves.
      return;
    }
    const apply = () => {
      const signal = wsManager.consumePendingOpen(threadId);
      if (signal) {
        openTab(toOpenRequest(signal));
      }
    };
    apply();
    return wsManager.onThreadOpenFile((signal) => {
      if (signal.threadId === threadId) {
        apply();
      }
    });
  }, [threadId, environmentId, openTab]);
}
