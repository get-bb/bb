// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";

const cache = {
  state: "fresh" as const,
  asOf: "2026-08-13T12:00:00.000Z",
  message: null,
  acceptedGenerationId: "g1",
  baseRevision: 1,
};

class BenchResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    queueMicrotask(() =>
      this.callback(
        [
          {
            target,
            contentRect: new DOMRectReadOnly(0, 0, 900, 600),
            borderBoxSize: [{ blockSize: 600, inlineSize: 900 }],
            contentBoxSize: [{ blockSize: 600, inlineSize: 900 }],
            devicePixelContentBoxSize: [{ blockSize: 600, inlineSize: 900 }],
          } as ResizeObserverEntry,
        ],
        this,
      ),
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  installTestPluginRuntime();
  vi.stubGlobal("ResizeObserver", BenchResizeObserver);
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
  HTMLElement.prototype.scrollTo = function scrollTo(
    options?: ScrollToOptions | number,
    y?: number,
  ) {
    this.scrollTop =
      typeof options === "number" ? (y ?? 0) : (options?.top ?? 0);
    this.dispatchEvent(new Event("scroll"));
  };
});
afterEach(() => cleanup());

function run(index: number) {
  return {
    projectId: "p1",
    projectVersionId: "v1",
    kind: "verificationRun",
    key: `run-${index}`,
    label: "run",
    fields: {
      tier: index % 2 ? "tier1" : "tier0",
      kind: "verification",
      trigger: index % 2 ? "manual" : "sync",
      status: index === 0 ? "failed" : "completed",
      firmwareDigest: "a".repeat(64),
      threadId: `thread-${index}`,
      startedAt: "2026-08-13T12:00:00.000Z",
      finishedAt: "2026-08-13T12:00:01.000Z",
      signed: index !== 0,
    },
  };
}

describe("RunTimeline", () => {
  it("clears prior-scope rows when the next scope fails to load", async () => {
    const { RunTimeline } = await import("./run-timeline.js");
    const rpc = {
      benchRunsList: (input: unknown) => {
        const version =
          typeof input === "object" && input !== null
            ? Reflect.get(input, "projectVersionId")
            : null;
        if (version === "v2") {
          throw new Error(
            "Bench evidence requires an accepted verificationRun generation",
          );
        }
        return { items: [run(0)], total: 1, next: null, cache };
      },
    };
    const slot = renderSlot(
      {
        component: () => (
          <RunTimeline
            onOpen={() => {}}
            onRunTier0={() => {}}
            projectId="p1"
            projectVersionId="v1"
            runDisabledReason={null}
          />
        ),
      },
      {},
      { rpc },
    );
    expect(await slot.findByText("run-0")).toBeTruthy();
    slot.lifecycle.rerender(
      <RunTimeline
        onOpen={() => {}}
        onRunTier0={() => {}}
        projectId="p1"
        projectVersionId="v2"
        runDisabledReason={null}
      />,
    );
    expect(await slot.findByText(/no accepted bench evidence/u)).toBeTruthy();
    expect(slot.queryByText("run-0")).toBeNull();
  });

  it("renders an honest empty state when the accepted cache has no runs", async () => {
    const { RunTimeline } = await import("./run-timeline.js");
    const slot = renderSlot(
      {
        component: () => (
          <RunTimeline
            onOpen={() => {}}
            onRunTier0={() => {}}
            projectId="p1"
            projectVersionId="v1"
            runDisabledReason={null}
          />
        ),
      },
      {},
      {
        rpc: {
          benchRunsList: () => ({
            items: [],
            total: 0,
            next: null,
            cache: {
              ...cache,
              state: "empty",
              message: "No bench evidence is cached for this scope.",
            },
          }),
        },
      },
    );
    expect(await slot.findByText("No bench runs yet")).toBeTruthy();
    expect(slot.queryByText("Bench timeline unavailable")).toBeNull();
  });

  it("virtualizes, filters, pages stably, links the native thread, and refetches late status", async () => {
    const { RunTimeline } = await import("./run-timeline.js");
    let reads = 0;
    const slot = renderSlot(
      {
        component: () => (
          <RunTimeline
            onOpen={() => {}}
            onRunTier0={() => {}}
            projectId="p1"
            projectVersionId="v1"
            runDisabledReason={null}
          />
        ),
      },
      {},
      {
        rpc: {
          benchRunsList: (input: unknown) => {
            reads += 1;
            const continuation =
              typeof input === "object" && input !== null
                ? Reflect.get(input, "continuation")
                : null;
            return continuation
              ? { items: [run(1000)], total: 1001, next: null, cache }
              : {
                  items: Array.from({ length: 1000 }, (_, index) => run(index)),
                  total: 1001,
                  next: "older",
                  cache,
                };
          },
        },
      },
    );
    expect(await slot.findByText("run-0")).toBeTruthy();
    expect(
      slot.container.querySelectorAll("[data-bench-run-row]").length,
    ).toBeLessThan(50);
    expect(slot.getByText("Unsigned")).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Filter by tier"), {
      target: { value: "tier0" },
    });
    fireEvent.click(slot.getByLabelText("Failing only"));
    expect(slot.getByText("run-0")).toBeTruthy();
    fireEvent.click(
      slot.getByRole("button", { name: "Open native thread for run-0" }),
    );
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thread-0",
    });
    fireEvent.click(slot.getByRole("button", { name: "Load older runs" }));
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.some(
          (call) =>
            Reflect.get(call.input as object, "continuation") === "older",
        ),
      ).toBe(true),
    );
    await slot.behavior.emitRealtime("bench:changed", {
      runId: "run-0",
      status: "completed",
    });
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(3));
  });
});
