// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { AccountSummary } from "./src/contracts.js";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

function account(): AccountSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    provider: "claude",
    kind: "oauth",
    label: "Personal Claude",
    email: "person@example.com",
    accountUuid: null,
    subscriptionType: "max",
    rateLimitTier: "default_claude_max_5x",
    enabled: true,
    priority: 100,
    createdAt: 1,
    fiveHourUtilization: 0.21,
    fiveHourResetAt: null,
    fiveHourStatus: null,
    sevenDayUtilization: 0.43,
    sevenDayResetAt: null,
    sevenDayStatus: null,
    representativeClaim: null,
    familyWeekly: {
      fable: null,
      sonnet: null,
      opus: null,
      haiku: null,
      other: null,
    },
    observedAt: 1,
    heldUntil: null,
    error: null,
    inFlight: 0,
    status: "ready",
  };
}

describe("Account Pool settings", () => {
  it("completes the browser login step and refreshes the account list", async () => {
    const accounts: AccountSummary[] = [];
    const opened: string[] = [];
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: (url) => {
          opened.push(url);
          return true;
        },
        rpc: {
          "account.list": () => [...accounts],
          "login.start": () => ({
            sessionId: "22222222-2222-4222-8222-222222222222",
            authorizeUrl: "https://claude.ai/oauth/authorize?state=state",
          }),
          "login.complete": () => {
            const added = account();
            accounts.push(added);
            return added;
          },
        },
      },
    );

    expect(await slot.findByText("No provider accounts yet")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Sign in to Claude" }));
    expect(await slot.findByText("Finish signing in to Claude")).toBeTruthy();
    expect(opened).toEqual(["https://claude.ai/oauth/authorize?state=state"]);
    fireEvent.change(slot.getByLabelText("Claude authorization code"), {
      target: { value: "code#state" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Complete sign-in" }));

    expect(await slot.findByText("Personal Claude")).toBeTruthy();
    expect(slot.getByText("person@example.com")).toBeTruthy();
    expect(slot.getByText("5h 21%")).toBeTruthy();
    expect(slot.getByText("7d 43%")).toBeTruthy();
    expect(slot.getByText("Claude")).toBeTruthy();
    expect(slot.queryByText("Finish signing in to Claude")).toBeNull();
    expect(slot.rpcCalls).toContainEqual({
      method: "login.complete",
      input: {
        sessionId: "22222222-2222-4222-8222-222222222222",
        pasted: "code#state",
      },
    });
  });

  it("signs in to Codex through the device-code state machine", async () => {
    const added: AccountSummary = {
      ...account(),
      provider: "codex",
      label: "Codex Pro",
      email: "codex@example.com",
      codexAccountId: "chatgpt-account-1",
    };
    const accounts: AccountSummary[] = [];
    const opened: string[] = [];
    let polls = 0;
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: (url) => {
          opened.push(url);
          return true;
        },
        rpc: {
          "account.list": () => [...accounts],
          "codexLogin.start": () => ({
            sessionId: "33333333-3333-4333-8333-333333333333",
            verificationUri: "https://auth.openai.com/codex/device",
            userCode: "ABCD-1234",
            expiresAt: Date.now() + 600_000,
            intervalMs: 1,
          }),
          "codexLogin.poll": () => {
            polls += 1;
            if (polls === 1) return { status: "pending" };
            accounts.push(added);
            return { status: "complete", account: added };
          },
        },
      },
    );
    fireEvent.click(
      await slot.findByRole("button", {
        name: "Sign in to Codex",
      }),
    );
    expect(await slot.findByText("Finish signing in to Codex")).toBeTruthy();
    expect(slot.getByLabelText("Codex user code").textContent).toContain(
      "ABCD-1234",
    );
    expect(slot.getByText("Waiting for you to authorize…")).toBeTruthy();
    expect(opened).toEqual(["https://auth.openai.com/codex/device"]);
    expect(await slot.findByText("Codex Pro")).toBeTruthy();
    expect(slot.getByText("Codex")).toBeTruthy();
    expect(
      slot.rpcCalls.filter((call) => call.method === "codexLogin.poll"),
    ).toHaveLength(2);
  });

  it("shows a Codex device-login error and allows retry", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: () => true,
        rpc: {
          "account.list": () => [],
          "codexLogin.start": () => ({
            sessionId: "33333333-3333-4333-8333-333333333333",
            verificationUri: "https://auth.openai.com/codex/device",
            userCode: "ABCD-1234",
            expiresAt: Date.now() + 600_000,
            intervalMs: 1,
          }),
          "codexLogin.poll": () => ({
            status: "error",
            message: "Code expired, start again.",
          }),
        },
      },
    );
    fireEvent.click(
      await slot.findByRole("button", { name: "Sign in to Codex" }),
    );
    expect((await slot.findByRole("alert")).textContent).toContain(
      "Code expired, start again.",
    );
    expect(slot.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("cancels the server-side Codex login session", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: () => true,
        rpc: {
          "account.list": () => [],
          "codexLogin.start": () => ({
            sessionId: "33333333-3333-4333-8333-333333333333",
            verificationUri: "https://auth.openai.com/codex/device",
            userCode: "ABCD-1234",
            expiresAt: Date.now() + 600_000,
            intervalMs: 60_000,
          }),
          "codexLogin.cancel": () => ({ cancelled: true }),
        },
      },
    );
    fireEvent.click(
      await slot.findByRole("button", { name: "Sign in to Codex" }),
    );
    fireEvent.click(await slot.findByRole("button", { name: "Cancel" }));

    expect(slot.queryByText("Finish signing in to Codex")).toBeNull();
    expect(slot.rpcCalls).toContainEqual({
      method: "codexLogin.cancel",
      input: { sessionId: "33333333-3333-4333-8333-333333333333" },
    });
  });

  it("does not render a Codex import button", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: { "account.list": () => [] },
      },
    );
    expect(await slot.findByText("No provider accounts yet")).toBeTruthy();
    expect(
      slot.queryByRole("button", { name: "Import Codex from this machine" }),
    ).toBeNull();
  });

  it("keeps the login step open and shows a completion error inline", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl: () => true,
        rpc: {
          "account.list": () => [],
          "login.start": () => ({
            sessionId: "22222222-2222-4222-8222-222222222222",
            authorizeUrl: "https://claude.ai/oauth/authorize?state=state",
          }),
          "login.complete": () => {
            throw new Error("OAuth state mismatch. Start again.");
          },
        },
      },
    );

    fireEvent.click(
      await slot.findByRole("button", { name: "Sign in to Claude" }),
    );
    fireEvent.change(await slot.findByLabelText("Claude authorization code"), {
      target: { value: "code#wrong" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Complete sign-in" }));

    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toContain("OAuth state mismatch. Start again.");
    expect(slot.getByText("Finish signing in to Claude")).toBeTruthy();
    await waitFor(() =>
      expect(
        slot
          .getByRole("button", { name: "Complete sign-in" })
          .getAttribute("disabled"),
      ).toBeNull(),
    );
  });
});
