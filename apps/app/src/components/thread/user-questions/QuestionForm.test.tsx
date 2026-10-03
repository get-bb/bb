// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render as renderReact,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionForm } from "@bb/shared-ui/question-form";
import type {
  Question,
  QuestionAnswer,
} from "@bb/shared-ui/question-form-state";
import { ThreadQuestionFormHost } from "./ThreadQuestionFormHost";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { defaultAppSettings } from "@bb/domain";
type InteractionPayload = { questions: Question[] };
type InteractionResponse = { answers: Record<string, QuestionAnswer> };

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: { ...defaultAppSettings },
      keybindings: [1, 2, 3].map((digit) => ({
        command: `question.select.${digit}`,
        desktopOnly: false,
        shortcut: {
          key: String(digit),
          mod: false,
          meta: false,
          control: false,
          alt: false,
          shift: false,
        },
        when: { all: ["questionOpen"], none: [] },
      })),
    },
  }),
}));
vi.mock("@/lib/bb-desktop", () => ({ getBbDesktopInfo: () => null }));
const pane = vi.hoisted(() => ({ isFocused: true }));
vi.mock("@/views/thread-detail/PaneContext", () => ({
  useOptionalPaneContext: () => pane,
}));

beforeEach(() => {
  pane.isFocused = true;
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
    submit?: (value: InteractionResponse) => Promise<void>;
    cancel?: () => Promise<void>;
    draftKey?: string;
  } = {},
) {
  return renderReact(
    <AppCommandProvider>
      <ThreadQuestionFormHost>
        <QuestionForm
          draftKey={handlers.draftKey}
          questions={payload.questions}
          disabled={false}
          cancelDisabled={false}
          onSubmit={(answers) => {
            return handlers.submit?.({ answers });
          }}
          onCancel={() => {
            return handlers.cancel?.();
          }}
        />
      </ThreadQuestionFormHost>
    </AppCommandProvider>,
  );
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

describe("answering a single-select question", () => {
  it("isolates interactions and ignores corrupt drafts or changed questions", () => {
    const firstKey = "thr_isolation:pint_first";
    const secondKey = "thr_isolation:pint_second";
    try {
      const first = render(singleSelect, { draftKey: firstKey });
      fireEvent.click(getButtonByText(first, "SQLite"));
      first.unmount();
      const second = render(singleSelect, { draftKey: secondKey });
      expect(
        getButtonByText(second, "SQLite").getAttribute("aria-pressed"),
      ).toBe("false");
      second.unmount();
      const changed = render(
        {
          questions: [
            { ...singleSelect.questions[0]!, prompt: "A different decision" },
          ],
        },
        { draftKey: firstKey },
      );
      expect(
        getButtonByText(changed, "SQLite").getAttribute("aria-pressed"),
      ).toBe("false");
      changed.unmount();
      window.localStorage.setItem(
        `bb.question-draft.v1:${firstKey}`,
        "not JSON",
      );
      const corrupt = render(singleSelect, { draftKey: firstKey });
      expect(
        getButtonByText(corrupt, "SQLite").getAttribute("aria-pressed"),
      ).toBe("false");
      fireEvent.click(getButtonByText(corrupt, "SQLite"));
      corrupt.unmount();
      const repaired = render(singleSelect, { draftKey: firstKey });
      expect(
        getButtonByText(repaired, "SQLite").getAttribute("aria-pressed"),
      ).toBe("true");
      repaired.unmount();
    } finally {
      window.localStorage.removeItem(`bb.question-draft.v1:${firstKey}`);
      window.localStorage.removeItem(`bb.question-draft.v1:${secondKey}`);
    }
  });

  it("preserves answers across navigation when persistent storage is full", () => {
    const storage = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Storage is full", "QuotaExceededError");
      });
    const draftKey = "thr_quota:pint_quota";
    try {
      const slot = render(singleSelect, { draftKey });
      fireEvent.click(getButtonByText(slot, "Other…"));
      fireEvent.change(slot.getByLabelText("Database answer"), {
        target: { value: "Keep this answer" },
      });
      slot.unmount();
      const restored = render(singleSelect, { draftKey });
      expect(restored.getByLabelText("Database answer")).toHaveProperty(
        "value",
        "Keep this answer",
      );
      restored.unmount();
    } finally {
      storage.mockRestore();
      window.localStorage.removeItem(`bb.question-draft.v1:${draftKey}`);
    }
  });

  it("submits after a number shortcut followed by Enter", () => {
    const submit = vi.fn(async () => undefined);
    const slot = render(singleSelect, { submit });
    fireEvent.keyDown(document.body, { key: "2" });
    expect(getButtonByText(slot, "SQLite").getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Enter",
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("does not intercept modified Enter after a shortcut", () => {
    const submit = vi.fn(async () => undefined);
    render(singleSelect, { submit });
    fireEvent.keyDown(document.body, { key: "2" });
    for (const modifier of [
      "shiftKey",
      "ctrlKey",
      "metaKey",
      "altKey",
      "isComposing",
    ]) {
      fireEvent.keyDown(document.activeElement!, {
        key: "Enter",
        [modifier]: true,
      });
    }
    expect(submit).not.toHaveBeenCalled();
  });

  it("leaves free-text Enter available for newlines", () => {
    const submit = vi.fn(async () => undefined);
    const slot = render(singleSelect, { submit });
    fireEvent.keyDown(document.body, { key: "3" });
    const textarea = slot.getByLabelText("Database answer");
    expect(document.activeElement).toBe(textarea);
    fireEvent.change(textarea, { target: { value: "Custom" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("submits the selected option value", () => {
    const submit = vi.fn<(value: InteractionResponse) => Promise<void>>(
      async () => undefined,
    );
    const slot = render(singleSelect, { submit });

    expect(slot.getAllByText("Which database should we use?")).toHaveLength(2);
    fireEvent.click(getButtonByText(slot, "SQLite"));
    fireEvent.click(getButtonByText(slot, "Submit answer"));

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toEqual({
      answers: { q0: { selected: ["q0o1"] } },
    } satisfies InteractionResponse);
  });

  it("ignores answer shortcuts in an unfocused pane", () => {
    pane.isFocused = false;
    const slot = render(singleSelect);
    fireEvent.keyDown(window, { key: "1" });
    expect(getButtonByText(slot, "Postgres").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("blocks submission until something is chosen", () => {
    const slot = render(singleSelect);
    const submitButton = getButtonByText(slot, "Submit answer");

    expect(submitButton.disabled).toBe(true);
    fireEvent.click(getButtonByText(slot, "Postgres"));
    expect(submitButton.disabled).toBe(false);
  });

  it("reveals an option preview only while that option is selected", () => {
    const slot = render(singleSelect);
    const preview = "CREATE TABLE users (id uuid primary key);";

    expect(slot.queryByText(preview)).toBeNull();
    fireEvent.click(getButtonByText(slot, "Postgres"));
    expect(slot.getByText(preview)).toBeTruthy();

    fireEvent.click(getButtonByText(slot, "SQLite"));
    expect(slot.queryByText(preview)).toBeNull();
  });

  it("makes 'Other' and a real option mutually exclusive", () => {
    const submit = vi.fn<(value: InteractionResponse) => Promise<void>>(
      async () => undefined,
    );
    const slot = render(singleSelect, { submit });

    fireEvent.click(getButtonByText(slot, "Postgres"));
    fireEvent.click(getButtonByText(slot, "Other…"));
    const textarea = slot.getByLabelText("Database answer");
    fireEvent.change(textarea, { target: { value: "DuckDB" } });
    fireEvent.click(getButtonByText(slot, "Submit answer"));

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toEqual({
      answers: { q0: { selected: [], freeText: "DuckDB" } },
    } satisfies InteractionResponse);
  });

  it("selects an option with its number-key shortcut", () => {
    const submit = vi.fn<(value: InteractionResponse) => Promise<void>>(
      async () => undefined,
    );
    const slot = render(singleSelect, { submit });

    fireEvent.keyDown(window, { key: "2" });
    fireEvent.click(getButtonByText(slot, "Submit answer"));

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toEqual({
      answers: { q0: { selected: ["q0o1"] } },
    } satisfies InteractionResponse);
  });

  it("ignores number keys typed into the free-text box", () => {
    const slot = render(singleSelect);
    fireEvent.click(getButtonByText(slot, "Other…"));
    const textarea = slot.getByLabelText("Database answer");

    fireEvent.keyDown(textarea, { key: "1" });

    expect(getButtonByText(slot, "Postgres").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});

describe("multi-select and multi-question flows", () => {
  const multi: InteractionPayload = {
    questions: [
      {
        id: "q0",
        prompt: "Which extras?",
        shortLabel: "Extras",
        multiSelect: true,
        allowFreeText: true,
        options: [
          { value: "q0o0", label: "Metrics", description: "Prometheus." },
          { value: "q0o1", label: "Tracing", description: "OTel." },
        ],
      },
      {
        id: "q1",
        prompt: "Which database?",
        shortLabel: "Database",
        multiSelect: false,
        allowFreeText: true,
        options: [
          { value: "q1o0", label: "Postgres", description: "Server." },
          { value: "q1o1", label: "SQLite", description: "Embedded." },
        ],
      },
    ],
  };

  it("restores partial selections, free text, and the current question after navigation and from saved storage", () => {
    const draftKey = "thr_draft:pint_draft";
    const storageKey = `bb.question-draft.v1:${draftKey}`;
    const original = window.localStorage.getItem(storageKey);
    try {
      const slot = render(multi, { draftKey });
      fireEvent.click(getButtonByText(slot, "Metrics"));
      fireEvent.click(getButtonByText(slot, "Tracing"));
      fireEvent.click(getButtonByText(slot, "Next"));
      fireEvent.click(getButtonByText(slot, "Other…"));
      fireEvent.change(slot.getByLabelText("Database answer"), {
        target: { value: "  DuckDB\nwith extensions  " },
      });
      slot.unmount();

      const restored = render(multi, { draftKey });
      expect(restored.getByText("2 of 2")).toBeTruthy();
      expect(restored.getByLabelText("Database answer")).toHaveProperty(
        "value",
        "  DuckDB\nwith extensions  ",
      );
      fireEvent.click(getButtonByText(restored, "Back"));
      expect(
        getButtonByText(restored, "Metrics").getAttribute("aria-pressed"),
      ).toBe("true");
      expect(
        getButtonByText(restored, "Tracing").getAttribute("aria-pressed"),
      ).toBe("true");
      restored.unmount();

      const saved = window.localStorage.getItem(storageKey);
      expect(saved).not.toBeNull();
      const freshKey = "thr_draft:pint_reloaded";
      window.localStorage.setItem(`bb.question-draft.v1:${freshKey}`, saved!);
      const reloaded = render(multi, { draftKey: freshKey });
      expect(
        getButtonByText(reloaded, "Metrics").getAttribute("aria-pressed"),
      ).toBe("true");
      fireEvent.click(getButtonByText(reloaded, "Next"));
      expect(reloaded.getByLabelText("Database answer")).toHaveProperty(
        "value",
        "  DuckDB\nwith extensions  ",
      );
      reloaded.unmount();
      window.localStorage.removeItem(`bb.question-draft.v1:${freshKey}`);
    } finally {
      if (original === null) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, original);
    }
  });

  it.each(["submit", "cancel"] as const)(
    "retains drafts on failed %s and clears them only after success",
    async (action) => {
      const draftKey = `thr_draft:pint_${action}`;
      const storageKey = `bb.question-draft.v1:${draftKey}`;
      const original = window.localStorage.getItem(storageKey);
      try {
        const handler = vi.fn<() => Promise<void>>(async () => {
          throw new Error("offline");
        });
        const slot = render(singleSelect, { draftKey, [action]: handler });
        fireEvent.click(getButtonByText(slot, "SQLite"));
        const buttonLabel = action === "submit" ? "Submit answer" : "Cancel";
        await act(async () =>
          fireEvent.click(getButtonByText(slot, buttonLabel)),
        );
        slot.unmount();
        let finish: () => void = () => {};
        handler.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        );
        const restored = render(singleSelect, { draftKey, [action]: handler });
        expect(
          getButtonByText(restored, "SQLite").getAttribute("aria-pressed"),
        ).toBe("true");
        fireEvent.click(getButtonByText(restored, buttonLabel));
        expect(window.localStorage.getItem(storageKey)).not.toBeNull();
        restored.unmount();
        await act(async () => finish());
        expect(window.localStorage.getItem(storageKey)).toBeNull();
        const cleared = render(singleSelect, { draftKey });
        expect(
          getButtonByText(cleared, "SQLite").getAttribute("aria-pressed"),
        ).toBe("false");
        cleared.unmount();
      } finally {
        if (original === null) window.localStorage.removeItem(storageKey);
        else window.localStorage.setItem(storageKey, original);
      }
    },
  );

  it("advances and submits multiple questions entirely by keyboard", () => {
    const submit = vi.fn(async () => undefined);
    const slot = render(multi, { submit });
    fireEvent.keyDown(document.body, { key: "1" });
    fireEvent.keyDown(document.activeElement!, { key: "2" });
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(slot.getByText("2 of 2")).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: "2" });
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      answers: {
        q0: { selected: ["q0o0", "q0o1"] },
        q1: { selected: ["q1o1"] },
      },
    });
  });

  it("keeps several options selected and walks both questions before submitting", () => {
    const submit = vi.fn<(value: InteractionResponse) => Promise<void>>(
      async () => undefined,
    );
    const slot = render(multi, { submit });

    expect(slot.getByText("1 of 2")).toBeTruthy();
    fireEvent.click(getButtonByText(slot, "Metrics"));
    fireEvent.click(getButtonByText(slot, "Tracing"));
    fireEvent.click(getButtonByText(slot, "Next"));

    expect(slot.getByText("2 of 2")).toBeTruthy();
    fireEvent.click(getButtonByText(slot, "Postgres"));
    fireEvent.click(getButtonByText(slot, "Submit answer"));

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toEqual({
      answers: {
        q0: { selected: ["q0o0", "q0o1"] },
        q1: { selected: ["q1o0"] },
      },
    } satisfies InteractionResponse);
  });

  it("cancels the request instead of submitting", () => {
    const cancel = vi.fn(async () => undefined);
    const slot = render(multi, { cancel });

    fireEvent.click(getButtonByText(slot, "Cancel"));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
