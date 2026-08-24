import {
  createEmptyFixedPanelTabsState,
  createGitDiffFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadInfoFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  type FixedPanelTab,
  type FixedPanelTabsState,
} from "@bb/client-core";
import type { ThreadTab, ThreadTabsResponse } from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import {
  areThreadTabListsEquivalent,
  createThreadTabsSyncer,
  reconcileTabsStateWithServerTabs,
  toSyncedThreadTabs,
  type ThreadTabsSyncOutcome,
  type ThreadTabsSyncTransport,
  type ThreadTabsWriteArgs,
} from "./thread-tabs-sync";

const info = createThreadInfoFixedPanelTab();
const diff = createGitDiffFixedPanelTab();
const fileA = createWorkspaceFilePreviewFixedPanelTab({
  environmentId: "env_1",
  projectId: null,
  tab: {
    lineRange: null,
    path: "src/a.ts",
    source: { kind: "working-tree" },
    statusLabel: null,
  },
});
const fileB = createWorkspaceFilePreviewFixedPanelTab({
  environmentId: "env_1",
  projectId: null,
  tab: {
    lineRange: null,
    path: "src/b.ts",
    source: { kind: "working-tree" },
    statusLabel: null,
  },
});
const terminal = createTerminalFixedPanelTab({ terminalId: "term_1" });
const sideChat: ThreadTab = {
  id: "side-chat:1",
  kind: "side-chat",
  sourceMessageText: "hi",
  sourceSeqEnd: null,
  threadId: "thr_1",
  title: "Side chat",
};

function stateWith(
  tabs: readonly FixedPanelTab[],
  activeTabId: string | null,
): FixedPanelTabsState {
  return createEmptyFixedPanelTabsState({
    secondary: { tabs, activeTabId, isOpen: true },
  });
}

class ConflictError extends Error {
  readonly conflict = true;
}

interface FakeServerOptions {
  /** Reject the Nth write (1-based) with a conflict, optionally bumping the server first. */
  conflictsOn?: readonly number[];
  /** Tabs the server swaps in when it rejects a write (simulating the other client). */
  onConflictServerTabs?: readonly ThreadTab[];
}

function createFakeServer(
  initial: ThreadTabsResponse,
  options: FakeServerOptions = {},
) {
  let server = initial;
  let cached: ThreadTabsResponse | undefined;
  let writeCount = 0;
  const writes: ThreadTabsWriteArgs[] = [];
  const fetches: string[] = [];
  const transport: ThreadTabsSyncTransport = {
    getCached: () => cached,
    fetch: vi.fn(async (threadId: string) => {
      fetches.push(threadId);
      cached = server;
      return server;
    }),
    write: vi.fn(async (args: ThreadTabsWriteArgs) => {
      writeCount += 1;
      writes.push(args);
      if (options.conflictsOn?.includes(writeCount)) {
        if (options.onConflictServerTabs) {
          server = {
            revision: server.revision + 1,
            tabs: [...options.onConflictServerTabs],
          };
        }
        throw new ConflictError("409");
      }
      if (args.expectedRevision !== server.revision) {
        throw new ConflictError("409 (revision)");
      }
      server = { revision: server.revision + 1, tabs: [...args.tabs] };
      cached = server;
      return server;
    }),
    isConflict: (error) => error instanceof ConflictError,
  };
  return {
    transport,
    writes,
    fetches,
    get server() {
      return server;
    },
    seedCache() {
      cached = server;
    },
  };
}

