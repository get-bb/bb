// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginPendingInteraction } from "@bb/domain";
import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { PluginPendingInteractionComposer } from "./PluginPendingInteractionComposer";

const mocks = vi.hoisted(() => ({
  requestProviderPluginFrontend: vi.fn(),
}));

vi.mock("@/lib/plugin-frontend-lazy", () => ({
  requestProviderPluginFrontend: mocks.requestProviderPluginFrontend,
}));

// The composer can stop the thread (a provider's request), which needs the
// query client like every mutation hook.
function renderComposer(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>,
  );
}

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
    pendingInteractions,
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
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
  // A crashed slot instance is remembered for the lifetime of the module, so
  // without this a renderer that throws in one test disables that same
  // plugin/slot pair for every test that runs after it.
  resetAllCrashedPluginSlotsForTest();
  // restore, not clear: `vi.clearAllMocks` only drops recorded calls, leaving
  // the `console` spies below installed and silencing later tests.
  vi.restoreAllMocks();
});

describe("PluginPendingInteractionComposer", () => {
  it("mounts only the renderer registered by the interaction's plugin", () => {
    function WrongRenderer() {
      return <div>wrong plugin renderer</div>;
    }
    function MatchingRenderer({
      interaction: view,
    }: PluginPendingInteractionProps) {
      return <div>form {view.title}</div>;
    }
    setPluginSlotRegistrations(
      "wrong-plugin",
      registrations([{ id: "secret-request", component: WrongRenderer }]),
    );
    setPluginSlotRegistrations(
      "secrets",
      registrations([{ id: "secret-request", component: MatchingRenderer }]),
    );

    renderComposer(
      <PluginPendingInteractionComposer
        interaction={interaction}
        request={{
          pluginId: "secrets",
          rendererId: "secret-request",
          title: interaction.payload.title,
          data: interaction.payload.data,
        }}
        dismissal="cancel"
      />,
    );

    expect(screen.getByText("form Add secrets")).toBeDefined();
    expect(screen.queryByText("wrong plugin renderer")).toBeNull();
  });

  it("keeps a host-owned cancel fallback when the renderer is missing", () => {
    renderComposer(
      <PluginPendingInteractionComposer
        interaction={interaction}
        request={{
          pluginId: "secrets",
          rendererId: "secret-request",
          title: interaction.payload.title,
          data: interaction.payload.data,
        }}
        dismissal="cancel"
      />,
    );
    expect(screen.getByText(/form is unavailable/i)).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  });

  it("asks for the owning plugin's frontend while the renderer is missing", () => {
    // A provider plugin's bundle is deferred until a thread of its provider
    // opens, so its form is absent when a child thread's request surfaces on
    // a parent of another provider. The composer requests the bundle; once
    // it registers, the form resolves through the slot store.
    function Renderer({ interaction: view }: PluginPendingInteractionProps) {
      return <div>form {view.title}</div>;
    }
    const request = {
      pluginId: "secrets",
      rendererId: "secret-request",
      title: interaction.payload.title,
      data: interaction.payload.data,
    };
    const { rerender } = renderComposer(
      <PluginPendingInteractionComposer
        interaction={interaction}
        request={request}
        dismissal="stop-turn"
      />,
    );
    expect(screen.getByText(/form is unavailable/i)).toBeDefined();
    expect(mocks.requestProviderPluginFrontend).toHaveBeenCalledWith("secrets");
    expect(
      mocks.requestProviderPluginFrontend.mock.calls.every(
        ([pluginId]) => pluginId === "secrets",
      ),
    ).toBe(true);
    const requestsWhileMissing =
      mocks.requestProviderPluginFrontend.mock.calls.length;

    setPluginSlotRegistrations(
      "secrets",
      registrations([{ id: "secret-request", component: Renderer }]),
    );
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PluginPendingInteractionComposer
          interaction={interaction}
          request={request}
          dismissal="stop-turn"
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("form Add secrets")).toBeDefined();
    // A resolved form never asks again.
    expect(mocks.requestProviderPluginFrontend.mock.calls.length).toBe(
      requestsWhileMissing,
    );
  });

  it("keeps cancel available when the renderer crashes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    function Crashed(): never {
      throw new Error("boom");
    }
    setPluginSlotRegistrations(
      "secrets",
      registrations([{ id: "secret-request", component: Crashed }]),
    );
    renderComposer(
      <PluginPendingInteractionComposer
        interaction={interaction}
        request={{
          pluginId: "secrets",
          rendererId: "secret-request",
          title: interaction.payload.title,
          data: interaction.payload.data,
        }}
        dismissal="cancel"
      />,
    );
    expect(screen.getByText(/form crashed/i)).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  });
});
