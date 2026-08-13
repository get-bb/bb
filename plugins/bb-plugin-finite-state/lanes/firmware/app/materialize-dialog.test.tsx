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

const configured = {
  standaloneUnpackExecutablePath: "/opt/finite-state/unpack",
  standaloneUnpackImage: "finite-state/fact:test",
};

function open(
  rpc: Record<string, (input: unknown) => unknown> = {},
  settings: Record<string, string | boolean> = configured,
) {
  const slot = renderSlot(registration, { projectId: "project-1", initialPvId: "pv-1" }, { rpc, settings });
  fireEvent.click(slot.getByRole("button", { name: "Materialize" }));
  return slot;
}

describe("materialize dialog", () => {
  it("defaults to local standalone unpack with a confined workspace input", async () => {
    const slot = open();
    expect((await slot.findByRole("radio", { name: /Local image/u })).getAttribute("data-state")).toBe("checked");
    expect(slot.getByText(/finite-state\/fact:test/u)).toBeTruthy();
    expect(slot.getByText(/rejects absolute paths and canonical symlink escapes/u)).toBeTruthy();
    expect((slot.getByRole("button", { name: "Select local image" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the extractor prerequisite as an unconfigured recovery state", async () => {
    const slot = open({}, {
      standaloneUnpackExecutablePath: "",
      standaloneUnpackImage: "localhost:5000/services-unpack:latest",
    });
    expect(await slot.findByText("Standalone extractor is not configured")).toBeTruthy();
    expect(slot.getByText(/Set the Standalone unpack wrapper/u)).toBeTruthy();
  });

  it("issues a confined input before starting standalone unpack", async () => {
    const slot = open({
      firmwareInputIssue: () => ({
        projectId: "project-1",
        projectVersionId: "pv-1",
        inputId: "input-1",
        fileName: "firmware.bin",
        expiresAt: "2026-08-13T00:10:00.000Z",
      }),
      firmwareMaterializeStart: () => ({
        projectId: "project-1",
        projectVersionId: "pv-1",
        id: "job-1",
        state: "QUEUED",
        progress: null,
        message: "Queued",
      }),
    });
    fireEvent.change(await slot.findByLabelText("Environment ID"), { target: { value: "environment-1" } });
    fireEvent.change(slot.getByLabelText("Workspace-relative image"), { target: { value: "artifacts/firmware.bin" } });
    fireEvent.click(slot.getByRole("button", { name: "Select local image" }));
    await waitFor(() => expect(slot.rpcCalls.map((call) => call.method)).toEqual([
      "firmwareInputIssue",
      "firmwareMaterializeStart",
    ]));
    expect(slot.rpcCalls[1]?.input).toEqual(expect.objectContaining({ inputId: "input-1", maxDepth: 12 }));
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
