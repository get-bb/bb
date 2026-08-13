// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

await loadPluginApp(() => import("../../../app.js"));
const { MaterializeDialog } = await import("./materialize-dialog.js");
const registration = { id: "materialize", component: MaterializeDialog };

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
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

function open(rpc: Record<string, (input: unknown) => unknown> = {}) {
  const slot = renderSlot(registration, { projectId: "project-1", initialPvId: "pv-1" }, { rpc });
  fireEvent.click(slot.getByRole("button", { name: "Materialize" }));
  return slot;
}

describe("materialize dialog", () => {
  it("defaults to local standalone unpack and explains the extractor prerequisite", async () => {
    const slot = open();
    expect((await slot.findByRole("radio", { name: /Local image/u })).getAttribute("data-state")).toBe("checked");
    expect(slot.getByText(/configured wrapper\/FACT image/u)).toBeTruthy();
    expect((slot.getByRole("button", { name: "Select local image" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("labels API metadata as the constrained fallback", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("radio", { name: /Platform API fallback/u }));
    expect(slot.getByText(/org-admin VIEW_ANY_PROJECT_FILE/u)).toBeTruthy();
    expect(slot.getByText(/bulk rootfs hydration is unavailable/u)).toBeTruthy();
  });

  it("can be cancelled without issuing a request", async () => {
    const slot = open({ firmwareMaterializeStart: vi.fn() });
    fireEvent.click(await slot.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    expect(slot.rpcCalls).toEqual([]);
  });

  it("prevents a double API submission", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    const slot = open({ firmwareMaterializeStart: () => pending });
    fireEvent.click(await slot.findByRole("radio", { name: /Platform API fallback/u }));
    const submit = slot.getByRole("button", { name: "Load API metadata" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(slot.rpcCalls.filter((call) => call.method === "firmwareMaterializeStart")).toHaveLength(1));
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    resolve();
  });
});