describe("toSyncedThreadTabs / areThreadTabListsEquivalent", () => {
  it("drops the kinds mobile does not carry on the wire and compares the rest in order", () => {
    const local: FixedPanelTab[] = [
      info,
      { id: "new-tab:new-tab:none", kind: "new-tab" },
      fileA,
    ];
    const server: ThreadTab[] = [info, sideChat, fileA];
    expect(toSyncedThreadTabs(local).map((tab) => tab.kind)).toEqual([
      "thread-info",
      "workspace-file-preview",
    ]);
    expect(areThreadTabListsEquivalent(local, server)).toBe(true);
    expect(areThreadTabListsEquivalent([info, fileA], [fileA, info])).toBe(
      false,
    );
    expect(
      areThreadTabListsEquivalent(
        [fileA],
        [{ ...fileA, lineRange: { startLineNumber: 1, endLineNumber: 2 } }],
      ),
    ).toBe(false);
  });
});

describe("reconcileTabsStateWithServerTabs", () => {
  it("adopts the server strip and keeps the local active tab only while it survives", () => {
    const current = stateWith([info, diff, fileA], fileA.id);
    const next = reconcileTabsStateWithServerTabs(current, [
      info,
      diff,
      fileA,
      fileB,
    ]);
    expect(next.secondary.tabs.map((tab) => tab.id)).toEqual([
      info.id,
      diff.id,
      fileA.id,
      fileB.id,
    ]);
    expect(next.secondary.activeTabId).toBe(fileA.id);

    const closedElsewhere = reconcileTabsStateWithServerTabs(next, [
      info,
      diff,
      fileB,
    ]);
    expect(closedElsewhere.secondary.activeTabId).toBeNull();
    expect(closedElsewhere.secondary.tabs.map((tab) => tab.id)).toEqual([
      info.id,
      diff.id,
      fileB.id,
    ]);
  });

  it("returns the same state when the server strip is equivalent (ignoring wire-only kinds)", () => {
    const current = stateWith([info, fileA], info.id);
    expect(
      reconcileTabsStateWithServerTabs(current, [info, sideChat, fileA]),
    ).toBe(current);
  });
});

