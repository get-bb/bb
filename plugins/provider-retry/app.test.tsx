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
  scopeKey: "host-one:claudeCode",
  hostId: "host-one",
  providerId: "claudeCode",
  phase: "waiting-for-reset",
  automatic: true,
  dueAtMs: Date.parse("2026-08-05T15:12:00.000Z"),
  resetsAtMs: Date.parse("2026-08-05T15:11:30.000Z"),
  windowLabel: "Five-hour",
  kind: "subscription-window",
  reachedReason: "rate_limit_reached",
  overageReason: null,
  recoveryReason: "eligible",
  refreshAvailable: true,
  refreshError: null,
  processLifetime: true,
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

  it("shows the reset and process-lifetime warning", async () => {
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

    expect(
      await slot.findByText(/Claude Code five-hour usage limit reached/i),
    ).toBeTruthy();
    expect(
      slot.getByText(/while this bb server remains running/i),
    ).toBeTruthy();
    expect(slot.getByRole("button", { name: "Refresh" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Retry now" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Cancel" })).toBeTruthy();
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
});
