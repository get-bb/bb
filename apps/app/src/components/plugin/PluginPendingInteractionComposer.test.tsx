// @vitest-environment jsdom

import { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

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
  return makePluginRegistrationSet({
    pendingInteractions,
  });
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
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

describe("PluginPendingInteractionComposer", () => {
  it("preserves drafts and pauses keyboard listeners while collapsed", () => {
    const onShortcut = vi.fn();
    function QuestionRenderer() {
      const [answer, setAnswer] = useState("");
      useEffect(() => {
        window.addEventListener("keydown", onShortcut);
        return () => window.removeEventListener("keydown", onShortcut);
      }, []);
      return (
        <input
          aria-label="Answer"
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
        />
      );
    }
    setPluginSlotRegistrations(
      "secrets",
      registrations([{ id: "secret-request", component: QuestionRenderer }]),
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
    fireEvent.change(screen.getByRole("textbox", { name: "Answer" }), {
      target: { value: "Keep my draft" },
    });
    fireEvent.keyDown(window, { key: "1" });
    expect(onShortcut).toHaveBeenCalledTimes(1);
    const toggle = screen.getByRole("button", { name: "Hide details" });
    toggle.focus();
    fireEvent.click(toggle);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Show details" }),
    );
    fireEvent.keyDown(window, { key: "2" });
    expect(onShortcut).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByRole("textbox").getAttribute("value")).toBe(
      "Keep my draft",
    );
    fireEvent.keyDown(window, { key: "3" });
    expect(onShortcut).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Show details" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByRole("textbox").getAttribute("value")).toBe(
      "Keep my draft",
    );
  });

  it("opens a new interaction with a fresh form after the previous one was collapsed", () => {
    function Renderer() {
      const [answer, setAnswer] = useState("");
      return (
        <input
          aria-label="Answer"
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
        />
      );
    }
    setPluginSlotRegistrations(
      "secrets",
      registrations([{ id: "secret-request", component: Renderer }]),
    );
    const client = new QueryClient();
    const composer = (id: string) => (
      <QueryClientProvider client={client}>
        <PluginPendingInteractionComposer
          interaction={{ ...interaction, id }}
          request={{
            pluginId: "secrets",
            rendererId: "secret-request",
            title: interaction.payload.title,
            data: interaction.payload.data,
          }}
          dismissal="cancel"
        />
      </QueryClientProvider>
    );
    const view = render(composer(interaction.id));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Previous answer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    view.rerender(composer("pint_new"));
    expect(screen.getByRole("textbox").getAttribute("value")).toBe("");
    expect(
      screen
        .getByRole("button", { name: "Hide details" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

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

  it("resolves the form through the slot store once the renderer registers", () => {
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
