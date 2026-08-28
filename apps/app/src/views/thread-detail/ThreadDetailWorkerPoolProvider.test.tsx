// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useWorkerPool } from "@pierre/diffs/react";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import { useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PierreWorkerPoolBoundary } from "@/lib/pierre-worker-pool-boundary";
import {
  usePierreWorkerPool,
  useRequirePierreWorkerPool,
} from "@/lib/pierre-worker-pool-gate";
import {
  ThreadDetailWorkerPoolProvider,
  type ThreadDetailWorkerPoolModule,
} from "./ThreadDetailWorkerPoolProvider";

const fakePool: WorkerPoolManager = Object.create(WorkerPoolManager.prototype);
const acquirePierreWorkerPool = vi.fn<
  ThreadDetailWorkerPoolModule["acquirePierreWorkerPool"]
>((_theme) => fakePool);
const releasePierreWorkerPool = vi.fn();
const themeSyncMounts = vi.fn();

const fakeWorkerPoolModule = {
  acquirePierreWorkerPool,
  releasePierreWorkerPool,
  PierreWorkerPoolThemeSync: () => {
    themeSyncMounts();
    return null;
  },
} satisfies ThreadDetailWorkerPoolModule;

const loadWorkerPool = vi.fn<() => Promise<ThreadDetailWorkerPoolModule>>(
  async () => fakeWorkerPoolModule,
);

function TestWorkerPoolProvider({ children }: { children: ReactNode }) {
  return (
    <ThreadDetailWorkerPoolProvider loadWorkerPool={loadWorkerPool}>
      {children}
    </ThreadDetailWorkerPoolProvider>
  );
}

const flushLoad = () => act(() => new Promise((r) => setTimeout(r, 0)));

class FakeWorker {}

beforeEach(() => {
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

let mountCount = 0;

function PlainPane() {
  const pool = usePierreWorkerPool();
  useEffect(() => {
    mountCount += 1;
  }, []);
  return (
    <div data-testid="plain-pane">
      {pool === undefined ? "no pool" : "pool"}
    </div>
  );
}

function PierreElement() {
  const pool = useWorkerPool();
  return <>{pool === fakePool ? "ready with pool" : "ready without pool"}</>;
}

function DiffConsumer() {
  const ready = useRequirePierreWorkerPool();
  return (
    <div data-testid="diff-consumer">
      {ready ? (
        <PierreWorkerPoolBoundary>
          <PierreElement />
        </PierreWorkerPoolBoundary>
      ) : (
        "waiting"
      )}
    </div>
  );
}

describe("ThreadDetailWorkerPoolProvider", () => {
  it("does not build the pool until a diff consumer asks for it", async () => {
    render(
      <TestWorkerPoolProvider>
        <PlainPane />
      </TestWorkerPoolProvider>,
    );
    await flushLoad();

    expect(acquirePierreWorkerPool).not.toHaveBeenCalled();
    expect(screen.getByTestId("plain-pane").textContent).toBe("no pool");
  });

  it("builds the pool once after the first consumer asks, without remounting siblings", async () => {
    mountCount = 0;
    const { rerender, unmount } = render(
      <TestWorkerPoolProvider>
        <>
          <PlainPane />
        </>
      </TestWorkerPoolProvider>,
    );
    await flushLoad();
    expect(mountCount).toBe(1);

    rerender(
      <TestWorkerPoolProvider>
        <>
          <PlainPane />
          <DiffConsumer />
        </>
      </TestWorkerPoolProvider>,
    );
    expect(screen.getByTestId("diff-consumer").textContent).toBe("waiting");

    await flushLoad();
    expect(acquirePierreWorkerPool).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("diff-consumer").textContent).toBe(
      "ready with pool",
    );
    expect(screen.getByTestId("plain-pane").textContent).toBe("pool");
    expect(themeSyncMounts).toHaveBeenCalled();
    expect(mountCount).toBe(1);

    rerender(
      <TestWorkerPoolProvider>
        <>
          <PlainPane />
          <DiffConsumer />
          <DiffConsumer />
        </>
      </TestWorkerPoolProvider>,
    );
    await flushLoad();
    expect(acquirePierreWorkerPool).toHaveBeenCalledTimes(1);

    unmount();
    expect(releasePierreWorkerPool).toHaveBeenCalledTimes(1);
  });

  it("marks consumers ready at once when the page has no Worker support", async () => {
    vi.stubGlobal("Worker", undefined);
    render(
      <TestWorkerPoolProvider>
        <DiffConsumer />
      </TestWorkerPoolProvider>,
    );
    expect(screen.getByTestId("diff-consumer").textContent).toBe(
      "ready without pool",
    );
    await flushLoad();
    expect(acquirePierreWorkerPool).not.toHaveBeenCalled();
  });
});

describe("useRequirePierreWorkerPool", () => {
  it("is ready at once outside a workspace gate", () => {
    render(<DiffConsumer />);
    expect(screen.getByTestId("diff-consumer").textContent).toBe(
      "ready without pool",
    );
  });
});
