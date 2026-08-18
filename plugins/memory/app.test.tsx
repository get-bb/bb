// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

const memory = {
  id: "mem_1",
  scope: "project",
  projectId: "proj_1",
  name: "validation",
  summary: "Run focused tests.",
  details: "Use the repository test command.",
  kind: "procedure",
  tags: ["testing"],
  importance: 60,
  pinned: false,
  version: 1,
  updatedAt: 1_700_000_000_000,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("memory settings", () => {
  it("lists all memories and saves an inline edit", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          listMemories: () => ({ memories: [memory] }),
          updateMemory: () => ({
            memory: {
              ...memory,
              summary: "Run all focused tests.",
              version: 2,
            },
          }),
        },
      },
    );

    expect(await slot.findByText("validation")).toBeTruthy();
    expect(slot.getByText("project")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Edit" }));
    fireEvent.change(slot.getByLabelText("Memory summary"), {
      target: { value: "Run all focused tests." },
    });
    fireEvent.click(slot.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "updateMemory",
        input: expect.objectContaining({
          id: memory.id,
          expectedVersion: 1,
          summary: "Run all focused tests.",
        }),
      }),
    );
    await slot.findByText("Run all focused tests.");
  });

  it("confirms and deletes a memory", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          listMemories: () => ({ memories: [memory] }),
          deleteMemory: () => ({ deleted: { id: memory.id, version: 2 } }),
        },
      },
    );

    expect(await slot.findByText("validation")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "deleteMemory",
        input: { id: memory.id, expectedVersion: 1 },
      }),
    );
    await waitFor(() => expect(slot.queryByText("validation")).toBeNull());
  });
});
