// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { CONNECT_REALTIME_CHANNEL, type ConnectStatus } from "@/src/types";
import { SETUP_OPTION_ICON_OUTDENT_CLASS } from "@bb/shared-ui/setup-option-row";

const app = await loadPluginApp(() => import("./app"));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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
    slot.getByText(/Only your bb\.localhost:42745 account can open this bb/);
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

    const signIn = await slot.findByRole("button", {
      name: "Sign in to your bb account",
    });
    vi.useFakeTimers();
    await act(async () => fireEvent.click(signIn));
    expect(slot.getByText("K7QP-2M4X")).toBeTruthy();
    expect(account.calls[0]).toEqual({
      pluginId: "bb-account",
      method: "login.start",
      input: { baseUrl: null },
    });
    expect(
      slot.navigateCalls.filter((call) => call.method === "openUrl"),
    ).toEqual([]);
    slot.getByText("Confirm this code on getbb.app:");
    expect(slot.getByLabelText("Sign-in code").textContent).toBe("K7QP-2M4X");
    const link = slot.getByRole("link", {
      name: /Open getbb\.app/,
    }) as HTMLAnchorElement;
    expect(link.href).toBe("https://getbb.app/link?code=K7QP-2M4X");
    expect(link.target).toBe("_blank");
    slot.getByRole("button", { name: "Cancel" });
    slot.getByText(
      "Waiting for you to approve it. You can approve from any device.",
    );

    await act(async () => vi.advanceTimersByTimeAsync(1_999));
    expect(polls).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(polls).toBe(1);
    expect(slot.getByText("K7QP-2M4X")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(polls).toBe(2);
    currentStatus = connected();
    await slot.emitRealtime(CONNECT_REALTIME_CHANNEL, currentStatus);
    expect(slot.getByText("Connected")).toBeTruthy();
  });

  it("backs off the sign-in poll while bb account can't be reached", async () => {
    const account = fakeAccountSdk({
      "login.start": () => pendingLogin(),
      "login.poll": () => {
        throw Object.assign(new Error("HTTP 503: tunnel offline"), {
          status: 503,
        });
      },
    });
    const polls = () =>
      account.calls.filter((call) => call.method === "login.poll").length;
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: () => true,
        sdk: account.sdk,
        rpc: { status: () => status() },
      },
    );
    const signIn = await slot.findByRole("button", {
      name: "Sign in to your bb account",
    });
    vi.useFakeTimers();
    await act(async () => fireEvent.click(signIn));
    expect(slot.getByText("K7QP-2M4X")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(1_999));
    expect(polls()).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(polls()).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(3_999));
    expect(polls()).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(polls()).toBe(2);
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

  it("explains a saved pairing whose account hasn't loaded instead of calling the code invalid", async () => {
    const account = fakeAccountSdk({
      redeemCode: () => {
        throw new Error("HTTP 500: profile_unavailable");
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

    await slot.findByText(/hasn't returned your account yet/);
    expect(slot.queryByText(/invalid or has expired/)).toBeNull();
    expect(slot.queryByText(/profile_unavailable/)).toBeNull();
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

  it("groups shares by host and degrades an unreachable host's group", async () => {
    const reason = "sawyer-air is not connected right now.";
    const currentStatus = connected({
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
    });
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => currentStatus,
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

    const machine = slot.getByRole("button", {
      name: "Workstation, 2 shared ports",
    });
    fireEvent.click(machine);
    expect(machine.getAttribute("aria-expanded")).toBe("false");
    expect(
      slot.queryByRole("link", { name: "workstation--3000.getbb.app" }),
    ).toBeNull();
    expect(slot.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
    fireEvent.click(machine);
    expect(machine.getAttribute("aria-expanded")).toBe("true");

    const revokeButtons = slot.getAllByRole("button", { name: "Revoke" });
    expect(revokeButtons).toHaveLength(3);
    fireEvent.click(revokeButtons[0]!);
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "unexpose",
        input: { hostId: "host-air", port: 5173 },
      }),
    );

    const reachableRevoke = revokeButtons[1] as HTMLButtonElement;
    await waitFor(() => expect(reachableRevoke.disabled).toBe(false));
    fireEvent.click(reachableRevoke);
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "unexpose",
        input: { hostId: "host-server", port: 3000 },
      }),
    );
    await waitFor(() => expect(reachableRevoke.disabled).toBe(false));

    fireEvent.click(machine);
    await slot.emitRealtime(CONNECT_REALTIME_CHANNEL, {
      ...currentStatus,
      shares: currentStatus.shares.filter((share) => share.port !== 8080),
    });
    const updatedMachine = slot.getByRole("button", {
      name: "Workstation, 1 shared ports",
    });
    expect(updatedMachine.getAttribute("aria-expanded")).toBe("false");
    expect(
      slot.getByRole("button", {
        name: "Revoke all (1) shared ports on Workstation",
      }).textContent,
    ).toBe("Revoke all (1)");
    expect(
      slot.queryByRole("link", { name: "workstation--3000.getbb.app" }),
    ).toBeNull();
    fireEvent.click(updatedMachine);
    slot.getByRole("link", { name: "workstation--3000.getbb.app" });
    expect(slot.queryByText(":8080")).toBeNull();
  });

  it("blocks duplicate revocations while pending and allows retry after bulk failure", async () => {
    let rejectRevoke: (error: Error) => void = () => {};
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
          unexposeAll: () =>
            new Promise((_, reject) => {
              rejectRevoke = reject;
            }),
        },
      },
    );
    const revokeAll = await slot.findByRole("button", {
      name: "Revoke all (1) shared ports on Workstation",
    });
    fireEvent.click(revokeAll);
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "unexposeAll",
        input: { hostId: "host-server" },
      }),
    );
    expect(revokeAll.hasAttribute("disabled")).toBe(true);
    expect(
      slot.getByRole("button", { name: "Revoke" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(revokeAll);
    expect(
      slot.rpcCalls.filter((call) => call.method === "unexposeAll"),
    ).toHaveLength(1);
    rejectRevoke(new Error("Could not save shared ports"));
    await slot.findByText("Could not save shared ports");
    expect(revokeAll.hasAttribute("disabled")).toBe(false);
    fireEvent.click(revokeAll);
    await waitFor(() =>
      expect(
        slot.rpcCalls.filter((call) => call.method === "unexposeAll"),
      ).toHaveLength(2),
    );
    rejectRevoke(new Error("Could not save shared ports"));
    await slot.findByText("Could not save shared ports");
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

  it("only offers phone pairing while bb connect is connected", async () => {
    const slot = renderSlot(
      app.settingsSections[1]!,
      {},
      {
        rpc: { status: () => status() },
      },
    );
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({ method: "status", input: null }),
    );
    expect(
      slot.queryByRole("button", { name: "Add mobile device" }),
    ).toBeNull();
    await slot.emitRealtime(CONNECT_REALTIME_CHANNEL, connected());
    await slot.findByRole("button", { name: "Add mobile device" });
    await slot.emitRealtime(CONNECT_REALTIME_CHANNEL, {
      ...connected(),
      enabled: false,
    });
    expect(
      slot.queryByRole("button", { name: "Add mobile device" }),
    ).toBeNull();
    await slot.emitRealtime(CONNECT_REALTIME_CHANNEL, {
      ...connected(),
      state: "reconnecting",
    });
    expect(
      slot.queryByRole("button", { name: "Add mobile device" }),
    ).toBeNull();
  });

  it("add mobile device mints a machine code and shows the QR payload, the code, and a countdown", async () => {
    const expiresAt = Date.now() + 600_000;
    const slot = renderSlot(
      app.settingsSections[1]!,
      {},
      {
        rpc: {
          status: () => connected(),
          createMachineCode: () => ({
            code: "K7QP-2M4X",
            expiresAt,
            serverUrl: "https://workstation.getbb.app",
          }),
        },
      },
    );

    await slot.findByRole("button", { name: "Add mobile device" });
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
  });

  it("an expired mobile pairing code offers a fresh one", async () => {
    let minted = 0;
    const slot = renderSlot(
      app.settingsSections[1]!,
      {},
      {
        rpc: {
          status: () => connected(),
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

    const addMobileDevice = await slot.findByRole("button", {
      name: "Add mobile device",
    });
    vi.useFakeTimers();
    await act(async () => fireEvent.click(addMobileDevice));
    expect(slot.getByText("AAAA-1111")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(slot.queryByText("Code expired")).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(slot.getByText("Code expired")).toBeTruthy();
    expect(
      slot.queryByRole("button", { name: "Copy pairing code" }),
    ).toBeNull();
    await act(async () => {
      fireEvent.click(
        slot.getByRole("button", { name: "Generate a new code" }),
      );
    });
    expect(slot.getByText("BBBB-2222")).toBeTruthy();
    expect(slot.queryByText("AAAA-1111")).toBeNull();
    slot.getByText(/Code expires in/);
  });

  it("explains the account machine limit with a dashboard link", async () => {
    const slot = renderSlot(
      app.settingsSections[1]!,
      {},
      {
        rpc: {
          status: () => connected(),
          createMachineCode: () => {
            throw new Error("machine_limit");
          },
        },
      },
    );

    await slot.findByRole("button", { name: "Add mobile device" });
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

  it("reports setup started when sign-in starts, not when the section opens", async () => {
    const onSetupStarted = vi.fn();
    const account = fakeAccountSdk({
      "login.start": () => pendingLogin(),
      "login.poll": () => ({ login: pendingLogin(), status: signedInAccount }),
    });
    const slot = renderSlot(
      app.settingsSections[0]!,
      { internal_DO_NOT_USE_onSetupStarted: onSetupStarted },
      {
        openUrl: () => true,
        sdk: account.sdk,
        rpc: { status: () => status() },
      },
    );

    const signIn = await slot.findByRole("button", {
      name: "Sign in to your bb account",
    });
    expect(onSetupStarted).not.toHaveBeenCalled();
    fireEvent.click(signIn);
    await slot.findByText("K7QP-2M4X");
    expect(onSetupStarted).toHaveBeenCalledOnce();
  });

  it("reports setup started again when a failed sign-in is retried", async () => {
    const onSetupStarted = vi.fn();
    const account = fakeAccountSdk({
      "login.start": () => pendingLogin(),
      "login.poll": () => ({
        login: pendingLogin("denied"),
        status: signedInAccount,
      }),
    });
    const slot = renderSlot(
      app.settingsSections[0]!,
      { internal_DO_NOT_USE_onSetupStarted: onSetupStarted },
      {
        openUrl: () => true,
        sdk: account.sdk,
        rpc: { status: () => status() },
      },
    );

    fireEvent.click(
      await slot.findByRole("button", { name: "Sign in to your bb account" }),
    );
    const retry = await slot.findByRole(
      "button",
      { name: "Try again" },
      { timeout: 4_000 },
    );
    expect(onSetupStarted).toHaveBeenCalledOnce();
    fireEvent.click(retry);
    expect(onSetupStarted).toHaveBeenCalledTimes(2);
  });

  it("reports setup started when a pairing code is submitted or remote access is turned on", async () => {
    const onSetupStarted = vi.fn();
    const account = fakeAccountSdk({ redeemCode: () => signedInAccount });
    const unpaired = renderSlot(
      app.settingsSections[0]!,
      { internal_DO_NOT_USE_onSetupStarted: onSetupStarted },
      { sdk: account.sdk, rpc: { status: () => status() } },
    );
    fireEvent.click(
      await unpaired.findByRole("button", { name: "Have a pairing code?" }),
    );
    expect(onSetupStarted).not.toHaveBeenCalled();
    fireEvent.change(unpaired.getByLabelText("Pairing code"), {
      target: { value: "k7qp-2m4x" },
    });
    await waitFor(() => expect(onSetupStarted).toHaveBeenCalledOnce());
    cleanup();

    onSetupStarted.mockClear();
    const off = renderSlot(
      app.settingsSections[0]!,
      { internal_DO_NOT_USE_onSetupStarted: onSetupStarted },
      {
        rpc: {
          status: () => connected({ enabled: false, state: "disconnected" }),
          setRemoteAccess: () => connected({ state: "reconnecting" }),
        },
      },
    );
    const turnOn = await off.findByRole("button", { name: "Turn on" });
    expect(onSetupStarted).not.toHaveBeenCalled();
    fireEvent.click(turnOn);
    expect(onSetupStarted).toHaveBeenCalledOnce();
  });

  it("reports which setup stage failed when the setup guide renders the section", async () => {
    const onSetupFailed = vi.fn();
    const account = fakeAccountSdk({
      "login.start": () => {
        throw new Error("HTTP 500: profile_unavailable");
      },
      redeemCode: () => {
        throw new Error("HTTP 500: expired_code");
      },
    });
    const unpaired = renderSlot(
      app.settingsSections[0]!,
      { internal_DO_NOT_USE_onSetupFailed: onSetupFailed },
      { sdk: account.sdk, rpc: { status: () => status() } },
    );
    fireEvent.click(
      await unpaired.findByRole("button", {
        name: "Sign in to your bb account",
      }),
    );
    await waitFor(() =>
      expect(onSetupFailed).toHaveBeenCalledExactlyOnceWith("sign_in"),
    );
    fireEvent.click(
      unpaired.getByRole("button", { name: "Have a pairing code?" }),
    );
    fireEvent.change(unpaired.getByLabelText("Pairing code"), {
      target: { value: "k7qp-2m4x" },
    });
    await waitFor(() =>
      expect(onSetupFailed).toHaveBeenLastCalledWith("pairing"),
    );
    cleanup();

    onSetupFailed.mockClear();
    const off = renderSlot(
      app.settingsSections[0]!,
      { internal_DO_NOT_USE_onSetupFailed: onSetupFailed },
      {
        rpc: {
          status: () => connected({ enabled: false, state: "disconnected" }),
          setRemoteAccess: () => {
            throw new Error("Remote access is unavailable right now.");
          },
        },
      },
    );
    fireEvent.click(await off.findByRole("button", { name: "Turn on" }));
    await waitFor(() =>
      expect(onSetupFailed).toHaveBeenCalledExactlyOnceWith("turn_on"),
    );
  });
});

describe("Connect settings realtime recovery", () => {
  it("refreshes missed status changes after each realtime reconnect", async () => {
    let currentStatus = connected({ state: "reconnecting" });
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: { status: () => currentStatus },
      },
    );
    await slot.findByText("Reconnecting…");
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "status"),
    ).toHaveLength(1);

    await slot.behavior.setRealtimeConnectionState("reconnecting");
    currentStatus = connected();
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "status"),
    ).toHaveLength(1);
    await slot.behavior.setRealtimeConnectionState("connected");

    await slot.findByText("Connected");
    expect(slot.queryByText("Reconnecting…")).toBeNull();
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "status"),
    ).toHaveLength(2);

    await slot.behavior.setRealtimeConnectionState("reconnecting");
    currentStatus = connected({ state: "reconnecting" });
    await slot.behavior.setRealtimeConnectionState("connected");
    await slot.findByText("Reconnecting…");
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "status"),
    ).toHaveLength(3);
  });

  it("retries an initial failed status load when realtime connects", async () => {
    let reachable = false;
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        realtimeConnectionState: "connecting",
        rpc: {
          status: () => {
            if (!reachable) throw new Error("offline");
            return connected();
          },
        },
      },
    );
    await slot.findByText("Failed to load remote-access status: offline");

    reachable = true;
    await slot.behavior.setRealtimeConnectionState("connected");

    await slot.findByText("Connected");
    expect(slot.queryByText(/Failed to load/)).toBeNull();
  });

  it("keeps the reconnect status when the earlier load settles late", async () => {
    let failFirstLoad: (error: Error) => void = () => {};
    const firstLoad = new Promise<ConnectStatus>((_, reject) => {
      failFirstLoad = reject;
    });
    let calls = 0;
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        realtimeConnectionState: "connecting",
        rpc: {
          status: () => (++calls === 1 ? firstLoad : connected()),
        },
      },
    );

    await slot.behavior.setRealtimeConnectionState("connected");
    await slot.findByText("Connected");
    await act(async () => failFirstLoad(new Error("tunnel dropped")));

    expect(slot.queryByText(/Failed to load/)).toBeNull();
    expect(slot.getByText("Connected")).toBeTruthy();
  });
});

