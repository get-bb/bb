// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  RefusalFallbackPayload,
  RefusalFallbackResponse,
} from "./src/contracts";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

const payload: RefusalFallbackPayload = {
  refusedModelLabel: "Opus 5 (1M)",
  detail: "Opus 5 (1M)'s safeguards flagged this message.",
  options: [
    {
      model: "claude-opus-4-8[1m]",
      label: "Opus 4.8 (1M)",
      description: "Opus 4.8 with 1M context",
    },
    { model: "claude-sonnet-5", label: "Sonnet 5" },
  ],
};

function render(handlers: { submit?: (value: unknown) => Promise<void> } = {}) {
  return renderSlot(app.pendingInteractions[0]!, {
    interaction: {
      id: "pint_test",
      threadId: "thr_test",
      title: "Opus 5 (1M) refused this message",
      payload: payload as never,
      createdAt: 0,
      expiresAt: null,
    },
    submit: handlers.submit ?? (async () => undefined),
    cancel: async () => undefined,
  });
}

function buttonByText(
  slot: ReturnType<typeof render>,
  text: string,
): HTMLButtonElement {
  const button = slot.getByText(text).closest("button");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`${text} is not rendered inside a button`);
  }
  return button;
}

describe("choosing a fallback model", () => {
  it("switches to the first offered model without remembering the choice", () => {
    const submit = vi.fn(async (_value: unknown) => undefined);
    const slot = render({ submit });

    fireEvent.click(buttonByText(slot, "Switch and retry"));

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toEqual({
      model: "claude-opus-4-8[1m]",
      remember: false,
    } satisfies RefusalFallbackResponse);
  });

  it("remembers the chosen model when the user opts out of the prompt", () => {
    const submit = vi.fn(async (_value: unknown) => undefined);
    const slot = render({ submit });

    fireEvent.click(buttonByText(slot, "Sonnet 5"));
    fireEvent.click(
      slot.getByLabelText("Switch automatically next time, do not ask again"),
    );
    fireEvent.click(buttonByText(slot, "Switch and retry"));

    expect(submit.mock.calls[0]?.[0]).toEqual({
      model: "claude-sonnet-5",
      remember: true,
    } satisfies RefusalFallbackResponse);
  });

  it("keeps the refused model when the user declines", () => {
    const submit = vi.fn(async (_value: unknown) => undefined);
    const slot = render({ submit });

    fireEvent.click(buttonByText(slot, "Keep Opus 5 (1M)"));

    expect(submit.mock.calls[0]?.[0]).toEqual({
      model: null,
      remember: false,
    } satisfies RefusalFallbackResponse);
  });
});
