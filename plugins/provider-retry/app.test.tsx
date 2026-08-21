// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginProvidersState } from "@get-bb/plugin-sdk";
import type { ProviderRetryView } from "./src/contract.js";

type ProviderInfo = PluginProvidersState["providers"][number];

const app = await loadPluginApp(() => import("./app"));
const banner = app.composerCustomizations[0]!.banners![0]!;

const waitingView: ProviderRetryView = {
  threadId: "thread-one",
  providerId: "claude-code",
  retryAtMs: Date.parse("2026-08-05T15:12:00.000Z"),
};

const claudeCodeProvider: ProviderInfo = {
  id: "claude-code",
  displayName: "Claude Code",
  logoUrl: null,
  available: true,
  experimental_providerHealth: true,
  experimental_providerUsage: true,
  experimental_providerInstallation: true,
  capabilities: {
    supportsThreadArchive: false,
    supportsThreadRename: false,
    supportsServiceTier: false,
    supportsNativeUserQuestion: true,
    supportsFork: true,
    supportsSessionRewind: true,
    permissionModes: ["accept-edits", "auto", "full"],
  },
  composerActions: [],
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

  it("shows one automatic retry message with a cancel action", async () => {
    const slot = renderSlot(
      banner,
      {},
      {
        composer: { scope: { kind: "thread", threadId: "thread-one" } },
        // The provider's name comes from the host's directory, never from a
        // table in this plugin.
        providers: { providers: [claudeCodeProvider] },
        rpc: {
          providerRetryCancel: () => ({ cancelled: true }),
          providerRetryStatus: () => ({ view: waitingView }),
        },
      },
    );

    expect(
      await slot.findByText(/Claude Code usage limit reached\. Retrying/i),
    ).toBeTruthy();
    expect(slot.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("falls back to the provider id while the directory has no entry", async () => {
    const slot = renderSlot(
      banner,
      {},
      {
        composer: { scope: { kind: "thread", threadId: "thread-one" } },
        rpc: {
          providerRetryCancel: () => ({ cancelled: true }),
          providerRetryStatus: () => ({ view: waitingView }),
        },
      },
    );

    expect(
      await slot.findByText(/claude-code usage limit reached\. Retrying/i),
    ).toBeTruthy();
  });

  it("cancels a pending retry", async () => {
    let current: ProviderRetryView | null = waitingView;
    const slot = renderSlot(
      banner,
      {},
      {
        composer: { scope: { kind: "thread", threadId: "thread-one" } },
        rpc: {
          providerRetryCancel: () => {
            current = null;
            return { cancelled: true };
          },
          providerRetryStatus: () => ({ view: current }),
        },
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(slot.container.childElementCount).toBe(0));
    expect(slot.inspection.rpcCalls).toEqual(
      expect.arrayContaining([
        {
          method: "providerRetryCancel",
          input: { threadId: "thread-one" },
        },
      ]),
    );
  });

  it("removes the banner when the retry is no longer pending", async () => {
    let current: ProviderRetryView | null = waitingView;
    const slot = renderSlot(
      banner,
      {},
      {
        composer: { scope: { kind: "thread", threadId: "thread-one" } },
        rpc: {
          providerRetryCancel: () => ({ cancelled: true }),
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
          providerRetryCancel: () => ({ cancelled: true }),
          providerRetryStatus: () => ({
            view: { ...waitingView, retryAtMs: null },
          }),
        },
      },
    );

    expect(await slot.findByText(/Retrying automatically\.$/i)).toBeTruthy();
  });
});
