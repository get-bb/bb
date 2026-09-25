// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { BB_CLOUD_OFF_MESSAGE } from "./src/disclosure.js";
import type { BbAiOverview } from "./src/server.js";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

const OFF: BbAiOverview = {
  enabled: false,
  account: { state: "signed-in", githubLogin: "octo", name: "Octo Cat" },
  status: { ready: false, message: BB_CLOUD_OFF_MESSAGE },
  usage: null,
  usageError: null,
};

const ON: BbAiOverview = {
  ...OFF,
  enabled: true,
  status: { ready: true },
  usage: {
    day: "2026-09-22",
    spentMicros: 30_000,
    limitMicros: 500_000,
    resetsAt: Date.parse("2026-09-23T00:00:00Z"),
  },
};

function section() {
  const registration = app.settingsSections[0];
  if (registration === undefined) {
    throw new Error("bb-ai did not register a settings section");
  }
  return registration;
}

describe("bb cloud settings section", () => {
  it("starts off, discloses what is sent, and turns on through the switch", async () => {
    const slot = renderSlot(
      section(),
      {},
      {
        rpc: {
          overview: () => OFF,
          setEnabled: () => ON,
        },
      },
    );

    const toggle = await slot.findByRole("switch", { name: "Use bb cloud" });
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("false"),
    );
    expect(slot.getByText("Off. bb sends nothing to bb cloud.")).toBeTruthy();
    const disclosure = slot.getByText(/OpenRouter/u).textContent ?? "";
    expect(disclosure).toContain("first prompt");
    expect(disclosure).toContain("diff excerpt");
    expect(disclosure).toContain("getbb.app");
    expect(disclosure).toContain("zero data retention");
    expect(disclosure).toContain("daily usage totals");
    expect(disclosure).toContain("for 30 days");
    expect(disclosure).toContain("never stores prompts");

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "setEnabled",
        input: { enabled: true },
      }),
    );
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("true"),
    );
    expect(
      slot.getByText("Ready for thread titles and commit messages."),
    ).toBeTruthy();
    expect(
      slot.getByText("$0.03 of $0.50 today, resets 00:00 UTC"),
    ).toBeTruthy();
  });

  it("turns off and shows the account and readiness while on", async () => {
    const slot = renderSlot(
      section(),
      {},
      {
        rpc: {
          overview: () => ({
            ...ON,
            status: { ready: false, message: "Daily limit reached" },
          }),
          setEnabled: () => OFF,
        },
      },
    );

    expect(await slot.findByText("Signed in as octo.")).toBeTruthy();
    expect(slot.getByText("Daily limit reached")).toBeTruthy();
    const toggle = slot.getByRole("switch", { name: "Use bb cloud" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("false"),
    );
    expect(slot.rpcCalls).toContainEqual({
      method: "setEnabled",
      input: { enabled: false },
    });
    expect(slot.getByText("Off. bb sends nothing to bb cloud.")).toBeTruthy();
  });

  it("keeps the switch where it was and shows the error when saving fails", async () => {
    const slot = renderSlot(
      section(),
      {},
      {
        rpc: {
          overview: () => OFF,
          setEnabled: () => {
            throw new Error("bb-ai is reloading");
          },
        },
      },
    );

    const toggle = await slot.findByRole("switch", { name: "Use bb cloud" });
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
    fireEvent.click(toggle);
    expect((await slot.findByRole("alert")).textContent).toBe(
      "bb-ai is reloading",
    );
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(slot.getByText("Signed in as octo.")).toBeTruthy();
  });

  it("shows usage errors instead of a zero balance", async () => {
    const slot = renderSlot(
      section(),
      {},
      {
        rpc: {
          overview: () => ({
            ...ON,
            usage: null,
            usageError: "bb cloud answered HTTP 503",
          }),
        },
      },
    );

    expect(
      await slot.findByText("Usage unavailable: bb cloud answered HTTP 503"),
    ).toBeTruthy();
  });

  it("shows why the section could not load", async () => {
    const slot = renderSlot(
      section(),
      {},
      {
        rpc: {
          overview: () => {
            throw new Error("The bb-ai plugin is not running");
          },
        },
      },
    );

    expect((await slot.findByRole("alert")).textContent).toBe(
      "The bb-ai plugin is not running",
    );
    const toggle = slot.getByRole("switch", { name: "Use bb cloud" });
    expect(toggle.hasAttribute("disabled")).toBe(true);
  });
});
