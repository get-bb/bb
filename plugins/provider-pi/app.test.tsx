// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalProviderExtensionStateProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const toastMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMocks }));
import type { PiModelSettingsSnapshot } from "./src/model-settings-contract.js";

const snapshot: PiModelSettingsSnapshot = {
  models: [
    {
      id: "anthropic/claude-sonnet-5",
      displayName: "Claude Sonnet 5",
      provider: "anthropic",
      reasoning: true,
    },
    {
      id: "openai/gpt-5.1",
      displayName: "GPT-5.1",
      provider: "openai",
      reasoning: true,
    },
    {
      id: "google/gemini-3-pro",
      displayName: "Gemini 3 Pro",
      provider: "google",
      reasoning: true,
    },
  ],
  enabledModelIds: ["anthropic/claude-sonnet-5"],
};

afterEach(cleanup);

describe("Pi model settings editor", () => {
  it("tracks unsaved changes, resets, saves, and enables all", async () => {
    const write = vi.fn((input: unknown) => ({
      ...snapshot,
      enabledModelIds: (input as { enabledModelIds: string[] | null }).enabledModelIds,
    }));
    const app = await loadPluginApp(() => import("./app.js"));
    const slot = renderSlot(
      app.settingsSections.find(({ id }) => id === "models")!,
      { experimental_hostId: "host-1" },
      {
        rpc: {
          readModelSettings: () => snapshot,
          writeModelSettings: write,
        },
      },
    );

    const gpt = await slot.findByRole("switch", {
      name: "Enable openai/gpt-5.1",
    });
    const search = slot.getByRole("textbox", { name: "Search Pi models" });
    fireEvent.change(search, { target: { value: "openai" } });
    expect(slot.queryByText("Gemini 3 Pro")).toBeNull();
    fireEvent.change(search, { target: { value: "" } });

    fireEvent.click(gpt);
    expect(slot.getByText("Unsaved changes")).toBeTruthy();
    expect(
      slot.getByText("2 of 3 models enabled for Pi cycling."),
    ).toBeTruthy();

    fireEvent.click(slot.getByRole("button", { name: "Reset" }));
    expect(slot.queryByText("Unsaved changes")).toBeNull();
    expect((gpt as HTMLButtonElement).getAttribute("data-state")).toBe(
      "unchecked",
    );

    fireEvent.click(gpt);
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith({
        hostId: "host-1",
        enabledModelIds: ["anthropic/claude-sonnet-5", "openai/gpt-5.1"],
      }),
    );
    await waitFor(() => expect(slot.queryByText("Unsaved changes")).toBeNull());

    fireEvent.click(
      slot.getByRole("switch", { name: "Enable openai/gpt-5.1" }),
    );
    fireEvent.click(slot.getByRole("button", { name: "Enable all" }));
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(write).toHaveBeenLastCalledWith({
        hostId: "host-1",
        enabledModelIds: null,
      }),
    );
  });

  it("shows the selected host's no-model authentication state", async () => {
    const app = await loadPluginApp(() => import("./app.js"));
    const slot = renderSlot(
      app.settingsSections.find(({ id }) => id === "models")!,
      { experimental_hostId: "host-empty" },
      {
        rpc: {
          readModelSettings: () => ({ models: [], enabledModelIds: null }),
        },
      },
    );

    expect(
      await slot.findByText(
        "No authenticated Pi models are available on this host. Run `pi` there to sign in.",
      ),
    ).toBeTruthy();
    expect(slot.inspection.rpcCalls[0]).toMatchObject({
      method: "readModelSettings",
      input: { hostId: "host-empty" },
    });
  });
});

describe("Pi extension state renderer", () => {
  beforeEach(() => {
    toastMocks.info.mockClear();
    toastMocks.warning.mockClear();
    toastMocks.error.mockClear();
  });

  let threadSerial = 0;
  function stateProps(
    threadId: string,
    payload: unknown,
    sourceSeq: number,
  ): ExperimentalProviderExtensionStateProps {
    return {
      threadId,
      providerId: "pi",
      kind: "provider-pi/extension-ui",
      payload: payload as ExperimentalProviderExtensionStateProps["payload"],
      sourceSeq,
      placement: "aboveEditor",
      experimental_dispatchAction: async () => ({ applied: false }),
    };
  }
  function snapshot(overrides: Record<string, unknown>) {
    return { statuses: [], widgets: [], notifications: [], title: null, editor: null, ...overrides };
  }

  it("toasts a notification once when it arrives, never the ones a persisted snapshot already held", async () => {
    const app = await loadPluginApp(() => import("./app.js"));
    const registration = app.providerExtensionStates.find(({ name }) => name === "extension-ui")!;
    const threadId = `thr_toast_${(threadSerial += 1)}`;
    const persisted = snapshot({
      notifications: [{ id: 1, message: "old news", level: "info" }],
    });
    const slot = renderSlot(registration, stateProps(threadId, persisted, 10));
    expect(toastMocks.info).not.toHaveBeenCalled();

    const arrived = snapshot({
      notifications: [
        { id: 1, message: "old news", level: "info" },
        { id: 2, message: "heads up", level: "warning" },
      ],
    });
    slot.rerender(<registration.component {...stateProps(threadId, arrived, 11)} />);
    expect(toastMocks.warning).toHaveBeenCalledOnce();
    expect(toastMocks.warning).toHaveBeenCalledWith(
      "heads up",
      expect.objectContaining({ closeButton: true }),
    );
    // The same snapshot again (a refetch, a re-render) is not news.
    slot.rerender(<registration.component {...stateProps(threadId, arrived, 11)} />);
    expect(toastMocks.warning).toHaveBeenCalledOnce();

    // A replaced session counts from 1 again: the null snapshot in between
    // resets the mark, so its first notification shows.
    slot.rerender(<registration.component {...stateProps(threadId, null, 12)} />);
    slot.rerender(
      <registration.component
        {...stateProps(threadId, snapshot({ notifications: [{ id: 1, message: "fresh", level: "error" }] }), 13)}
      />,
    );
    expect(toastMocks.error).toHaveBeenCalledWith("fresh", expect.anything());
    expect(toastMocks.info).not.toHaveBeenCalled();
  });

  it("applies an editor request once, not again on every render or for a persisted one", async () => {
    const app = await loadPluginApp(() => import("./app.js"));
    const registration = app.providerExtensionStates.find(({ name }) => name === "extension-ui")!;
    const threadId = `thr_editor_${(threadSerial += 1)}`;
    const persisted = snapshot({ editor: { revision: 3, text: "from before" } });
    const slot = renderSlot(registration, stateProps(threadId, persisted, 20), {
      composer: { text: "my draft" },
    });
    // A persisted request predates this mount: the draft is the user's.
    expect(slot.inspection.composer.text).toBe("my draft");

    const requested = snapshot({ editor: { revision: 4, text: "  exact\n text  " } });
    slot.rerender(<registration.component {...stateProps(threadId, requested, 21)} />);
    expect(slot.inspection.composer.text).toBe("  exact\n text  ");

    await slot.behavior.setComposerText("edited by hand");
    slot.rerender(<registration.component {...stateProps(threadId, requested, 21)} />);
    expect(slot.inspection.composer.text).toBe("edited by hand");
  });
});
