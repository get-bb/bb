// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  CONNECT_NEXT_REALTIME_CHANNEL,
  type ConnectNextStatus,
} from "@/src/types";

const app = await loadPluginApp(() => import("./app"));

afterEach(() => {
  cleanup();
});

function status(overrides: Partial<ConnectNextStatus> = {}): ConnectNextStatus {
  return {
    enabled: false,
    state: "off",
    label: "sawyer",
    url: "https://sawyer.next.getbb.app",
    server: "wss://tunnel.next.getbb.app/~!frp",
    lastError: null,
    nextRetryAt: null,
    since: 1_700_000_000_000,
    shares: [],
    machines: [],
    ...overrides,
  };
}

describe("connect next settings section", () => {
  it("lists the shared ports on the next address", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: () => true,
        rpc: {
          status: () =>
            status({
              enabled: true,
              state: "connected",
              shares: [
                {
                  port: 5173,
                  url: "https://sawyer--5173.next.getbb.app",
                  state: "active",
                  error: null,
                },
                {
                  port: 8080,
                  url: "https://sawyer--8080.next.getbb.app",
                  state: "refused",
                  error: "a server may only claim its own label",
                },
              ],
            }),
        },
      },
    );
    await slot.findByText("Shared ports");
    expect(
      slot.getByRole("link", { name: "https://sawyer--5173.next.getbb.app" }),
    ).toBeTruthy();
    expect(
      slot.queryByRole("link", { name: "https://sawyer--8080.next.getbb.app" }),
    ).toBeNull();
    slot.getByText("a server may only claim its own label");
  });

  it("shows the state and the address, and follows realtime updates", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      { openUrl: () => true, rpc: { status: () => status() } },
    );
    await slot.findByText("Off");
    slot.getByText("bb connect-next on");
    slot.getByText("https://sawyer.next.getbb.app");

    await slot.emitRealtime(
      CONNECT_NEXT_REALTIME_CHANNEL,
      status({ enabled: true, state: "connecting" }),
    );
    await slot.findByText("Connecting…");

    await slot.emitRealtime(
      CONNECT_NEXT_REALTIME_CHANNEL,
      status({ enabled: true, state: "connected" }),
    );
    await slot.findByText("Connected");
    expect(
      slot.getByRole("link", { name: "https://sawyer.next.getbb.app" }),
    ).toBeTruthy();
  });

  it("lists each machine's next tunnel and its shares", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: () => true,
        rpc: {
          status: () =>
            status({
              enabled: true,
              state: "connected",
              machines: [
                {
                  hostId: "host-laptop",
                  hostName: "laptop",
                  label: "laptop",
                  state: "connected",
                  lastError: null,
                  nextRetryAt: null,
                  since: 1_700_000_000_000,
                  shares: [
                    {
                      port: 3000,
                      url: "https://laptop--3000.next.getbb.app",
                      state: "active",
                      error: null,
                    },
                  ],
                },
                {
                  hostId: "host-box",
                  hostName: "box",
                  label: "box",
                  state: "refused",
                  lastError: "bb connect refused this server credential",
                  nextRetryAt: null,
                  since: 1_700_000_000_000,
                  shares: [],
                },
              ],
            }),
        },
      },
    );
    await slot.findByText("laptop");
    expect(
      slot.getByRole("link", { name: "https://laptop--3000.next.getbb.app" }),
    ).toBeTruthy();
    slot.getByRole("list", {
      name: "Shared ports from laptop on the next address",
    });
    slot.getByText("box");
    slot.getByText("Credential refused");
    slot.getByText("bb connect refused this server credential");
  });

  it("names no fixed domain and shows the address derived from the account", async () => {
    expect(app.settingsSections[0]!.description).toContain(
      "next.<your bb account's domain>",
    );
    expect(app.settingsSections[0]!.description).not.toContain("getbb.app");
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: () => true,
        rpc: {
          status: () =>
            status({
              enabled: true,
              state: "connected",
              url: "https://sawyer.next.vibecodethis.site",
              server: "wss://tunnel.next.vibecodethis.site/~!frp",
            }),
        },
      },
    );
    await slot.findByText("Connected");
    expect(
      slot.getByRole("link", { name: "https://sawyer.next.vibecodethis.site" }),
    ).toBeTruthy();
    expect(slot.container.textContent).not.toContain("getbb.app");
  });

  it("explains a refused credential", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: () => true,
        rpc: {
          status: () =>
            status({
              enabled: true,
              state: "refused",
              lastError: "bb connect refused this server credential",
            }),
        },
      },
    );
    await slot.findByText("The gate refused this bb's credential");
    slot.getByText("bb connect refused this server credential");
  });
});
