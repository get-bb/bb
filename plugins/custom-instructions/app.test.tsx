// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

describe("custom instructions settings", () => {
  it("uses the plugin page header instead of declaring a second title", () => {
    expect(app.settingsSections[0]?.title).toBeUndefined();
  });

  it("loads and autosaves only the latest debounced instructions", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          getInstructions: () => ({
            instructions: "Use concise answers.",
            maxLength: 4096,
          }),
          saveInstructions: (input) => ({
            instructions: (input as { instructions: string }).instructions,
            maxLength: 4096,
          }),
        },
      },
    );

    const textarea = (await slot.findByLabelText(
      "Custom instructions",
    )) as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe("Use concise answers."));

    expect(slot.queryByRole("button", { name: "Save" })).toBeNull();

    fireEvent.change(textarea, {
      target: { value: "Always run" },
    });
    fireEvent.change(textarea, {
      target: { value: "Always run focused tests." },
    });
    expect(slot.getByRole("status").textContent).toBe("Saving…");

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "saveInstructions",
        input: { instructions: "Always run focused tests." },
      }),
    );
    expect(
      slot.rpcCalls.some(
        (call) =>
          call.method === "saveInstructions" &&
          (call.input as { instructions?: unknown }).instructions ===
            "Always run",
      ),
    ).toBe(false);
    await waitFor(() =>
      expect(slot.getByRole("status").textContent).toBe("Saved"),
    );
  });

  it("shows save failures without losing the draft", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          getInstructions: () => ({ instructions: "", maxLength: 4096 }),
          saveInstructions: () => {
            throw new Error("Could not save instructions");
          },
        },
      },
    );
    const textarea = (await slot.findByLabelText(
      "Custom instructions",
    )) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Keep this draft" } });

    await slot.findByRole("alert");
    expect(slot.getByRole("alert").textContent).toContain(
      "Could not save instructions",
    );
    expect(textarea.value).toBe("Keep this draft");
  });
});
