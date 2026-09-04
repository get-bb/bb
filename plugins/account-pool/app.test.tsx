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

  it("imports Codex credentials from the server machine", async () => {
    const added = {
      ...account(),
      provider: "codex" as const,
      label: "Codex Pro",
    };
    const accounts: AccountSummary[] = [];
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          "account.list": () => [...accounts],
          "account.add": () => {
            accounts.push(added);
            return added;
          },
        },
      },
    );
    fireEvent.click(
      await slot.findByRole("button", {
        name: "Import Codex from this machine",
      }),
    );
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "account.add",
        input: {
          provider: "codex",
          source: { kind: "import" },
          label: null,
          priority: 100,
        },
      }),
    );
    expect(await slot.findByText("Codex Pro")).toBeTruthy();
    expect(slot.getByText("Codex")).toBeTruthy();
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