describe("connect setup guide section", () => {
  const section = () => app.setupGuideSections[0]!;
  const openPairingStep = async (slot: {
    findByRole: (
      role: string,
      options: { name: string },
    ) => Promise<HTMLElement>;
  }) =>
    fireEvent.click(
      await slot.findByRole("button", { name: "I have the app" }),
    );

  it("offers only Set up while bb connect is off", async () => {
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted: () => {}, onSetupFailed: () => {} },
      { rpc: { status: () => status() } },
    );

    await slot.findByRole("button", { name: "Set up" });
    slot.getByText(/A private web address for your bb server/);
    expect(
      slot.queryByRole("button", { name: "Have a pairing code?" }),
    ).toBeNull();
    expect(slot.queryByText("Install the bb app on your phone:")).toBeNull();
    expect(slot.queryByRole("button", { name: "iPhone" })).toBeNull();
    expect(slot.rpcCalls.map((call) => call.method)).not.toContain(
      "createMachineCode",
    );
  });

  it("starts sign-in from Set up, opens getbb.app, and shows only the getbb.app link without a code or a Cancel", async () => {
    const onSetupStarted = vi.fn();
    const account = fakeAccountSdk({
      "login.start": () => pendingLogin(),
      "login.poll": () => ({ login: pendingLogin(), status: signedInAccount }),
    });
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted, onSetupFailed: () => {} },
      {
        openUrl: () => true,
        sdk: account.sdk,
        rpc: { status: () => status() },
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: "Set up" }));
    await slot.findByRole("link", { name: "getbb.app" });
    expect(onSetupStarted).toHaveBeenCalledOnce();
    expect(slot.navigateCalls).toContainEqual({
      method: "openUrl",
      url: "https://getbb.app/link?code=K7QP-2M4X",
    });
    expect(
      slot.queryByText("bb connect turns on automatically after you sign in."),
    ).toBeNull();
    expect(
      slot.getByText(/Finish signing in on/u).closest("[role=status]"),
    ).not.toBeNull();
    expect(
      (slot.getByRole("link", { name: "getbb.app" }) as HTMLAnchorElement).href,
    ).toBe("https://getbb.app/link?code=K7QP-2M4X");
    expect(slot.queryByText("K7QP-2M4X")).toBeNull();
    expect(slot.queryByText(/sign-in code/iu)).toBeNull();
    expect(slot.queryByRole("button", { name: /copy/iu })).toBeNull();
    expect(slot.queryByRole("button", { name: "Set up" })).toBeNull();
    expect(slot.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(
      slot
        .getByRole("button", { name: "Have a pairing code?" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(slot.queryByLabelText("Pairing code")).toBeNull();
  });

  it("keeps the sign-in code behind Show pairing code, one footer panel open at a time", async () => {
    const account = fakeAccountSdk({
      "login.start": () => pendingLogin(),
      "login.poll": () => ({ login: pendingLogin(), status: signedInAccount }),
    });
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted: () => {}, onSetupFailed: () => {} },
      {
        openUrl: () => true,
        sdk: account.sdk,
        rpc: { status: () => status() },
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: "Set up" }));
    const showCode = await slot.findByRole("button", {
      name: "Show pairing code",
    });
    const havePairingCode = slot.getByRole("button", {
      name: "Have a pairing code?",
    });
    expect(showCode.getAttribute("aria-expanded")).toBe("false");
    expect(slot.queryByText("K7QP-2M4X")).toBeNull();

    fireEvent.click(showCode);
    expect(showCode.getAttribute("aria-expanded")).toBe("true");
    expect(slot.getByLabelText("bb connect sign-in code").textContent).toBe(
      "K7QP-2M4X",
    );
    slot.getByRole("button", { name: "Copy code" });
    expect(slot.queryByLabelText("Pairing code")).toBeNull();

    fireEvent.click(havePairingCode);
    expect(havePairingCode.getAttribute("aria-expanded")).toBe("true");
    expect(showCode.getAttribute("aria-expanded")).toBe("false");
    expect(slot.queryByText("K7QP-2M4X")).toBeNull();
    slot.getByLabelText("Pairing code");

    fireEvent.click(showCode);
    expect(havePairingCode.getAttribute("aria-expanded")).toBe("false");
    expect(slot.queryByLabelText("Pairing code")).toBeNull();
    slot.getByLabelText("bb connect sign-in code");

    fireEvent.click(showCode);
    expect(slot.queryByText("K7QP-2M4X")).toBeNull();
  });

  it("pairs with a code while sign-in is pending, cancels that sign-in, and shows bb connect is on", async () => {
    const onSetupStarted = vi.fn();
    const account = fakeAccountSdk({
      "login.start": () => pendingLogin(),
      "login.poll": () => ({ login: pendingLogin(), status: signedInAccount }),
      "login.cancel": () => ({
        login: pendingLogin("cancelled", "Sign-in was cancelled."),
      }),
      redeemCode: () => signedInAccount,
    });
    let currentStatus = status();
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted, onSetupFailed: () => {} },
      {
        openUrl: () => true,
        sdk: account.sdk,
        rpc: { status: () => currentStatus },
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: "Set up" }));
    const toggle = await slot.findByRole("button", {
      name: "Have a pairing code?",
    });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    currentStatus = connected();
    fireEvent.change(slot.getByLabelText("Pairing code"), {
      target: { value: "k7qp-2m4x" },
    });

    await waitFor(() =>
      expect(account.calls).toContainEqual({
        pluginId: "bb-account",
        method: "redeemCode",
        input: { code: "K7QP-2M4X", baseUrl: null },
      }),
    );
    expect(onSetupStarted).toHaveBeenCalledTimes(2);
    await slot.findByText("bb connect is on");
    expect(account.calls).toContainEqual({
      pluginId: "bb-account",
      method: "login.cancel",
      input: { loginId: "login-1" },
    });
    expect(
      slot.queryByRole("button", { name: "Have a pairing code?" }),
    ).toBeNull();
  });

  it("turns bb connect on after pairing with a code when it was off, without showing Set up in between", async () => {
    const account = fakeAccountSdk({
      "login.start": () => pendingLogin(),
      "login.poll": () => ({ login: pendingLogin(), status: signedInAccount }),
      "login.cancel": () => ({
        login: pendingLogin("cancelled", "Sign-in was cancelled."),
      }),
      redeemCode: () => signedInAccount,
    });
    let statusAfterPairing: ((value: ConnectStatus) => void) | null = null;
    let currentStatus: () => ConnectStatus | Promise<ConnectStatus> = () =>
      status();
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted: () => {}, onSetupFailed: () => {} },
      {
        openUrl: () => true,
        sdk: account.sdk,
        rpc: {
          status: () => currentStatus(),
          setRemoteAccess: (input: unknown) => {
            expect(input).toEqual({ enabled: true });
            currentStatus = () => connected();
            return connected();
          },
        },
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: "Set up" }));
    fireEvent.click(
      await slot.findByRole("button", { name: "Have a pairing code?" }),
    );
    currentStatus = () =>
      new Promise<ConnectStatus>((resolve) => {
        statusAfterPairing = resolve;
      });
    fireEvent.change(slot.getByLabelText("Pairing code"), {
      target: { value: "k7qp-2m4x" },
    });

    await slot.findByText("Signed in. Turning on bb connect…");
    expect(slot.queryByRole("button", { name: "Set up" })).toBeNull();
    expect(slot.queryByText(/Finish signing in on/u)).toBeNull();
    expect(slot.queryByText(/cancelled/u)).toBeNull();
    expect(
      slot.queryByRole("button", { name: "Have a pairing code?" }),
    ).toBeNull();

    await waitFor(() => expect(statusAfterPairing).not.toBeNull());
    await act(async () => {
      statusAfterPairing?.(status({ paired: true, enabled: false }));
    });
    await slot.findByText("bb connect is on");
    expect(
      slot.rpcCalls.filter((call) => call.method === "setRemoteAccess"),
    ).toHaveLength(1);
    expect(slot.queryByRole("button", { name: "Set up" })).toBeNull();
  });

  it("reports a rejected pairing code as a pairing failure and keeps the pending sign-in", async () => {
    const onSetupStarted = vi.fn();
    const onSetupFailed = vi.fn();
    const account = fakeAccountSdk({
      "login.start": () => pendingLogin(),
      "login.poll": () => ({ login: pendingLogin(), status: signedInAccount }),
      redeemCode: () => {
        throw new Error("HTTP 500: expired_code");
      },
    });
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted, onSetupFailed },
      {
        openUrl: () => true,
        sdk: account.sdk,
        rpc: { status: () => status() },
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: "Set up" }));
    fireEvent.click(
      await slot.findByRole("button", { name: "Have a pairing code?" }),
    );
    fireEvent.change(slot.getByLabelText("Pairing code"), {
      target: { value: "k7qp-2m4x" },
    });

    await waitFor(() =>
      expect(onSetupFailed).toHaveBeenCalledExactlyOnceWith("pairing"),
    );
    expect(onSetupStarted).toHaveBeenCalledTimes(2);
    await slot.findByText(/That code has expired\./u);
    slot.getByText(/Finish signing in on/u);
    expect(
      slot.getByLabelText("Pairing code").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(account.calls.map((call) => call.method)).not.toContain(
      "login.cancel",
    );
  });

  it("turns bb connect on after signing in when it was turned off before", async () => {
    let signedIn = false;
    let currentStatus = status({ paired: false, enabled: false });
    const account = fakeAccountSdk({
      "login.start": () => pendingLogin(),
      "login.poll": () => {
        signedIn = true;
        currentStatus = status({ paired: true, enabled: false });
        return { login: pendingLogin("signed-in"), status: signedInAccount };
      },
    });
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted: () => {}, onSetupFailed: () => {} },
      {
        openUrl: () => true,
        sdk: account.sdk,
        rpc: {
          status: () => currentStatus,
          setRemoteAccess: (input: unknown) => {
            expect(signedIn).toBe(true);
            expect(input).toEqual({ enabled: true });
            currentStatus = connected();
            return currentStatus;
          },
        },
      },
    );

    const setUp = await slot.findByRole("button", { name: "Set up" });
    await waitFor(() =>
      expect(slot.rpcCalls.map((call) => call.method)).toContain("status"),
    );
    await act(async () => {});
    vi.useFakeTimers();
    await act(async () => fireEvent.click(setUp));
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(slot.getByText("bb connect is on")).toBeTruthy();
    expect(
      slot.rpcCalls.filter((call) => call.method === "setRemoteAccess"),
    ).toHaveLength(1);
  });

  it("shows why bb connect couldn't turn on after signing in", async () => {
    const onSetupFailed = vi.fn();
    let currentStatus = status({ paired: false, enabled: false });
    const account = fakeAccountSdk({
      "login.start": () => pendingLogin(),
      "login.poll": () => {
        currentStatus = status({ paired: true, enabled: false });
        return { login: pendingLogin("signed-in"), status: signedInAccount };
      },
    });
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted: () => {}, onSetupFailed },
      {
        openUrl: () => true,
        sdk: account.sdk,
        rpc: {
          status: () => currentStatus,
          setRemoteAccess: () => {
            throw new Error("Remote access is unavailable right now.");
          },
        },
      },
    );

    const setUp = await slot.findByRole("button", { name: "Set up" });
    await waitFor(() =>
      expect(slot.rpcCalls.map((call) => call.method)).toContain("status"),
    );
    await act(async () => {});
    vi.useFakeTimers();
    await act(async () => fireEvent.click(setUp));
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(
      slot.getByText(/Remote access is unavailable right now/u),
    ).toBeTruthy();
    expect(slot.queryByText(/Turning on bb connect/u)).toBeNull();
    slot.getByRole("button", { name: "Set up" });
    expect(onSetupFailed).toHaveBeenCalledExactlyOnceWith("turn_on");
  });

  it("reports a sign-in that could not start or was denied as a sign-in failure", async () => {
    const onSetupFailed = vi.fn();
    let resolveStatus: (value: ConnectStatus) => void = () => {};
    const initialStatus = new Promise<ConnectStatus>((resolve) => {
      resolveStatus = resolve;
    });
    let startFails = true;
    const account = fakeAccountSdk({
      "login.start": () => {
        if (startFails) throw new Error("HTTP 500: profile_unavailable");
        return pendingLogin();
      },
      "login.poll": () => ({
        login: pendingLogin("denied"),
        status: signedInAccount,
      }),
    });
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted: () => {}, onSetupFailed },
      {
        openUrl: () => true,
        sdk: account.sdk,
        rpc: { status: () => initialStatus },
      },
    );

    await act(async () => resolveStatus(status()));
    vi.useFakeTimers();
    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Set up" })),
    );
    expect(onSetupFailed).toHaveBeenCalledExactlyOnceWith("sign_in");
    startFails = false;
    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Set up" })),
    );
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(onSetupFailed).toHaveBeenCalledTimes(2);
    expect(onSetupFailed).toHaveBeenLastCalledWith("sign_in");
  });

  it("turns remote access back on when this bb is already signed in", async () => {
    let currentStatus = status({ paired: true, enabled: false });
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted: () => {}, onSetupFailed: () => {} },
      {
        rpc: {
          status: () => currentStatus,
          setRemoteAccess: (input: unknown) => {
            currentStatus = connected();
            expect(input).toEqual({ enabled: true });
            return currentStatus;
          },
        },
      },
    );

    const setUp = await slot.findByRole("button", { name: "Set up" });
    await waitFor(() =>
      expect(slot.rpcCalls.map((call) => call.method)).toContain("status"),
    );
    await act(async () => {});
    fireEvent.click(setUp);
    await slot.findByText("bb connect is on");
    slot.getByText("https://workstation.getbb.app");
  });

  it("keeps the bb connect row once it is on, with the check under its icon and no bb cloud line", async () => {
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted: () => {}, onSetupFailed: () => {} },
      { rpc: { status: () => connected() } },
    );

    const on = await slot.findByText("bb connect is on");
    slot.getByText("bb connect");
    slot.getByText("https://workstation.getbb.app");
    const check = on
      .closest("div")
      ?.querySelector('[data-icon="CircleCheck"]')?.parentElement;
    expect(check?.className).toContain(SETUP_OPTION_ICON_OUTDENT_CLASS);
    expect(slot.queryByText(/bb cloud/iu)).toBeNull();
    expect(slot.queryByText(/remote access/iu)).toBeNull();
    slot.getByText("Install the bb app on your phone:");
    for (const name of ["iPhone", "Android", "I have the app"]) {
      slot.getByRole("button", { name });
    }
    expect(slot.queryByRole("img")).toBeNull();
  });

  it("starts on the install step with no QR, pairs on the next step, then shows only Phone paired", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let consumed = false;
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted: () => {}, onSetupFailed: () => {} },
      {
        rpc: {
          status: () => connected(),
          createMachineCode: () => ({
            code: "PAIR-CODE",
            expiresAt: Date.now() + 600_000,
            serverUrl: "https://workstation.getbb.app",
          }),
          lookupMachineCode: () => ({
            consumed,
            machineId: consumed ? "machine-1" : null,
          }),
        },
      },
    );

    await slot.findByText("Install the bb app on your phone:");
    expect(slot.queryByText("Open the bb app and scan this code:")).toBeNull();
    expect(slot.queryByRole("img")).toBeNull();
    expect(slot.queryByRole("button", { name: "Set up" })).toBeNull();
    expect(slot.rpcCalls.map((call) => call.method)).not.toContain(
      "createMachineCode",
    );
    await openPairingStep(slot);
    await slot.findByText("PAIR-CODE");
    slot.getByText("Open the bb app and scan this code:");
    expect(slot.queryByText("Install the bb app on your phone:")).toBeNull();
    await slot.findByRole("img", { name: "QR code to pair the bb mobile app" });

    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(slot.rpcCalls).toContainEqual({
      method: "lookupMachineCode",
      input: { code: "PAIR-CODE" },
    });
    expect(slot.getByText("PAIR-CODE")).toBeTruthy();

    consumed = true;
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(slot.getByText("Phone paired")).toBeTruthy();
    expect(slot.queryByText("PAIR-CODE")).toBeNull();
    expect(slot.queryByText("Install the bb app on your phone:")).toBeNull();
    expect(slot.queryByText("Open the bb app and scan this code:")).toBeNull();
  });

  it("re-mints the pairing code before it expires", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let minted = 0;
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted: () => {}, onSetupFailed: () => {} },
      {
        rpc: {
          status: () => connected(),
          createMachineCode: () => {
            minted += 1;
            return {
              code: minted === 1 ? "AAAA-1111" : "BBBB-2222",
              expiresAt: Date.now() + 60_000,
              serverUrl: "https://workstation.getbb.app",
            };
          },
          lookupMachineCode: () => ({ consumed: false, machineId: null }),
        },
      },
    );

    await openPairingStep(slot);
    await slot.findByText("AAAA-1111");
    await act(async () => vi.advanceTimersByTimeAsync(46_000));
    expect(slot.getByText("BBBB-2222")).toBeTruthy();
    expect(slot.queryByText(/expire/i)).toBeNull();
  });

  it("waits between re-mints when the host's clock says the code already expired", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let minted = 0;
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted: () => {}, onSetupFailed: () => {} },
      {
        rpc: {
          status: () => connected(),
          createMachineCode: () => {
            minted += 1;
            return {
              code: `CODE-000${minted}`,
              expiresAt: Date.now() - 60_000,
              serverUrl: "https://workstation.getbb.app",
            };
          },
          lookupMachineCode: () => ({ consumed: false, machineId: null }),
        },
      },
    );

    await openPairingStep(slot);
    await slot.findByText("CODE-0001");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(minted).toBe(1);
  });

  it("shows one store QR at a time, then only the pairing code, and can go back", async () => {
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted: () => {}, onSetupFailed: () => {} },
      {
        rpc: {
          status: () => connected(),
          createMachineCode: () => ({
            code: "PAIR-CODE",
            expiresAt: Date.now() + 600_000,
            serverUrl: "https://workstation.getbb.app",
          }),
          lookupMachineCode: () => ({ consumed: false, machineId: null }),
        },
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: "Android" }));
    await slot.findByRole("img", { name: "QR code to install bb on Android" });
    slot.getByText("Scan with your phone's camera.");
    fireEvent.click(slot.getByRole("button", { name: "iPhone" }));
    await slot.findByRole("img", { name: "QR code to install bb on iPhone" });
    expect(slot.getAllByRole("img")).toHaveLength(1);
    fireEvent.click(slot.getByRole("button", { name: "Copy install link" }));
    await waitFor(() =>
      expect(slot.experimental_clipboardWrites).toContainEqual({
        text: "https://testflight.apple.com/join/T9MayTMb",
      }),
    );

    await openPairingStep(slot);
    await slot.findByRole("img", { name: "QR code to pair the bb mobile app" });
    expect(slot.getAllByRole("img")).toHaveLength(1);
    slot.getByText("PAIR-CODE");

    fireEvent.click(
      slot.getByRole("button", { name: "Don't have the app yet?" }),
    );
    slot.getByText("Install the bb app on your phone:");
    expect(slot.queryByText("PAIR-CODE")).toBeNull();
    expect(slot.queryByRole("img")).toBeNull();
  });

  it("explains the device limit inline", async () => {
    const slot = renderSlot(
      section(),
      { onPhone: false, onSetupStarted: () => {}, onSetupFailed: () => {} },
      {
        rpc: {
          status: () => connected(),
          createMachineCode: () => {
            throw new Error("machine_limit");
          },
        },
      },
    );

    await openPairingStep(slot);
    await slot.findByText(/reached its device limit/);
    expect(slot.queryByText("machine_limit")).toBeNull();
  });

  it("hides the pairing steps on a phone", async () => {
    const slot = renderSlot(
      section(),
      { onPhone: true, onSetupStarted: () => {}, onSetupFailed: () => {} },
      { rpc: { status: () => connected() } },
    );

    await slot.findByText("bb connect is on");
    expect(slot.queryByText("Install the bb app on your phone:")).toBeNull();
    expect(slot.rpcCalls.map((call) => call.method)).not.toContain(
      "createMachineCode",
    );
  });
});
