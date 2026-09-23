// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
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
    enabled: true,
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

interface AccountRpcCall {
  pluginId: string;
  method: string;
  input?: unknown;
  outputSchema: { parse(value: unknown): unknown };
}

function fakeAccountSdk(handlers: Record<string, (input: unknown) => unknown>) {
  const calls: Array<{ pluginId: string; method: string; input: unknown }> = [];
  const callRpc = vi.fn(async (args: AccountRpcCall) => {
    calls.push({
      pluginId: args.pluginId,
      method: args.method,
      input: args.input,
    });
    const handler = handlers[args.method];
    if (handler === undefined) throw new Error(`no handler ${args.method}`);
    return args.outputSchema.parse(await handler(args.input));
  });
  return { calls, sdk: { plugins: { callRpc: callRpc as never } } };
}

const signedInAccount = {
  state: "signed-in",
  revision: 2,
  account: {
    userId: "usr_1",
    githubLogin: "sawyerhood",
    name: "Sawyer Hood",
    avatarUrl: null,
    handle: "sawyer",
    serverId: "srv_1",
    serverLabel: "workstation",
    serverUrl: "https://workstation.getbb.app",
    baseUrl: "https://getbb.app",
  },
};

function pendingLogin(state = "pending", message: string | null = null) {
  return {
    id: "login-1",
    state,
    userCode: "K7QP-2M4X",
    verificationUrl: "https://getbb.app/link?code=K7QP-2M4X",
    expiresAt: Date.now() + 600_000,
    message,
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
  it("uses the plugin page header instead of declaring a second title", () => {
    expect(app.settingsSections[0]?.title).toBeUndefined();
  });

  it("asks to sign in to the bb account and names the local Cloud host", async () => {
    const dashboardUrl = "http://bb.localhost:42745/dashboard";
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: () => true,
        rpc: { status: () => status({ dashboardUrl }) },
      },
    );

    await slot.findByRole("button", { name: "Sign in to your bb account" });
    slot.getByText("you.bb.localhost:42745");
    slot.getByText(/your bb\.localhost:42745 account gets full control/);
  });

  it("signs in through bb account, shows the code, and waits for approval", async () => {
    let polls = 0;
    const account = fakeAccountSdk({
      "login.start": () => pendingLogin(),
      "login.poll": () => {
        polls += 1;
        return {
          login: pendingLogin(polls > 1 ? "signed-in" : "pending"),
          status: signedInAccount,
        };
      },
    });
    let currentStatus = status();
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: () => true,
        sdk: account.sdk,
        rpc: { status: () => currentStatus },
      },
    );

    fireEvent.click(
      await slot.findByRole("button", { name: "Sign in to your bb account" }),
    );
    await slot.findByText("K7QP-2M4X");
    expect(account.calls[0]).toEqual({
      pluginId: "bb-account",
      method: "login.start",
      input: { baseUrl: null },
    });
    const link = slot.getByRole("link", {
      name: /Open getbb\.app/,
    }) as HTMLAnchorElement;
    expect(link.href).toBe("https://getbb.app/link?code=K7QP-2M4X");
    expect(link.target).toBe("_blank");

    await waitFor(
      () =>
        expect(
          account.calls.filter((call) => call.method === "login.poll"),
        ).toHaveLength(2),
      { timeout: 6_000 },
    );
    currentStatus = connected();
    await slot.emitRealtime(CONNECT_REALTIME_CHANNEL, currentStatus);
    await slot.findByText("Connected");
  });

  it("explains when the bb account plugin is off", async () => {
    const account = fakeAccountSdk({
      "login.start": () => {
        throw Object.assign(new Error("HTTP 503: not running"), {
          status: 503,
        });
      },
    });
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      { sdk: account.sdk, rpc: { status: () => status() } },
    );
    fireEvent.click(
      await slot.findByRole("button", { name: "Sign in to your bb account" }),
    );
    await slot.findByText(/The bb account plugin is off/);
  });

  it("auto-submits a normalized 4-4 pairing code through bb account and applies live paired status", async () => {
    const account = fakeAccountSdk({ redeemCode: () => signedInAccount });
    let currentStatus = status();
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        sdk: account.sdk,
        rpc: { status: () => currentStatus },
      },
    );

    fireEvent.click(
      await slot.findByRole("button", { name: "Have a pairing code?" }),
    );
    fireEvent.change(slot.getByLabelText("Pairing code"), {
      target: { value: "  k7qp-2m4x  " },
    });

    await waitFor(() =>
      expect(account.calls).toContainEqual({
        pluginId: "bb-account",
        method: "redeemCode",
        input: { code: "K7QP-2M4X", baseUrl: null },
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
    const account = fakeAccountSdk({ redeemCode: () => signedInAccount });
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      { sdk: account.sdk, rpc: { status: () => status() } },
    );
    fireEvent.click(
      await slot.findByRole("button", { name: "Have a pairing code?" }),
    );
    fireEvent.change(slot.getByLabelText("Pairing code"), {
      target: { value: "K7QP-2M4" },
    });
    expect(
      (slot.getByRole("button", { name: "Pair" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(account.calls).toEqual([]);
  });

  it("maps a typed pair error code to human copy, never wire text", async () => {
    const account = fakeAccountSdk({
      redeemCode: () => {
        throw new Error("HTTP 500: expired_code");
      },
    });
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      { sdk: account.sdk, rpc: { status: () => status() } },
    );

    fireEvent.click(
      await slot.findByRole("button", { name: "Have a pairing code?" }),
    );
    fireEvent.change(slot.getByLabelText("Pairing code"), {
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
                {
                  hostId: "host-server",
                  hostName: "Workstation",
                  port: 3000,
                  createdAt: 1,
                  url: "https://workstation--3000.getbb.app",
                },
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
        input: { hostId: "host-server", port: 3000 },
      }),
    );
  });

  it("renders an unavailable share reason and keeps it revocable", async () => {
    const reason = "This host is not connected right now.";
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () =>
            connected({
              shares: [
                {
                  hostId: "host-air",
                  hostName: "Sawyer Air",
                  port: 3000,
                  createdAt: 1,
                  url: "",
                  unavailableReason: reason,
                },
              ],
            }),
          unexpose: () => ({ removed: true, port: 3000 }),
        },
      },
    );

    await slot.findByText(`Unavailable — ${reason}`);
    expect(
      slot.queryByRole("button", { name: "Copy share URL for port 3000" }),
    ).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "unexpose",
        input: { hostId: "host-air", port: 3000 },
      }),
    );
  });

  it("groups shares by host and degrades an unreachable host's group", async () => {
    const reason = "sawyer-air is not connected right now.";
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () =>
            connected({
              shares: [
                {
                  hostId: "host-air",
                  hostName: "Sawyer Air",
                  port: 5173,
                  createdAt: 1,
                  url: "",
                  unavailableReason: reason,
                },
                {
                  hostId: "host-server",
                  hostName: "Workstation",
                  port: 3000,
                  createdAt: 2,
                  url: "https://workstation--3000.getbb.app",
                },
                {
                  hostId: "host-server",
                  hostName: "Workstation",
                  port: 8080,
                  createdAt: 3,
                  url: "https://workstation--8080.getbb.app",
                },
              ],
            }),
          unexpose: () => ({ removed: true, port: 5173 }),
        },
      },
    );

    await slot.findByText("Sawyer Air");
    expect(slot.getAllByText("Workstation")).toHaveLength(1);

    expect(
      slot
        .getByText("workstation--3000.getbb.app")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("https://workstation--3000.getbb.app");
    slot.getByText(`Unavailable — ${reason}`);
    expect(
      slot.queryByRole("button", { name: "Copy share URL for port 5173" }),
    ).toBeNull();

    const revokeButtons = slot.getAllByRole("button", { name: "Revoke" });
    expect(revokeButtons).toHaveLength(3);
    fireEvent.click(revokeButtons[0]!);
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "unexpose",
        input: { hostId: "host-air", port: 5173 },
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

  it("hides mobile pairing unless the mobileApp experiment is on", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => connected(),
          mobilePairing: () => ({ enabled: false }),
        },
      },
    );

    await slot.findByText("Connected");
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "mobilePairing",
        input: null,
      }),
    );
    expect(slot.queryByText("Mobile app")).toBeNull();
    expect(
      slot.queryByRole("button", { name: "Add mobile device" }),
    ).toBeNull();
    expect(slot.queryByRole("button", { name: "Re-pair" })).toBeNull();
  });

  it("add mobile device mints a machine code and shows the QR payload, the code, and a countdown", async () => {
    const expiresAt = Date.now() + 600_000;
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => connected(),
          mobilePairing: () => ({ enabled: true }),
          createMachineCode: () => ({
            code: "K7QP-2M4X",
            expiresAt,
            serverUrl: "https://workstation.getbb.app",
          }),
        },
      },
    );

    await slot.findByText("Connected");
    expect(slot.queryByText("K7QP-2M4X")).toBeNull();
    fireEvent.click(
      await slot.findByRole("button", { name: "Add mobile device" }),
    );

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "createMachineCode",
        input: null,
      }),
    );
    await slot.findByText("K7QP-2M4X");
    slot.getByRole("button", { name: "Copy pairing code" });
    slot.getByText(/Code expires in 9:5\d/);
    const qr = (await slot.findByRole("img", {
      name: "QR code to pair the bb mobile app",
    })) as HTMLImageElement;
    expect(qr.src.startsWith("data:image/png")).toBe(true);
    slot.getByText(/bb connect machine-code/);
  });

  it("an expired mobile pairing code offers a fresh one", async () => {
    let minted = 0;
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => connected(),
          mobilePairing: () => ({ enabled: true }),
          createMachineCode: () => {
            minted += 1;
            return {
              code: minted === 1 ? "AAAA-1111" : "BBBB-2222",
              expiresAt: Date.now() + (minted === 1 ? 1_200 : 600_000),
              serverUrl: "https://workstation.getbb.app",
            };
          },
        },
      },
    );

    await slot.findByText("Connected");
    fireEvent.click(
      await slot.findByRole("button", { name: "Add mobile device" }),
    );
    await slot.findByText("AAAA-1111");

    await slot.findByText("Code expired", undefined, { timeout: 4_000 });
    expect(
      slot.queryByRole("button", { name: "Copy pairing code" }),
    ).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Generate a new code" }));

    await slot.findByText("BBBB-2222");
    expect(slot.queryByText("AAAA-1111")).toBeNull();
    slot.getByText(/Code expires in/);
  });

  it("explains the account machine limit with a dashboard link", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => connected(),
          mobilePairing: () => ({ enabled: true }),
          createMachineCode: () => {
            throw new Error("machine_limit");
          },
        },
      },
    );

    await slot.findByText("Connected");
    fireEvent.click(
      await slot.findByRole("button", { name: "Add mobile device" }),
    );

    await slot.findByText(/reached its machine limit/);
    const link = slot.getByRole("link", {
      name: "Revoke a device you no longer use",
    }) as HTMLAnchorElement;
    expect(link.href).toBe("https://getbb.app/dashboard");
    expect(slot.queryByText("machine_limit")).toBeNull();
    slot.getByRole("button", { name: "Add mobile device" });
  });

  it("turn off confirms, keeps the account, and shows the off card with a receipt", async () => {
    let currentStatus = connected();
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => currentStatus,
          setRemoteAccess: (input: unknown) => {
            const enabled = (input as { enabled: boolean }).enabled;
            currentStatus = connected({
              enabled,
              state: enabled ? "reconnecting" : "disconnected",
            });
            return currentStatus;
          },
        },
      },
    );

    await slot.findByText("Connected");
    fireEvent.click(slot.getByRole("button", { name: "Turn off" }));

    await slot.findByText("Turn off remote access?");
    await slot.findByText(/stays signed in to your bb account/);
    fireEvent.click(slot.getAllByRole("button", { name: "Turn off" }).at(-1)!);

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "setRemoteAccess",
        input: { enabled: false },
      }),
    );
    await slot.emitRealtime(CONNECT_REALTIME_CHANNEL, currentStatus);

    await slot.findByText("Remote access is off");
    await slot.findByText("Remote access turned off");
    fireEvent.click(slot.getByRole("button", { name: "Turn on" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "setRemoteAccess",
        input: { enabled: true },
      }),
    );
  });
});
