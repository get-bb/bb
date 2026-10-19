import { describe, expect, it, vi } from "vitest";
import type { ChangedMessage, ThreadChangeKind } from "@bb/domain";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserSetThreadDiscardedRequest,
} from "@bb/desktop-contract";
import { createArchivedThreadBrowserOwner } from "./archived-thread-browser-owner";

function threadChanged(
  id: string,
  changes: ThreadChangeKind[] = ["archived-changed"],
): ChangedMessage {
  return { type: "changed", entity: "thread", id, changes };
}

function createDesktopBrowser() {
  const setThreadDiscarded =
    vi.fn<(request: BbDesktopBrowserSetThreadDiscardedRequest) => void>();
  return {
    desktopBrowser: {
      setThreadDiscarded,
    } as Partial<BbDesktopBrowserApi> as BbDesktopBrowserApi,
    setThreadDiscarded,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("createArchivedThreadBrowserOwner", () => {
  it("discards an archived thread's pages and stops discarding once it is unarchived", async () => {
    const { desktopBrowser, setThreadDiscarded } = createDesktopBrowser();
    const archivedAt = new Map<string, number | null>([
      ["thr_archived", 1_000],
      ["thr_restored", null],
    ]);
    const handle = createArchivedThreadBrowserOwner({
      desktopBrowser,
      readArchivedAt: async (threadId) => archivedAt.get(threadId) ?? null,
    });

    handle(threadChanged("thr_archived"));
    handle(threadChanged("thr_restored"));
    await vi.waitFor(() => expect(setThreadDiscarded).toHaveBeenCalledTimes(2));
    expect(setThreadDiscarded).toHaveBeenCalledWith({
      threadId: "thr_archived",
      discarded: true,
    });
    expect(setThreadDiscarded).toHaveBeenCalledWith({
      threadId: "thr_restored",
      discarded: false,
    });
  });

  it("applies only the latest archive state when reads for one thread resolve out of order", async () => {
    const { desktopBrowser, setThreadDiscarded } = createDesktopBrowser();
    const reads = [deferred<number | null>(), deferred<number | null>()];
    let nextRead = 0;
    const handle = createArchivedThreadBrowserOwner({
      desktopBrowser,
      readArchivedAt: () => reads[nextRead++]!.promise,
    });

    handle(threadChanged("thr_undo"));
    handle(threadChanged("thr_undo"));
    reads[1]!.resolve(null);
    await vi.waitFor(() => expect(setThreadDiscarded).toHaveBeenCalledTimes(1));
    reads[0]!.resolve(1_000);
    await reads[0]!.promise;
    await Promise.resolve();

    expect(setThreadDiscarded.mock.calls).toEqual([
      [{ threadId: "thr_undo", discarded: false }],
    ]);
  });

  it("ignores other changes, failed reads, and desktop shells without thread discarding", async () => {
    const { desktopBrowser, setThreadDiscarded } = createDesktopBrowser();
    const readArchivedAt = vi.fn(async () => {
      throw new Error("Thread not found");
    });
    const handle = createArchivedThreadBrowserOwner({
      desktopBrowser,
      readArchivedAt,
    });

    handle(threadChanged("thr_title", ["title-changed"]));
    handle({
      type: "changed",
      entity: "thread",
      changes: ["archived-changed"],
    });
    handle(threadChanged("thr_deleted"));
    await vi.waitFor(() => expect(readArchivedAt).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(setThreadDiscarded).not.toHaveBeenCalled();

    const olderReadArchivedAt = vi.fn(async () => 1_000);
    createArchivedThreadBrowserOwner({
      desktopBrowser: {} as BbDesktopBrowserApi,
      readArchivedAt: olderReadArchivedAt,
    })(threadChanged("thr_archived"));
    createArchivedThreadBrowserOwner({
      desktopBrowser: null,
      readArchivedAt: olderReadArchivedAt,
    })(threadChanged("thr_archived"));
    expect(olderReadArchivedAt).not.toHaveBeenCalled();
  });
});
