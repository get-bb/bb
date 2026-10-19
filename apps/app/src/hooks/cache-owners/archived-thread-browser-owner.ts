import type { ChangedMessage } from "@bb/domain";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";

interface ArchivedThreadBrowserOwnerArgs {
  desktopBrowser: BbDesktopBrowserApi | null;
  readArchivedAt: (threadId: string) => Promise<number | null>;
}

export function createArchivedThreadBrowserOwner({
  desktopBrowser,
  readArchivedAt,
}: ArchivedThreadBrowserOwnerArgs): (message: ChangedMessage) => void {
  const latestReads = new Map<string, symbol>();
  return (message) => {
    if (
      message.entity !== "thread" ||
      message.id === undefined ||
      !message.changes.includes("archived-changed")
    ) {
      return;
    }
    const setThreadDiscarded = desktopBrowser?.setThreadDiscarded;
    if (setThreadDiscarded === undefined) return;
    const threadId = message.id;
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
  };
}
