// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@bb/plugin-sdk/testing/app";

const cache = { state: "fresh" as const, asOf: "2026-08-13T12:00:00.000Z", message: null, acceptedGenerationId: "g1", baseRevision: 1 };

class LogResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void { queueMicrotask(() => this.callback([{ target, contentRect: new DOMRectReadOnly(0, 0, 900, 256), borderBoxSize: [{ blockSize: 256, inlineSize: 900 }], contentBoxSize: [{ blockSize: 256, inlineSize: 900 }], devicePixelContentBoxSize: [{ blockSize: 256, inlineSize: 900 }] } as ResizeObserverEntry], this)); }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => { installTestPluginRuntime(); vi.stubGlobal("ResizeObserver", LogResizeObserver); Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 256 }); HTMLElement.prototype.scrollTo = function scrollTo(options?: ScrollToOptions | number, y?: number) { this.scrollTop = typeof options === "number" ? (y ?? 0) : (options?.top ?? 0); this.dispatchEvent(new Event("scroll")); }; });
afterEach(() => cleanup());

describe("LogTail", () => {
  it("deduplicates reordered hints, pages, bounds the DOM, reconciles reconnect, and retains prior tail on failure", async () => {
    const { LogTail } = await import("./log-tail.js");
    let reads = 0;
    let fail = false;
    const slot = renderSlot({ component: () => <LogTail projectId="p1" projectVersionId="v1" runId="run-1" /> }, {}, {
      realtimeConnectionState: "connected",
      rpc: { benchLogsList: (input: unknown) => { reads += 1; if (fail) throw new Error("log source unavailable"); const continuation = typeof input === "object" && input !== null ? Reflect.get(input, "continuation") : null; const start = continuation ? 200 : 0; return { items: Array.from({ length: 200 }, (_, index) => ({ projectId: "p1", projectVersionId: "v1", sequence: start + index, at: "2026-08-13T12:00:00.000Z", level: index % 10 ? "stdout" : "stderr", text: `line ${start + index}` })), total: 400, next: continuation ? null : "cursor-200", cache }; } },
    });
    expect(await slot.findByText("line 0")).toBeTruthy();
    expect(slot.container.querySelectorAll("[data-bench-log-line]").length).toBeLessThan(50);
    expect(slot.getByRole("link", { name: /Download cached log/u }).getAttribute("href")).toBe("/api/v1/plugins/finite-state/http/bench/runs/log?runId=run-1");
    await slot.behavior.emitRealtime("bench:log", { runId: "run-1", sequence: 199 });
    await slot.behavior.emitRealtime("bench:log", { runId: "run-1", sequence: 999 });
    fireEvent.click(slot.getByRole("button", { name: "Load next log page" }));
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    fail = true;
    await slot.behavior.emitRealtime("bench:log", { runId: "run-1", sequence: 1000 });
    expect(await slot.findByText(/Prior tail retained/u)).toBeTruthy();
    expect(slot.container.querySelectorAll("[data-bench-log-line]").length).toBeLessThan(50);
  });
});
