// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageProvider } from "./usage-schema.js";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function threadOnMachine(
  hostId: string,
  hostName: string,
): PluginSidebarThread {
  return {
    id: "thread-active",
    projectId: "project-one",
    title: "Active thread",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: { id: hostId, name: hostName },
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: 1,
    latestAttentionAt: 1,
  };
}

describe("provider usage footer disclosure", () => {
  it("aggregates every machine and keeps machine and provider selection local to the card", async () => {
    const pooledAccounts: UsageProvider[] = (
      [
        ["codex", "Codex", "team@example.com", 46],
        ["codex", "Codex", "personal@example.com", 82],
        ["claude-code", "Claude Code", "claude-team@example.com", 97],
      ] as const
    ).map(([providerId, displayName, email, usedPercent]) => ({
      id: email,
      providerId: providerId,
      accountLabel: email,
      displayName: displayName,
      logoUrl: `/api/v1/system/providers/${providerId}/logo`,
      icon: null,
      strings: { iconTint: null },
      signInHint: "Sign in.",
      expiredHint: "Sign in again.",
      usage: {
        status: "ok",
        accountEmail: email,
        planLabel: "Pro",
        windows: [
          {
            label: "Weekly limit",
            usedPercent: usedPercent,
            resetsAt:
              email === "personal@example.com"
                ? new Date(Date.now() + 51 * 60 * 60_000).toISOString()
                : null,
            cost: null,
          },
        ],
      },
    }));
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              machines: [
                {
                  id: "host-m4",
                  displayName: "M4",
                  status: "connected",
                  error: null,
                  providers: [
                    {
                      id: "claude-code",
                      providerId: "claude-code",
                      accountLabel: null,
                      displayName: "Claude Code",
                      logoUrl:
                        "/api/v1/system/providers/claude-code/logo?h=claude",
                      icon: null,
                      strings: {
                        iconTint: { light: "#D97757", dark: "#E38A6E" },
                      },
                      signInHint: "Sign in to Claude Code.",
                      expiredHint: "Sign in to Claude Code again.",
                      usage: {
                        status: "ok",
                        accountEmail: "claude@example.com",
                        planLabel: "Max",
                        windows: [
                          {
                            label: "Five-hour limit",
                            usedPercent: 82,
                            resetsAt: "2026-09-02T18:42:00.000Z",
                            cost: null,
                          },
                        ],
                      },
                    },
                    {
                      id: "codex",
                      providerId: "codex",
                      accountLabel: null,
                      displayName: "Codex",
                      logoUrl: "/api/v1/system/providers/codex/logo?h=codex",
                      icon: null,
                      strings: { iconTint: null },
                      signInHint: "Sign in to Codex.",
                      expiredHint: "Sign in to Codex again.",
                      usage: {
                        status: "ok",
                        accountEmail: "codex@example.com",
                        planLabel: "Plus",
                        windows: [
                          {
                            label: "Weekly limit",
                            usedPercent: 37,
                            resetsAt: null,
                            cost: null,
                          },
                        ],
                      },
                    },
                  ],
                },
                {
                  id: "host-m5",
                  displayName: "M5",
                  status: "connected",
                  error: null,
                  providers: [
                    {
                      id: "codex",
                      providerId: "codex",
                      accountLabel: null,
                      displayName: "Codex",
                      logoUrl: "/api/v1/system/providers/codex/logo?h=codex",
                      icon: null,
                      strings: { iconTint: null },
                      signInHint: "Sign in to Codex.",
                      expiredHint: "Sign in to Codex again.",
                      usage: {
                        status: "ok",
                        accountEmail: "codex@example.com",
                        planLabel: "Plus",
                        windows: [
                          {
                            label: "Weekly limit",
                            usedPercent: 97,
                            resetsAt: null,
                            cost: null,
                          },
                        ],
                      },
                    },
                  ],
                },
                {
                  id: "source:account-pool",
                  displayName: "Account Pooler",
                  status: "connected",
                  error: null,
                  providers: pooledAccounts,
                },
                {
                  id: "host-intel",
                  displayName: "Intel",
                  status: "disconnected",
                  error: null,
                  providers: [],
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = await loadPluginApp(() => import("./app"));
    const mounted = await mountPluginContentScripts(app, {
      pluginId: "provider-usage",
    });
    const item = app.experimentalSidebarFooterItems[0];
    expect(item).toMatchObject({
      kind: "disclosure",
      id: "usage",
      label: "Provider usage",
      icon: "ChartColumn",
    });
    if (item?.kind !== "disclosure") throw new Error("missing disclosure");

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/plugins/provider-usage/rpc/getUsage",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            force: false,
            machineIds: null,
            maxAgeMs: 30 * 60_000,
            providerId: null,
          }),
        }),
      ),
    );
    const dismiss = vi.fn();
    const slot = renderSlot(
      item,
      { dismiss },
      {
        context: { threadId: "thread-active" },
        sidebarThreads: {
          threads: [threadOnMachine("host-m5", "M5")],
        },
      },
    );
    expect(
      slot.getByRole("button", { name: "Usage machine: Account Pooler" }),
    ).toBeTruthy();
    expect(
      slot.getByRole("heading", { name: "personal@example.com" }),
    ).toBeTruthy();
    fireEvent.pointerDown(
      slot.getByRole("button", { name: "Usage machine: Account Pooler" }),
      { button: 0 },
    );
    fireEvent.click(slot.getByRole("menuitemradio", { name: "M5" }));
    const machinePicker = slot.getByRole("button", {
      name: "Usage machine: M5",
    });
    expect(slot.getByRole("heading", { name: "Codex" })).toBeTruthy();
    expect(slot.getByText("codex@example.com")).toBeTruthy();
    expect(slot.getByText("97%")).toBeTruthy();

    fireEvent.pointerDown(machinePicker, { button: 0 });
    fireEvent.click(slot.getByRole("menuitemradio", { name: "M4" }));
    const claudeTab = slot.getByRole("tab", { name: "Claude Code" });
    const codexTab = slot.getByRole("tab", { name: "Codex" });
    expect(
      slot
        .getByRole("button", { name: "Usage machine: M4" })
        .closest('[data-provider-usage-header=""]'),
    ).toBe(claudeTab.closest('[data-provider-usage-header=""]'));
    expect(
      claudeTab.querySelector("[data-provider-logo*='claude-code']"),
    ).not.toBeNull();
    expect(
      codexTab.querySelector("[data-provider-logo*='/codex/']"),
    ).not.toBeNull();
    expect(slot.getByRole("heading", { name: "Claude Code" })).toBeTruthy();
    expect(slot.getByText("claude@example.com")).toBeTruthy();
    expect(slot.getByText("82%")).toBeTruthy();

    fireEvent.click(codexTab);
    expect(slot.getByRole("heading", { name: "Codex" })).toBeTruthy();
    expect(slot.getByText("codex@example.com")).toBeTruthy();
    expect(slot.getByText("37%")).toBeTruthy();
    fireEvent.keyDown(codexTab, { key: "ArrowLeft" });
    expect(claudeTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.pointerDown(
      slot.getByRole("button", { name: "Usage machine: M4" }),
      { button: 0 },
    );
    fireEvent.click(slot.getByRole("menuitemradio", { name: "Intel" }));
    expect(
      slot.getByText(
        "Intel is offline. Usage will refresh when it reconnects.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      slot.getByRole("button", { name: "Collapse provider usage" }),
    );
    expect(dismiss).toHaveBeenCalledOnce();
    const reloadButton = slot.getByRole("button", {
      name: "Reload provider usage",
    }) as HTMLButtonElement;
    await waitFor(() => expect(reloadButton.disabled).toBe(false));
    const callsBeforeManualRefresh = fetchMock.mock.calls.length;
    fireEvent.click(reloadButton);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledTimes(callsBeforeManualRefresh + 1),
    );
    expect(fetchMock.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          force: true,
          machineIds: ["host-intel"],
          maxAgeMs: 0,
          providerId: null,
        }),
      }),
    );

    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    window.dispatchEvent(new Event("blur"));
    now.mockReturnValue(5 * 60_000 + 1_001);
    const callsBeforeFocus = fetchMock.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledTimes(callsBeforeFocus + 1),
    );
    expect(fetchMock.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          force: false,
          machineIds: null,
          maxAgeMs: 5 * 60_000,
          providerId: null,
        }),
      }),
    );

    now.mockRestore();
    fireEvent.pointerDown(
      slot.getByRole("button", { name: "Usage machine: Intel" }),
      { button: 0 },
    );
    fireEvent.click(
      slot.getByRole("menuitemradio", { name: "Account Pooler" }),
    );
    expect(slot.getAllByRole("tab")).toHaveLength(2);
    const poolCodexTab = slot.getByRole("tab", { name: "Codex" });
    expect(
      poolCodexTab.querySelector("[data-provider-logo*='/codex/']"),
    ).not.toBeNull();
    expect(
      poolCodexTab.querySelector('[data-provider-usage-tone="warning"]'),
    ).not.toBeNull();
    expect(slot.getAllByText("team@example.com")).toHaveLength(1);
    expect(slot.getAllByText("personal@example.com")).toHaveLength(1);
    expect(slot.getByText("46%")).toBeTruthy();
    expect(slot.getByText("2d 3h")).toBeTruthy();
    expect(
      slot.getAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual(["team@example.com", "personal@example.com"]);
    const windowButton = slot.getByRole("button", {
      name: "Weekly limit: 46% used. Reset time not reported",
    });
    fireEvent.click(windowButton);
    expect(slot.getByText("Reset time not reported.")).toBeTruthy();
    expect(slot.getByText("82%")).toBeTruthy();
    fireEvent.click(slot.getByRole("tab", { name: "Claude Code" }));
    expect(slot.getByText("claude-team@example.com")).toBeTruthy();
    expect(slot.queryByText("personal@example.com")).toBeNull();
    const diagnostics = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    for (const failure of [
      () => new Response("bb connect temporarily unavailable", { status: 503 }),
      () => new Response("bb connect is not JSON", { status: 200 }),
      () => Response.json({ ok: true, result: { machines: "invalid" } }),
    ]) {
      await waitFor(() =>
        expect(
          slot
            .getByRole("button", { name: "Reload provider usage" })
            .hasAttribute("disabled"),
        ).toBe(false),
      );
      fetchMock.mockResolvedValueOnce(failure());
      fireEvent.click(
        slot.getByRole("button", { name: "Reload provider usage" }),
      );
      await waitFor(() =>
        expect(
          slot.getByText("Couldn’t refresh. Showing the last update."),
        ).toBeTruthy(),
      );
      expect(slot.getByText("claude-team@example.com")).toBeTruthy();
      expect(
        slot.queryByText(/Unexpected token|bb connect|invalid JSON/i),
      ).toBeNull();
      fireEvent.click(
        slot.getByRole("button", { name: "Retry usage refresh" }),
      );
      await waitFor(() =>
        expect(
          slot.queryByText("Couldn’t refresh. Showing the last update."),
        ).toBeNull(),
      );
    }
    expect(diagnostics).toHaveBeenCalledTimes(3);
    await mounted.lifecycle.dispose();
  }, 15_000);
});

