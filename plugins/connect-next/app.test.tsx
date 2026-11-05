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
    enabled: true,
    remoteAccess: true,
    state: "connected",
    label: "sawyer",
    url: "https://sawyer.next.getbb.app",
    server: "wss://tunnel.next.getbb.app/~!frp",
    lastError: null,
    nextRetryAt: null,
    since: 1_700_000_000_000,
    shares: [
      {
        port: 5173,
        url: "https://sawyer--5173.next.getbb.app",
        state: "active",
        error: null,
      },
    ],
    machines: [],
    ...overrides,
  };
}

function render(initial: ConnectNextStatus) {
  return renderSlot(
    app.settingsSections[0]!,
    {},
    { openUrl: () => true, rpc: { status: () => initial } },
  );
}

describe("connect next settings section", () => {
  it("shows one line of state without the next address, and follows realtime updates", async () => {
    const slot = render(status({ enabled: false, state: "off" }));
    await slot.findByText("Off");
    await slot.emitRealtime(
      CONNECT_NEXT_REALTIME_CHANNEL,
      status({ state: "connecting" }),
    );
    await slot.findByText("Connecting…");
    await slot.emitRealtime(CONNECT_NEXT_REALTIME_CHANNEL, status());
    await slot.findByText("Connected");
    expect(slot.container.textContent).not.toContain(".next.");
    expect(slot.queryAllByRole("link")).toEqual([]);
    expect(slot.container.querySelector(".rounded-full")).toBeNull();
  });

  it("says why it is off when bb connect's remote access is off", async () => {
    const slot = render(status({ remoteAccess: false, state: "off" }));
    await slot.findByText("Off");
    slot.getByText("Remote access is off in bb connect.");
  });

  it("shows the rollout wait quietly, without an error", async () => {
    const slot = render(
      status({ state: "waiting", nextRetryAt: 1_700_000_600_000 }),
    );
    await slot.findByText("Not yet available for this bb");
    expect(slot.container.textContent).toBe("Not yet available for this bb");
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it("explains a refused credential", async () => {
    const slot = render(
      status({
        state: "refused",
        lastError: "bb connect refused this server credential",
      }),
    );
    await slot.findByText("Credential refused");
    slot.getByText("bb connect refused this server credential");
  });

  it("names only machines whose tunnel has a problem", async () => {
    const machine = {
      label: null,
      lastError: null,
      nextRetryAt: null,
      since: 1_700_000_000_000,
      shares: [],
    };
    const slot = render(
      status({
        machines: [
          { ...machine, hostId: "h1", hostName: "laptop", state: "connected" },
          { ...machine, hostId: "h2", hostName: "studio", state: "waiting" },
          { ...machine, hostId: "h3", hostName: "box", state: "refused" },
        ],
      }),
    );
    await slot.findByText("box: Credential refused");
    expect(slot.container.textContent).not.toContain("laptop");
    expect(slot.container.textContent).not.toContain("studio");
  });
});