describe("createThreadTabsSyncer", () => {
  it("writes the desired strip against the cached revision and skips equivalent writes", async () => {
    const fake = createFakeServer({ revision: 3, tabs: [info] });
    fake.seedCache();
    const outcomes: ThreadTabsSyncOutcome[] = [];
    const syncer = createThreadTabsSyncer({
      transport: fake.transport,
      onOutcome: (_id, outcome) => outcomes.push(outcome),
    });

    const written = await syncer.persist("thr_1", [info, fileA]);
    expect(written.kind).toBe("written");
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({
      expectedRevision: 3,
      threadId: "thr_1",
    });
    expect(fake.writes[0]?.tabs.map((tab) => tab.id)).toEqual([
      info.id,
      fileA.id,
    ]);
    expect(fake.fetches).toHaveLength(0);

    const unchanged = await syncer.persist("thr_1", [info, fileA]);
    expect(unchanged).toEqual({ kind: "unchanged" });
    expect(fake.writes).toHaveLength(1);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual([
      "written",
      "unchanged",
    ]);
  });

  it("fetches the strip when nothing is cached before writing", async () => {
    const fake = createFakeServer({ revision: 7, tabs: [info] });
    const syncer = createThreadTabsSyncer({ transport: fake.transport });
    await syncer.persist("thr_1", [info, terminal]);
    expect(fake.fetches).toEqual(["thr_1"]);
    expect(fake.writes[0]?.expectedRevision).toBe(7);
    expect(fake.server.revision).toBe(8);
  });

  it("rebases on a 409 and retries once with the fresh revision", async () => {
    // Another client appended fileB at revision 4 while we held revision 3.
    const fake = createFakeServer(
      { revision: 3, tabs: [info] },
      { conflictsOn: [1], onConflictServerTabs: [info, fileB] },
    );
    fake.seedCache();
    const syncer = createThreadTabsSyncer({ transport: fake.transport });

    const outcome = await syncer.persist("thr_1", [info, fileA]);
    expect(outcome.kind).toBe("written");
    expect(fake.writes.map((write) => write.expectedRevision)).toEqual([3, 4]);
    expect(fake.fetches).toEqual(["thr_1"]);
    // Last writer wins: our strip replaced the other client's.
    expect(fake.server.tabs.map((tab) => tab.id)).toEqual([info.id, fileA.id]);
    expect(fake.server.revision).toBe(5);
  });

  it("gives up after a second 409 and reports the server strip", async () => {
    const fake = createFakeServer(
      { revision: 3, tabs: [info] },
      { conflictsOn: [1, 2], onConflictServerTabs: [info, fileB] },
    );
    fake.seedCache();
    const outcomes: ThreadTabsSyncOutcome[] = [];
    const syncer = createThreadTabsSyncer({
      transport: fake.transport,
      onOutcome: (_id, outcome) => outcomes.push(outcome),
    });

    const outcome = await syncer.persist("thr_1", [info, fileA]);
    expect(outcome.kind).toBe("conflict");
    if (outcome.kind === "conflict") {
      expect(outcome.server.tabs.map((tab) => tab.id)).toEqual([
        info.id,
        fileB.id,
      ]);
    }
    expect(fake.writes).toHaveLength(2);
    expect(outcomes).toEqual([outcome]);
  });

  it("treats a 409 whose refetch already matches the desired strip as written", async () => {
    const fake = createFakeServer(
      { revision: 3, tabs: [info] },
      { conflictsOn: [1], onConflictServerTabs: [info, fileA] },
    );
    fake.seedCache();
    const syncer = createThreadTabsSyncer({ transport: fake.transport });
    const outcome = await syncer.persist("thr_1", [info, fileA]);
    expect(outcome.kind).toBe("written");
    expect(fake.writes).toHaveLength(1);
  });

  it("serializes writes per thread so the second write uses the first one's revision", async () => {
    const fake = createFakeServer({ revision: 1, tabs: [] });
    fake.seedCache();
    const syncer = createThreadTabsSyncer({ transport: fake.transport });
    const first = syncer.persist("thr_1", [info]);
    expect(syncer.hasPendingWrite("thr_1")).toBe(true);
    const second = syncer.persist("thr_1", [info, fileA]);
    await Promise.all([first, second]);
    expect(syncer.hasPendingWrite("thr_1")).toBe(false);
    expect(fake.writes.map((write) => write.expectedRevision)).toEqual([1, 2]);
    expect(fake.server.tabs.map((tab) => tab.id)).toEqual([info.id, fileA.id]);
  });

  it("propagates non-conflict failures and keeps the queue usable", async () => {
    const fake = createFakeServer({ revision: 1, tabs: [] });
    fake.seedCache();
    const boom = new Error("network");
    vi.mocked(fake.transport.write).mockRejectedValueOnce(boom);
    const syncer = createThreadTabsSyncer({ transport: fake.transport });
    await expect(syncer.persist("thr_1", [info])).rejects.toBe(boom);
    expect(syncer.hasPendingWrite("thr_1")).toBe(false);
    await expect(syncer.persist("thr_1", [info])).resolves.toMatchObject({
      kind: "written",
    });
  });

  it("migrates local tabs into an empty server strip once, and never over a seeded one", async () => {
    const fake = createFakeServer({ revision: 0, tabs: [] });
    fake.seedCache();
    const syncer = createThreadTabsSyncer({ transport: fake.transport });
    await expect(syncer.migrate("thr_1", [info, fileA])).resolves.toBe(true);
    expect(fake.writes[0]).toMatchObject({ expectedRevision: 0 });
    await expect(syncer.migrate("thr_1", [info, fileB])).resolves.toBe(false);
    expect(fake.writes).toHaveLength(1);

    const seeded = createFakeServer({ revision: 2, tabs: [info] });
    seeded.seedCache();
    const other = createThreadTabsSyncer({ transport: seeded.transport });
    await expect(other.migrate("thr_9", [fileA])).resolves.toBe(false);
    expect(seeded.writes).toHaveLength(0);
  });
});
