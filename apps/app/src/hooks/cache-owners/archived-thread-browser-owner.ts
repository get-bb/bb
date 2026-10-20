import type { ChangedMessage } from "@bb/domain";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";

interface ArchivedThreadBrowserOwnerArgs {
  desktopBrowser: BbDesktopBrowserApi | null;
  readArchivedAt: (threadId: string) => Promise<number | null>;
}

interface ArchivedThreadBrowserOwner {
  handleChanged: (message: ChangedMessage) => void;
  handleConnected: () => void;
}

export function createArchivedThreadBrowserOwner({
  desktopBrowser,
  readArchivedAt,
}: ArchivedThreadBrowserOwnerArgs): ArchivedThreadBrowserOwner {
  const latestReads = new Map<string, symbol>();
  const setThreadDiscarded = desktopBrowser?.setThreadDiscarded;

  function syncThread(threadId: string): void {
    if (setThreadDiscarded === undefined) return;
    const read = Symbol(threadId);
    latestReads.set(threadId, read);
    void readArchivedAt(threadId).then(
      (archivedAt) => {
        if (latestReads.get(threadId) !== read) return;
        latestReads.delete(threadId);
        setThreadDiscarded({ threadId, discarded: archivedAt !== null });
      },
      () => {
        if (latestReads.get(threadId) === read) latestReads.delete(threadId);
      },
    );
  }

  return {
    handleChanged(message) {
      if (
        message.entity === "thread" &&
        message.id !== undefined &&
        message.changes.includes("archived-changed")
      ) {
        syncThread(message.id);
      }
    },
    handleConnected() {
      const listThreadIdsWithTabs = desktopBrowser?.listThreadIdsWithTabs;
      if (
        setThreadDiscarded === undefined ||
        listThreadIdsWithTabs === undefined
      )
        return;
      void listThreadIdsWithTabs().then(
        (threadIds) => threadIds.forEach(syncThread),
        () => {},
      );
    },
  };
}
