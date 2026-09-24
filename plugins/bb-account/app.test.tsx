// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  ACCOUNT_REALTIME_CHANNEL,
  type AccountStatus,
  type LoginView,
} from "@/src/schemas";

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

const signedOut: AccountStatus = {
  state: "signed-out",
  revision: 3,
  account: null,
};

const signedIn: AccountStatus = {
  state: "signed-in",
  revision: 4,
  account: {
    userId: "usr_1",
    githubLogin: "sawyerhood",
    name: "Sawyer Hood",
    avatarUrl: null,
    handle: "sawyer",
    serverId: "srv_1",
    serverLabel: "sawyer-desktop",
    serverUrl: "https://sawyer-desktop.getbb.app",
    baseUrl: "https://getbb.app",
  },
};

function pendingLogin(overrides: Partial<LoginView> = {}): LoginView {
  return {
    id: "login-1",
    state: "pending",
    userCode: "K7QP-2M4X",
    verificationUrl: "https://getbb.app/link?code=K7QP-2M4X",
    expiresAt: Date.now() + 600_000,
    message: null,
    ...overrides,
  };
}

describe("bb account settings section", () => {
  it("shows the signed-in account and signs out after confirming", async () => {
    let current: AccountStatus = signedIn;
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          "login.poll": () => ({ login: null, status: current }),
          signOut: () => {
            current = { ...signedOut, revision: 5 };
            return { revocation: "revoked", status: current };
          },
        },
      },
    );

    await slot.findByText("Sawyer Hood");
    slot.getByText("@sawyerhood on GitHub");
    slot.getByText("sawyer");
    slot.getByText("sawyer-desktop");
    slot.getByText(/sawyer-desktop\.getbb\.app/);

    fireEvent.click(slot.getByRole("button", { name: "Sign out" }));
    await slot.findByText("Sign out of your bb account?");
    const confirm = slot.getAllByRole("button", { name: "Sign out" }).at(-1)!;
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(slot.rpcCalls.some((call) => call.method === "signOut")).toBe(
        true,
      ),
    );
    await slot.findByRole("button", { name: "Sign in" });
    expect(slot.queryByText(/didn't confirm/)).toBeNull();
  });

  it("says so when getbb.app didn't confirm the sign-out", async () => {
    let current: AccountStatus = signedIn;
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          "login.poll": () => ({ login: null, status: current }),
          signOut: () => {
            current = { ...signedOut, revision: 5 };
            return {
              revocation: "failed",
              status: current,
              message: "couldn't reach sawyer-desktop.getbb.app",
              dashboardUrl: "https://getbb.app/dashboard",
            };
          },
        },
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: "Sign out" }));
    await slot.findByText("Sign out of your bb account?");
    fireEvent.click(slot.getAllByRole("button", { name: "Sign out" }).at(-1)!);

    await slot.findByText(/didn't confirm it revoked this server/);
    expect(
      slot.getByRole("link", { name: "your dashboard" }).getAttribute("href"),
    ).toBe("https://getbb.app/dashboard");
    slot.getByRole("button", { name: "Sign in" });
  });

  it("shows a paired bb whose account hasn't loaded as pending, not signed out", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          "login.poll": () => ({
            login: null,
            status: { state: "profile-pending", revision: 6, account: null },
          }),
        },
      },
    );

    await slot.findByText(/hasn't loaded your account yet/);
    slot.getByRole("button", { name: "Sign out" });
    expect(slot.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("starts a browser sign-in, shows the code, and closes once approved", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: () => true,
        rpc: {
          "login.poll": () => ({ login: null, status: signedOut }),
          "login.start": () => pendingLogin(),
          "login.cancel": () => ({ login: null }),
        },
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "login.start",
        input: { baseUrl: null },
      }),
    );
    await slot.emitRealtime(ACCOUNT_REALTIME_CHANNEL, {
      status: signedOut,
      login: pendingLogin(),
    });

    await slot.findByText("K7QP-2M4X");
    const link = slot.getByRole("link", {
      name: /Open getbb\.app/,
    }) as HTMLAnchorElement;
    expect(link.href).toBe("https://getbb.app/link?code=K7QP-2M4X");
    expect(link.target).toBe("_blank");
    slot.getByText(/Waiting for you to approve it/);

    await slot.emitRealtime(ACCOUNT_REALTIME_CHANNEL, {
      status: signedIn,
      login: pendingLogin({ state: "signed-in" }),
    });
    await slot.findByText("Sawyer Hood");
    expect(slot.queryByText("K7QP-2M4X")).toBeNull();
    expect(slot.rpcCalls.some((call) => call.method === "login.cancel")).toBe(
      false,
    );
  });

  it("explains a denied sign-in and offers a new code", async () => {
    let started = 0;
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          "login.poll": () => ({ login: null, status: signedOut }),
          "login.start": () => {
            started += 1;
            return pendingLogin({ id: `login-${started}` });
          },
        },
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(started).toBe(1));
    await slot.emitRealtime(ACCOUNT_REALTIME_CHANNEL, {
      status: signedOut,
      login: pendingLogin({
        state: "denied",
        message: "Sign-in was denied on getbb.app.",
      }),
    });

    await slot.findByText("Sign-in was denied on getbb.app.");
    fireEvent.click(slot.getByRole("button", { name: "Get a new code" }));
    await waitFor(() => expect(started).toBe(2));
  });

  it("cancels the pending sign-in when the dialog closes", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          "login.poll": () => ({ login: null, status: signedOut }),
          "login.start": () => pendingLogin(),
          "login.cancel": () => ({ login: null }),
        },
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: "Sign in" }));
    await slot.emitRealtime(ACCOUNT_REALTIME_CHANNEL, {
      status: signedOut,
      login: pendingLogin(),
    });
    await slot.findByText("K7QP-2M4X");
    fireEvent.click(slot.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "login.cancel",
        input: { loginId: "login-1" },
      }),
    );
  });

  it("pairs with a pasted code and maps failures to human copy", async () => {
    let attempts = 0;
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          "login.poll": () => ({ login: null, status: signedOut }),
          redeemCode: () => {
            attempts += 1;
            throw new Error("expired_code");
          },
        },
      },
    );

    fireEvent.click(
      await slot.findByRole("button", { name: "Have a pairing code?" }),
    );
    fireEvent.change(slot.getByLabelText("Pairing code"), {
      target: { value: " k7qp2m4x " },
    });
    fireEvent.click(slot.getByRole("button", { name: "Pair" }));

    await slot.findByText(/That code has expired\./);
    expect(attempts).toBe(1);
    expect(slot.rpcCalls).toContainEqual({
      method: "redeemCode",
      input: { code: "K7QP-2M4X", baseUrl: null },
    });
    expect(slot.queryByText("expired_code")).toBeNull();
  });
});
