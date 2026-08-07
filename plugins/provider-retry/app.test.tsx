// @vitest-environment jsdom
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import type { ProviderRetryView } from "./src/contract.js";

const app = await loadPluginApp(() => import("./app"));
const banner = app.composerCustomizations[0]!.banners![0]!;

const waitingView: ProviderRetryView = {
  threadId: "thread-one",
  providerId: "claude-code",
  retryAtMs: Date.parse("2026-08-05T15:12:00.000Z"),
};

afterEach(cleanup);

describe("provider retry app", () => {
  it("registers one bare thread composer banner", () => {
    expect(app.composerCustomizations).toMatchObject([
      {
        id: "provider-retry-status",
        scopes: ["thread"],
        banners: [{ id: "subscription-recovery", chrome: "bare" }],
      },
    ]);
  });

  it("shows one automatic retry message without actions", async () => {
    const slot = renderSlot(
      banner,
      {},
      {
        composer: { scope: { kind: "thread", threadId: "thread-one" } },
        rpc: {
          providerRetryStatus: () => ({ view: waitingView }),
        },
      },
    );

    expect(
      await slot.findByText(
        /Claude Code usage limit reached\. Retrying/i,
      ),
    ).toBeTruthy();
    expect(slot.queryAllByRole("button")).toHaveLength(0);
  });

  it("removes the banner when the retry is no longer pending", async () => {
    let current: ProviderRetryView | null = waitingView;
    const slot = renderSlot(
      banner,
      {},
      {
        composer: { scope: { kind: "thread", threadId: "thread-one" } },
        rpc: {
          providerRetryStatus: () => ({ view: current }),
        },
      },
    );
    await slot.findByRole("region", { name: "Provider usage recovery" });

    current = null;
    await slot.emitRealtime("provider-retry", { threadId: "thread-one" });
    await waitFor(() => expect(slot.container.childElementCount).toBe(0));
  });

  it("uses generic copy when no exact retry time is available", async () => {
    const slot = renderSlot(
      banner,
      {},
      {
        composer: { scope: { kind: "thread", threadId: "thread-one" } },
        rpc: {
          providerRetryStatus: () => ({
            view: { ...waitingView, retryAtMs: null },
          }),
        },
      },
    );

    expect(await slot.findByText(/Retrying automatically\.$/i)).toBeTruthy();
  });
});
