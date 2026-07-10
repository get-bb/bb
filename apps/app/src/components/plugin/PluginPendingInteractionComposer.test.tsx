// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginPendingInteraction } from "@bb/domain";
import type { PluginPendingInteractionProps } from "@bb/plugin-sdk";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import {
  cancelThreadPluginInteraction,
  respondToThreadPluginInteraction,
} from "@/lib/api";
import { PluginPendingInteractionComposer } from "./PluginPendingInteractionComposer";

vi.mock("@/lib/api", () => ({
  cancelThreadPluginInteraction: vi.fn(async () => ({})),
  respondToThreadPluginInteraction: vi.fn(async () => ({})),
}));

function registrations(
  pendingInteractions: NonNullable<
    PluginRegistrationSet["pendingInteractions"]
  >,
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    composerAccessories: [],
    pendingInteractions,
    sidebarFooterActions: [],
    fileOpeners: [],
  };
}

const interaction: PluginPendingInteraction = {
  id: "pint_23456789ab",
  threadId: "thr_test",
  turnId: null,
  origin: { kind: "plugin", pluginId: "secrets", rendererId: "secret-request" },
  status: "pending",
  payload: {
    kind: "plugin",
    title: "Add secrets",
    data: { fields: ["API_KEY"] },
  },
  resolution: null,
  statusReason: null,
  createdAt: 1,
  expiresAt: 2,
  resolvedAt: null,
};

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.clearAllMocks();
});

describe("PluginPendingInteractionComposer", () => {
  it("mounts only the matching plugin renderer and submits through host code", async () => {
    function Form({
      interaction: view,
      submit,
    }: PluginPendingInteractionProps) {
      return (
        <button onClick={() => void submit({ sentinel: "value" })}>
          form {view.title}
        </button>
      );
    }
    setPluginSlotRegistrations(
      "wrong-plugin",
      registrations([{ id: "secret-request", component: Form }]),
    );
    setPluginSlotRegistrations(
      "secrets",
      registrations([{ id: "secret-request", component: Form }]),
    );

    render(<PluginPendingInteractionComposer interaction={interaction} />);
    fireEvent.click(screen.getByText("form Add secrets"));

    await waitFor(() =>
      expect(respondToThreadPluginInteraction).toHaveBeenCalledWith(
        "thr_test",
        "pint_23456789ab",
        { sentinel: "value" },
      ),
    );
  });

  it("keeps a host-owned cancel fallback when the renderer is missing", async () => {
    render(<PluginPendingInteractionComposer interaction={interaction} />);
    expect(screen.getByText(/form is unavailable/i)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(cancelThreadPluginInteraction).toHaveBeenCalledWith(
        "thr_test",
        "pint_23456789ab",
      ),
    );
  });

  it("keeps cancel available when the renderer crashes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    function Crashed(): never {
      throw new Error("boom");
    }
    setPluginSlotRegistrations(
      "secrets",
      registrations([{ id: "secret-request", component: Crashed }]),
    );
    render(<PluginPendingInteractionComposer interaction={interaction} />);
    expect(screen.getByText(/form crashed/i)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(cancelThreadPluginInteraction).toHaveBeenCalledWith(
        "thr_test",
        "pint_23456789ab",
      ),
    );
  });
});
