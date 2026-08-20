// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { WorkerPoolManager, WorkerStats } from "@pierre/diffs/worker";
import { StrictMode, type ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PierreWorkerPoolGateContext,
  type PierreWorkerPoolGate,
} from "./pierre-worker-pool-gate";

const pierreMock = vi.hoisted(
  (): {
    fileDiffMountCount: number;
    fileDiffRenderCount: number;
    workerSettlementVersion: number | undefined;
  } => ({
    fileDiffMountCount: 0,
    fileDiffRenderCount: 0,
    workerSettlementVersion: undefined,
  }),
);

vi.mock("@pierre/diffs/react", async () => {
  const react = await import("react");
  const WorkerPoolContext = react.createContext<WorkerPoolManager | undefined>(
    undefined,
  );
  const NullComponent = () => null;
  const FileDiff = ({ options }: { options?: Record<string, unknown> }) => {
    pierreMock.fileDiffRenderCount += 1;
    const settlementVersion = options?.__bbWorkerSettlementVersion;
    pierreMock.workerSettlementVersion =
      typeof settlementVersion === "number" ? settlementVersion : undefined;
    react.useEffect(() => {
      pierreMock.fileDiffMountCount += 1;
    }, []);
    return react.createElement("div", {
      "data-render-count": pierreMock.fileDiffRenderCount,
      "data-testid": "pierre-file-diff",
    });
  };
  return {
    CodeView: NullComponent,
    File: NullComponent,
    FileDiff,
    GutterUtilitySlotStyles: {},
    MergeConflictSlotStyles: {},
    MultiFileDiff: NullComponent,
    PatchDiff: NullComponent,
    UnresolvedFile: NullComponent,
    Virtualizer: NullComponent,
    VirtualizerContext: react.createContext(undefined),
    WorkerPoolContext,
    WorkerPoolContextProvider: NullComponent,
    noopRender: vi.fn(),
    renderDiffChildren: vi.fn(),
    renderFileChildren: vi.fn(),
    templateRender: vi.fn(),
    useFileDiffInstance: vi.fn(),
    useFileInstance: vi.fn(),
    useStableCallback: vi.fn(),
    useVirtualizer: vi.fn(),
    useWorkerPool: () => react.useContext(WorkerPoolContext),
  };
});

import { createGatedPierreDiffsReact } from "./plugin-pierre-diffs-react";

afterEach(() => {
  cleanup();
  pierreMock.fileDiffMountCount = 0;
  pierreMock.fileDiffRenderCount = 0;
  pierreMock.workerSettlementVersion = undefined;
  vi.clearAllMocks();
});

describe("plugin pierre diff worker settlement", () => {
  it("revisits a Strict Mode plugin diff once after its worker task settles", async () => {
    let stats: WorkerStats = {
      managerState: "initialized",
      totalWorkers: 2,
      workersFailed: false,
      busyWorkers: 1,
      queuedTasks: 0,
      activeTasks: 1,
      themeSubscribers: 1,
      fileCacheSize: 0,
      diffCacheSize: 0,
    };
    const subscribers = new Set<(next: WorkerStats) => unknown>();
    const pool = {
      subscribeToStatChanges(callback: (next: WorkerStats) => unknown) {
        subscribers.add(callback);
        callback(stats);
        return () => subscribers.delete(callback);
      },
    } as unknown as WorkerPoolManager;
    const gate: PierreWorkerPoolGate = {
      pool,
      ready: true,
      request: vi.fn(),
    };
    const GatedFileDiff = createGatedPierreDiffsReact()
      .FileDiff as ComponentType;

    render(
      <StrictMode>
        <PierreWorkerPoolGateContext.Provider value={gate}>
          <GatedFileDiff />
        </PierreWorkerPoolGateContext.Provider>
      </StrictMode>,
    );

    await waitFor(() => expect(subscribers.size).toBe(1));
    const mountsBeforeSettlement = pierreMock.fileDiffMountCount;
    const rendersBeforeSettlement = pierreMock.fileDiffRenderCount;

    stats = {
      ...stats,
      busyWorkers: 0,
      activeTasks: 0,
    };
    act(() => {
      for (const subscriber of subscribers) subscriber(stats);
    });

    await waitFor(() =>
      expect(pierreMock.fileDiffRenderCount).toBeGreaterThan(
        rendersBeforeSettlement,
      ),
    );
    expect(pierreMock.workerSettlementVersion).toBe(1);
    expect(pierreMock.fileDiffMountCount).toBe(mountsBeforeSettlement);
    // The recovery is one-shot; later pool traffic must not fan out into a
    // rerender of every plugin diff on the page.
    expect(subscribers.size).toBe(0);
  });
});
