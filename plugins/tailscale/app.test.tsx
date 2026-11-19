// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { TailscaleStatus } from "@/src/types";

const app = await loadPluginApp(() => import("./app"));

afterEach(() => {
  cleanup();
});

function status(overrides: Partial<TailscaleStatus> = {}): TailscaleStatus {
  return {
    state: "not-served",
    message:
      "Set up Tailscale Serve for bb in Settings → Tailscale, or run bb tailscale setup",
    adminUrl: null,
    cliPath: "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    version: "1.104.7",
    tailnet: "tail1234.ts.net",
    dnsName: "mini.tail1234.ts.net",
    target: "http://127.0.0.1:38886",
    serve: null,
    https: null,
    checkedAt: 1_700_000_000_000,
    ...overrides,
  };
}

const served = (owner: "bb" | "adopted") =>
  status({
    state: "served",
    message: null,
    serve: {
      port: 443,
      url: "https://mini.tail1234.ts.net",
      owner,
      funnel: false,
    },
    https: { ok: true, error: null, checkedAt: 1_700_000_000_000 },
  });

describe("tailscale settings section", () => {
  it("sets up Serve and then offers to remove bb's own mapping", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: () => true,
        rpc: { status: () => status(), setup: () => served("bb") },
      },
    );
    fireEvent.click(await slot.findByRole("button", { name: "Set up" }));
    await slot.findByText("Reachable on your tailnet");
    expect(
      slot.getByRole("link", { name: "https://mini.tail1234.ts.net" }),
    ).toBeTruthy();
    expect(slot.rpcCalls.map((call) => call.method)).toContain("setup");
    expect(slot.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Set up" })).toBeNull();
  });

  it("says the address isn't answering instead of reachable when the HTTPS check fails", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: () => true,
        rpc: {
          status: () => ({
            ...served("bb"),
            https: {
              ok: false,
              error:
                "https://mini.tail1234.ts.net/health didn't answer: fetch failed",
              checkedAt: 1_700_000_000_000,
            },
          }),
        },
      },
    );
    await slot.findByText("Set up, but not answering yet");
    expect(slot.queryByText("Reachable on your tailnet")).toBeNull();
    expect(slot.getByText(/didn't answer: fetch failed/u)).toBeTruthy();
    expect(slot.getByRole("button", { name: "Remove" })).toBeTruthy();
  });

  it("never offers to remove a mapping made outside bb", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      { openUrl: () => true, rpc: { status: () => served("adopted") } },
    );
    await slot.findByText(/set up outside bb/u);
    expect(slot.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(slot.queryByRole("button", { name: "Set up" })).toBeNull();
  });

  it("links to the tailnet DNS settings when HTTPS certificates are off", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: () => true,
        rpc: {
          status: () =>
            status({
              state: "needs-https",
              message:
                "Turn on HTTPS certificates in your tailnet's DNS settings",
              adminUrl: "https://login.tailscale.com/admin/dns",
            }),
        },
      },
    );
    await slot.findByText("HTTPS certificates are off");
    expect(
      slot
        .getByRole("link", { name: "Open DNS settings" })
        .getAttribute("href"),
    ).toBe("https://login.tailscale.com/admin/dns");
    expect(slot.queryByRole("button", { name: "Set up" })).toBeNull();
  });
});
