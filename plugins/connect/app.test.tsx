// @vitest-environment jsdom
// Frontend coverage for the builtin Connect plugin's settings section, using
// the official plugin app harness instead of a host app or built bundle.
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { CONNECT_REALTIME_CHANNEL, type ConnectStatus } from "@/src/types";

const app = await loadPluginApp(() => import("./app"));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(cleanup);

function status(overrides: Partial<ConnectStatus> = {}): ConnectStatus {
  return {
    state: "disconnected",
    paired: false,
    handle: null,
    url: null,
    dashboardUrl: "https://getbb.app/dashboard",
    lastError: null,
    nextRetryAt: null,
    since: 1_700_000_000_000,
    remoteClients: 0,
    lastRemoteActivityAt: null,
    shares: [],
    ...overrides,
  };
}

const connected = (overrides: Partial<ConnectStatus> = {}) =>
  status({
    state: "connected",
    paired: true,
    handle: "workstation",
    url: "https://workstation.getbb.app",
    since: 1_700_000_060_000,
    ...overrides,
  });

describe("connect settings section", () => {
  it("auto-submits a normalized 4-4 code and applies live paired status", async () => {
    let currentStatus = status();
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => currentStatus,
          pair: () => null,
        },
      },
    );

    await slot.findByText("Get a connect code");
    // Messy case/whitespace/dash input normalizes to the canonical XXXX-XXXX
    // and connects automatically — no Connect click.
    fireEvent.change(slot.getByLabelText("Connect code"), {
      target: { value: "  k7qp-2m4x  " },
    });

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "pair",
        input: { code: "K7QP-2M4X" },
      }),
    );
    expect(slot.queryByText("https://workstation.getbb.app")).toBeNull();

    currentStatus = connected();
    await slot.emitRealtime(CONNECT_REALTIME_CHANNEL, currentStatus);

    await slot.findByText("Connected");
    slot.getByText("https://workstation.getbb.app");
    slot.getByRole("button", { name: "Copy URL" });
  });

  it("does not auto-submit an incomplete code", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      { rpc: { status: () => status(), pair: () => null } },
    );
    await slot.findByText("Get a connect code");
    fireEvent.change(slot.getByLabelText("Connect code"), {
      target: { value: "K7QP-2M4" },
    });
    // Connect button stays disabled and nothing was submitted.
    expect(
      (slot.getByRole("button", { name: "Connect" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(slot.rpcCalls.some((call) => call.method === "pair")).toBe(false);
  });

  it("maps a typed pair error code to human copy, never wire text", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => status(),
          pair: () => {
            // The server maps redeem failures to stable codes (see rpc.ts).
            throw new Error("expired_code");
          },
        },
      },
    );

    await slot.findByText("Get a connect code");
    fireEvent.change(slot.getByLabelText("Connect code"), {
      target: { value: "K7QP-2M4X" },
    });

    await slot.findByText(/That code has expired\./);
    slot.getByRole("link", { name: "Get a new code" });
    expect(slot.queryByText(/expired_code/)).toBeNull();
  });

  it("shows a remote-viewer count on the connected status line", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      { rpc: { status: () => connected({ remoteClients: 2 }) } },
    );
    await slot.findByText("Connected");
    await slot.findByText(/2 viewing remotely/);
  });

  it("reconnecting shows the amber state with the human transport error", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () =>
            connected({
              state: "reconnecting",
              lastError: "can't reach getbb.app — connection refused",
              nextRetryAt: null,
            }),
        },
      },
    );
    await slot.findByText("Reconnecting…");
    await slot.findByText(/can't reach getbb.app — connection refused/);
    await slot.findByText(/Local access is unaffected/);
    // The connected-only affordances are gone while the tunnel is down.
    expect(slot.queryByRole("button", { name: "Open" })).toBeNull();
  });

  it("revokes a shared port", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () =>
            connected({
              shares: [
                { port: 3000, url: "https://workstation--3000.getbb.app" },
              ],
            }),
          unexpose: () => ({ removed: true, port: 3000 }),
        },
      },
    );

    await slot.findByText(":3000");
    fireEvent.click(slot.getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "unexpose",
        input: { port: 3000 },
      }),
    );
  });

  it("exposes a port through the disclosure form and surfaces errors", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => connected({ shares: [] }),
          expose: () => {
            throw new Error("this bb is not connected to getbb.app");
          },
        },
      },
    );

    await slot.findByText("Shared ports");
    // The form is hidden until the disclosure is clicked.
    expect(slot.queryByLabelText("Port to share")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Expose a port" }));

    fireEvent.change(slot.getByLabelText("Port to share"), {
      target: { value: "8080" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Expose" }));

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "expose",
        input: { port: 8080 },
      }),
    );
    await slot.findByText(/this bb is not connected to getbb.app/);
  });

  it("disconnect confirms, then lands on the unpaired card with a receipt", async () => {
    let currentStatus = connected();
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => currentStatus,
          disconnect: () => {
            currentStatus = status();
            return currentStatus;
          },
        },
      },
    );

    await slot.findByText("Connected");
    fireEvent.click(slot.getByRole("button", { name: "Disconnect…" }));

    // The dialog names the concrete URL that will die.
    await slot.findByText("Disconnect remote access?");
    await slot.findByText(/will stop working on all devices/);
    fireEvent.click(slot.getByRole("button", { name: "Disconnect" }));

    await waitFor(() =>
      expect(slot.rpcCalls.some((call) => call.method === "disconnect")).toBe(
        true,
      ),
    );
    await slot.emitRealtime(CONNECT_REALTIME_CHANNEL, currentStatus);

    await slot.findByText("Get a connect code");
    await slot.findByText("Remote access disconnected");
  });
});
