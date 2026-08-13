// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { REMOTE_CONNECTIONS_CHANGED_CHANNEL } from "./connection-state.js";

const app = await loadPluginApp(() => import("../../app.js"));

function connection(
  state:
    | "needs-configuration"
    | "disabled"
    | "configured"
    | "connected"
    | "unreachable",
  message: string | null,
) {
  return { state, message, checkedAt: null };
}

function status(platformState: ReturnType<typeof connection>["state"]) {
  return {
    platform: connection(
      platformState,
      platformState === "needs-configuration"
        ? "Connect your Finite State account to load projects"
        : null,
    ),
    assuranceStudio: connection("disabled", "Assurance Studio is not configured"),
    forgeCompute: connection("disabled", "Forge Compute is disabled"),
  };
}

function panel(id: string) {
  const registration = app.navPanels.find((candidate) => candidate.id === id);
  if (!registration) throw new Error(`${id} panel was not registered`);
  return registration;
}

afterEach(() => cleanup());

describe("Platform connection panel gate", () => {
  it.each([
    ["product-security", "tara"],
    ["bill-of-materials", "software"],
  ])("renders a live configuration path in the %s panel", async (id, subPath) => {
    const slot = renderSlot(
      panel(id),
      { subPath },
      { rpc: { connectionsStatus: () => status("needs-configuration") } },
    );

    expect(await slot.findByText("Connect Finite State Platform")).toBeTruthy();
    expect(
      slot.getByText("Connect your Finite State account to load projects"),
    ).toBeTruthy();
    expect(
      slot
        .getByRole("link", { name: /Open connection settings/u })
        .getAttribute("href"),
    ).toBe("/settings/plugins/finite-state");
  });

  it("transitions in place after settings change without remounting the panel", async () => {
    let platformState: ReturnType<typeof connection>["state"] =
      "needs-configuration";
    const slot = renderSlot(
      panel("product-security"),
      { subPath: "tara" },
      {
        rpc: { connectionsStatus: () => status(platformState) },
        sidebarThreads: { status: "ready", projects: [] },
      },
    );
    expect(await slot.findByText("Connect Finite State Platform")).toBeTruthy();

    platformState = "connected";
    await slot.behavior.emitRealtime(REMOTE_CONNECTIONS_CHANGED_CHANNEL, null);

    expect(await slot.findByText("Choose a project")).toBeTruthy();
    expect(slot.queryByText("Connect Finite State Platform")).toBeNull();
  });

  it("does not demote unreachable Platform or a status-read failure", async () => {
    const unreachable = renderSlot(
      panel("product-security"),
      { subPath: "tara" },
      {
        rpc: { connectionsStatus: () => status("unreachable") },
        sidebarThreads: { status: "ready", projects: [] },
      },
    );
    expect(await unreachable.findByText("Choose a project")).toBeTruthy();
    unreachable.lifecycle.unmount();

    const connectionsStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("status unavailable"))
      .mockResolvedValue(status("connected"));
    const failed = renderSlot(
      panel("product-security"),
      { subPath: "tara" },
      {
        rpc: { connectionsStatus },
        sidebarThreads: { status: "ready", projects: [] },
      },
    );
    expect(await failed.findByText("Panel data remains accessible.", { exact: false })).toBeTruthy();
    expect(failed.getByText("Choose a project")).toBeTruthy();
    fireEvent.click(failed.getByRole("button", { name: "Retry" }));
    expect(await failed.findByText("Choose a project")).toBeTruthy();
    expect(connectionsStatus).toHaveBeenCalledTimes(2);
  });
});
