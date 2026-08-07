// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import type { ProviderRetryView } from "./src/contract.js";

const app = await loadPluginApp(() => import("./app"));
const banner = app.composerCustomizations[0]!.banners![0]!;

const waitingView: ProviderRetryView = {
  threadId: "thread-one",
  failedRequestId: "request-one",
  scopeKey: "host-one:claude-code",
  hostId: "host-one",
  providerId: "claude-code",
  phase: "waiting-for-reset",
  automatic: true,
  dueAtMs: Date.parse("2026-08-05T15:12:00.000Z"),
  resetsAtMs: Date.parse("2026-08-05T15:11:30.000Z"),
  windowLabel: "Five-hour",
  kind: "subscription-window",
  reachedReason: "rate_limit_reached",
  overageReason: null,
  recoveryReason: "eligible",
  continuationError: null,
  refreshError: null,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("provider retry app", () => {
  it("registers a bare thread composer banner", () => {
    expect(app.composerCustomizations).toMatchObject([
      {
        id: "provider-retry-status",
        scopes: ["thread"],
        banners: [{ id: "subscription-recovery", chrome: "bare" }],
      },
    ]);
  });

  it("shows the scheduled reset and recovery actions", async () => {
    const slot = renderSlot(
      banner,
      {},
      {
        composer: { scope: { kind: "thread", threadId: "thread-one" } },
        rpc: {
          providerRetryStatus: () => ({ view: waitingView }),
          providerRetryNow: () => ({ started: true, view: null }),
          providerRetryCancel: () => ({ cancelled: true }),
          providerRetryRefresh: () => ({ view: waitingView }),
        },
      },
    );

    const description = await slot.findByText(
      /Claude Code five-hour usage limit reached/i,
    );
    expect(description.textContent).not.toContain("server");
    expect(
      slot.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Retry now", "Refresh", "Cancel"]);
  });

  it("reacts to backend signals and can continue immediately", async () => {
    let current: ProviderRetryView | null = waitingView;
    const slot = renderSlot(
      banner,
      {},
      {
        composer: { scope: { kind: "thread", threadId: "thread-one" } },
        rpc: {
          providerRetryStatus: () => ({ view: current }),
          providerRetryNow: () => {
            current = null;
            return { started: true, view: null };
          },
          providerRetryCancel: () => ({ cancelled: true }),
          providerRetryRefresh: () => ({ view: current }),
        },
      },
    );
    fireEvent.click(await slot.findByRole("button", { name: "Retry now" }));

    await waitFor(() => expect(slot.container.childElementCount).toBe(0));
    expect(slot.rpcCalls.map((call) => call.method)).toContain(
      "providerRetryNow",
    );

    current = { ...waitingView, phase: "waiting-for-host" };
    await slot.emitRealtime("provider-retry", { threadId: "thread-one" });
    expect(await slot.findByText(/when its host reconnects/i)).toBeTruthy();
  });

  it("renders credit exhaustion without claiming an automatic reset", async () => {
    const slot = renderSlot(
      banner,
      {},
      {
        composer: { scope: { kind: "thread", threadId: "thread-one" } },
        rpc: {
          providerRetryStatus: () => ({
            view: {
              ...waitingView,
              automatic: false,
              dueAtMs: null,
              resetsAtMs: null,
              phase: "blocked",
              kind: "credits",
              windowLabel: null,
            },
          }),
          providerRetryNow: () => ({ started: true, view: null }),
          providerRetryCancel: () => ({ cancelled: true }),
          providerRetryRefresh: () => ({ view: waitingView }),
        },
      },
    );

    expect(
      await slot.findByText(/There is no automatic reset time/i),
    ).toBeTruthy();
  });

  it("explains when the reset exceeds the maximum automatic wait", async () => {
    const slot = renderSlot(
      banner,
      {},
      {
        composer: { scope: { kind: "thread", threadId: "thread-one" } },
        rpc: {
          providerRetryStatus: () => ({
            view: {
              ...waitingView,
              phase: "manual-only",
              dueAtMs: null,
            },
          }),
          providerRetryNow: () => ({ started: true, view: null }),
          providerRetryCancel: () => ({ cancelled: true }),
          providerRetryRefresh: () => ({ view: waitingView }),
        },
      },
    );

    expect(
      await slot.findByText(/beyond the configured maximum automatic wait/i),
    ).toBeTruthy();
    expect(slot.getByText(/Retry manually when ready/i)).toBeTruthy();
    expect(slot.getByRole("button", { name: "Retry now" })).toBeTruthy();
  });

  it("explains when automatic continuation stops after an error", async () => {
    const failedView: ProviderRetryView = {
      ...waitingView,
      phase: "retry-failed",
      dueAtMs: null,
      continuationError: "This thread is awaiting user interaction",
    };
    const slot = renderSlot(
      banner,
      {},
      {
        composer: { scope: { kind: "thread", threadId: "thread-one" } },
        rpc: {
          providerRetryStatus: () => ({ view: failedView }),
          providerRetryNow: () => ({ started: false, view: failedView }),
          providerRetryCancel: () => ({ cancelled: true }),
          providerRetryRefresh: () => ({ view: failedView }),
        },
      },
    );

    expect(
      await slot.findByText(/bb could not continue automatically/i),
    ).toBeTruthy();
    expect(
      slot.getByText(/This thread is awaiting user interaction/i),
    ).toBeTruthy();
    expect(slot.getByRole("button", { name: "Retry now" })).toBeTruthy();
  });

  it("keeps the banner when cancellation loses to an in-progress release", async () => {
    const slot = renderSlot(
      banner,
      {},
      {
        composer: { scope: { kind: "thread", threadId: "thread-one" } },
        rpc: {
          providerRetryStatus: () => ({ view: waitingView }),
          providerRetryNow: () => ({ started: true, view: null }),
          providerRetryCancel: () => ({ cancelled: false }),
          providerRetryRefresh: () => ({ view: waitingView }),
        },
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: "Cancel" }));
    expect(
      await slot.findByText("This continuation is already in progress."),
    ).toBeTruthy();
    expect(
      slot.getByRole("region", { name: "Provider usage recovery" }),
    ).toBeTruthy();
  });
});