it.each([
  ["empty", "No accounts report usage yet."],
  ["expired", "Sign in again in the source plugin’s settings."],
  [
    "unauthenticated",
    "Sign in to this account in the source plugin’s settings.",
  ],
  ["no-limits", "No usage limits reported for this plan."],
  ["source-error", "Couldn’t refresh. Showing the last update."],
] as const)("renders the %s shared-source state", async (state, expected) => {
  const usage: UsageProvider["usage"] =
    state === "expired" || state === "unauthenticated"
      ? { status: state }
      : {
          status: "ok",
          accountEmail: "review@example.com",
          planLabel: null,
          windows:
            state === "no-limits"
              ? []
              : [
                  {
                    label: "Weekly limit",
                    usedPercent: 42,
                    resetsAt: null,
                    cost: null,
                  },
                ],
        };
  const account: UsageProvider = {
    id: "account",
    providerId: "codex",
    accountLabel: "review@example.com",
    displayName: "Codex",
    logoUrl: null,
    icon: null,
    strings: { iconTint: null },
    signInHint: "Sign in to this account in the source plugin’s settings.",
    expiredHint: "Sign in again in the source plugin’s settings.",
    usage,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ok: true,
        result: {
          machines: [
            {
              id: "source:pool",
              displayName: "Review pool",
              status: "connected",
              providers: state === "empty" ? [] : [account],
              error: state === "source-error" ? "private backend error" : null,
            },
          ],
        },
      }),
    ),
  );
  const app = await loadPluginApp(() => import("./app"));
  const mounted = await mountPluginContentScripts(app, {
    pluginId: "provider-usage",
  });
  const item = app.experimentalSidebarFooterItems[0];
  if (item?.kind !== "disclosure") throw new Error("missing disclosure");
  const slot = renderSlot(item, { dismiss: vi.fn() });
  await waitFor(() =>
    expect(slot.getByText(expected, { exact: false })).toBeTruthy(),
  );
  if (state === "source-error") {
    expect(slot.getByText("42%")).toBeTruthy();
    expect(slot.queryByText("private backend error")).toBeNull();
    expect(
      slot.getByRole("button", { name: "Retry usage refresh" }),
    ).toBeTruthy();
  }
  await mounted.lifecycle.dispose();
});
