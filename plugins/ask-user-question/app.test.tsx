// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { InteractionPayload, InteractionResponse } from "./src/contracts";

const app = await loadPluginApp(() => import("./app"));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
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

const singleSelect: InteractionPayload = {
  questions: [
    {
      id: "q0",
      prompt: "Which database should we use?",
      shortLabel: "Database",
      multiSelect: false,
      allowFreeText: true,
      options: [
        {
          value: "q0o0",
          label: "Postgres",
          description: "Relational, needs a server.",
          preview: "CREATE TABLE users (id uuid primary key);",
        },
        {
          value: "q0o1",
          label: "SQLite",
          description: "Embedded, zero setup.",
        },
      ],
    },
  ],
};

function render(
  payload: InteractionPayload,
  handlers: {
    submit?: (value: unknown) => Promise<void>;
    cancel?: () => Promise<void>;
  } = {},
) {
  return renderSlot(app.pendingInteractions[0]!, {
    interaction: {
      id: "pint_test",
      threadId: "thr_test",
      title: "Database",
      payload: payload as never,
      createdAt: 0,
      expiresAt: null,
    },
    submit: handlers.submit ?? (async () => undefined),
    cancel: handlers.cancel ?? (async () => undefined),
  });
}

function getButtonByText(
  slot: ReturnType<typeof render>,
  text: string,
): HTMLButtonElement {
  const button = slot.getByText(text).closest("button");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`${text} is not rendered inside a button`);
  }
  return button;
}

describe("question interaction adapter", () => {
  it("submits the selected option value", () => {
    const submit = vi.fn(async () => undefined);
    const slot = render(singleSelect, { submit });

    expect(slot.getAllByText("Which database should we use?")).toHaveLength(2);
    fireEvent.click(getButtonByText(slot, "SQLite"));
    fireEvent.click(getButtonByText(slot, "Submit answer"));

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toEqual({
      answers: { q0: { selected: ["q0o1"] } },
    } satisfies InteractionResponse);
  });
  it("cancels the request instead of submitting", () => {
    const cancel = vi.fn(async () => undefined);
    const slot = render(singleSelect, { cancel });

    fireEvent.click(getButtonByText(slot, "Cancel"));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("offers a cancel escape rather than blocking the composer", () => {
    const cancel = vi.fn(async () => undefined);
    const slot = renderSlot(app.pendingInteractions[0]!, {
      interaction: {
        id: "pint_test",
        threadId: "thr_test",
        title: "Database",
        payload: { questions: "not an array" } as never,
        createdAt: 0,
        expiresAt: null,
      },
      submit: async () => undefined,
      cancel,
    });

    expect(
      slot.getByText("This question could not be displayed."),
    ).toBeTruthy();
    fireEvent.click(getButtonByText(slot, "Cancel"));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
