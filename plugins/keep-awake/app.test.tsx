// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

const hosts = [
  { id: "host-1", name: "Laptop", status: "connected" as const },
  { id: "host-2", name: "Studio", status: "disconnected" as const },
];

describe("Keep Awake host settings", () => {
  it("switches from all hosts to selected hosts and saves through RPC", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          getHostConfiguration: () => ({
            selection: { mode: "all" as const },
            hosts,
          }),
          setHostSelection: (selection) => ({ selection, hosts }),
        },
      },
    );

    const allHosts = await slot.findByRole("radio", { name: "All hosts" });
    expect((allHosts as HTMLInputElement).checked).toBe(true);

    fireEvent.click(slot.getByRole("radio", { name: "Selected hosts" }));
    expect(
      (slot.getByRole("checkbox", { name: "Laptop" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(slot.getByText("Offline")).toBeTruthy();

    fireEvent.click(slot.getByRole("checkbox", { name: "Studio" }));
    fireEvent.click(slot.getByRole("checkbox", { name: "Laptop" }));
    fireEvent.click(slot.getByRole("button", { name: "Save hosts" }));

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "setHostSelection",
        input: { mode: "selected", hostIds: ["host-2"] },
      }),
    );
  });

  it("requires at least one host in selected mode", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          getHostConfiguration: () => ({
            selection: { mode: "selected" as const, hostIds: ["host-1"] },
            hosts,
          }),
          setHostSelection: (selection) => ({ selection, hosts }),
        },
      },
    );

    const laptop = await slot.findByRole("checkbox", { name: "Laptop" });
    fireEvent.click(laptop);

    expect(slot.getByRole("alert").textContent).toContain(
      "Select at least one host",
    );
    expect(
      (
        slot.getByRole("button", {
          name: "Save hosts",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
