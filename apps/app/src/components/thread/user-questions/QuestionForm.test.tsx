// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render as renderReact,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { QuestionForm } from "@bb/shared-ui/question-form";
import type {
  Question,
  QuestionAnswer,
} from "@bb/shared-ui/question-form-state";
import { ThreadQuestionFormHost } from "./ThreadQuestionFormHost";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
type InteractionPayload = { questions: Question[] };
type InteractionResponse = { answers: Record<string, QuestionAnswer> };

vi.mock("@/hooks/useVoiceInput", () => ({ useVoiceInput: vi.fn() }));

vi.mock(
  "@/hooks/queries/system-queries",
  () => import("@/test/question-shortcuts-system-queries-mock"),
);
vi.mock("@/lib/bb-desktop", () => ({ getBbDesktopInfo: () => null }));
const pane = vi.hoisted(() => ({ isFocused: true }));
vi.mock("@/views/thread-detail/PaneContext", () => ({
  useOptionalPaneContext: () => pane,
}));

beforeEach(() => {
  pane.isFocused = true;
  vi.mocked(useVoiceInput).mockReturnValue({
    state: "idle",
    microphoneWarning: null,
    isSupported: true,
    unsupportedReason: null,
    stream: null,
    isRecording: false,
    isProcessing: false,
    isListening: false,
    delivery: "insert",
    failedRecordings: [],
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    retry: vi.fn(),
    discard: vi.fn(),
    download: vi.fn(),
    cancel: vi.fn(),
  });
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
      required: true,
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
    density?: "default" | "compact";
    promptShownAbove?: string;
    closeInline?: () => void;
  } = {},
) {
  return renderReact(
    <AppCommandProvider>
      <ThreadQuestionFormHost
        density={handlers.density ?? "default"}
        promptShownAbove={handlers.promptShownAbove ?? null}
        closeInline={handlers.closeInline ?? null}
      >
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

  it("does not intercept modified Enter other than the submit shortcut", () => {
    const submit = vi.fn(async () => undefined);
    render(singleSelect, { submit });
    fireEvent.keyDown(document.body, { key: "2" });
    for (const modifier of ["shiftKey", "metaKey", "altKey", "isComposing"]) {
      fireEvent.keyDown(document.activeElement!, {
        key: "Enter",
        [modifier]: true,
      });
    }
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits free text with Enter like the composer, keeping Shift+Enter and IME Enter for the text (#3289)", () => {
    const submit = vi.fn(async () => undefined);
    const slot = render(singleSelect, { submit });
    fireEvent.keyDown(document.body, { key: "3" });
    const textarea = slot.getByLabelText("Database answer");
    expect(document.activeElement).toBe(textarea);
    fireEvent.change(textarea, { target: { value: "Custom" } });
    expect(fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })).toBe(
      true,
    );
    expect(
      fireEvent.keyDown(textarea, { key: "Enter", isComposing: true }),
    ).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      answers: { q0: { selected: [], freeText: "Custom" } },
    });
  });

  it("submits from the free-text field with the submit shortcut too", () => {
    const submit = vi.fn(async () => undefined);
    const slot = render(singleSelect, { submit });
    fireEvent.keyDown(document.body, { key: "3" });
    const textarea = slot.getByLabelText("Database answer");
    fireEvent.change(textarea, { target: { value: "Custom" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("leaves Enter in a touch keyboard's free-text field for newlines, like the composer", () => {
    vi.mocked(window.matchMedia).mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("pointer: coarse"),
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList,
    );
    const submit = vi.fn(async () => undefined);
    const slot = render(singleSelect, { submit });
    fireEvent.click(getButtonByText(slot, "Other…"));
    const textarea = slot.getByLabelText("Database answer");
    fireEvent.change(textarea, { target: { value: "Custom" } });
    expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });

  it("uses the compact labels when the host is compact", () => {
    const slot = render(singleSelect, { density: "compact" });
    expect(getButtonByText(slot, "Submit")).toBeTruthy();
    expect(slot.queryByText("Submit answer")).toBeNull();
  });

  it("closes the inline form on Cancel without cancelling the question", () => {
    const cancel = vi.fn(async () => undefined);
    const closeInline = vi.fn();
    const slot = render(singleSelect, {
      density: "compact",
      cancel,
      closeInline,
    });

    fireEvent.click(getButtonByText(slot, "Cancel"));

    expect(closeInline).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("hides the compact prompt only when the host already shows that text", () => {
    const prompt = "Which database should we use?";
    const shownAbove = render(singleSelect, {
      density: "compact",
      promptShownAbove: prompt,
    });
    expect(shownAbove.getAllByText(prompt)).toHaveLength(1);
    cleanup();

    const labelAbove = render(singleSelect, {
      density: "compact",
      promptShownAbove: "Database",
    });
    expect(labelAbove.getAllByText(prompt)).toHaveLength(2);
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
        required: true,
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
        required: true,
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

  it.each(["submit", "cancel"] as const)(
    "keeps answers on screen and locks the form after a successful %s",
    async (action) => {
      const draftKey = `thr_draft:pint_settled_${action}`;
      const storageKey = `bb.question-draft.v1:${draftKey}`;
      try {
        const slot = render(singleSelect, {
          draftKey,
          [action]: async () => {},
        });
        fireEvent.click(getButtonByText(slot, "SQLite"));
        const buttonLabel = action === "submit" ? "Submit answer" : "Cancel";
        await act(async () =>
          fireEvent.click(getButtonByText(slot, buttonLabel)),
        );
        expect(window.localStorage.getItem(storageKey)).toBeNull();
        expect(
          getButtonByText(slot, "SQLite").getAttribute("aria-pressed"),
        ).toBe("true");
        expect(getButtonByText(slot, "Submit answer").disabled).toBe(true);
        expect(getButtonByText(slot, "Cancel").disabled).toBe(true);
      } finally {
        window.localStorage.removeItem(storageKey);
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

  it("submits once every required question is answered, leaving a blank optional one out (#6131)", () => {
    const submit = vi.fn(async () => undefined);
    const slot = render(
      {
        questions: [
          multi.questions[1]!,
          {
            id: "notes",
            prompt: "Anything else?",
            shortLabel: "Notes",
            multiSelect: false,
            allowFreeText: true,
            options: [],
            required: false,
          },
        ],
      },
      { submit },
    );

    fireEvent.click(getButtonByText(slot, "Next"));
    expect(slot.getByText("Optional")).toBeTruthy();
    expect(getButtonByText(slot, "Submit answer").disabled).toBe(true);
    fireEvent.click(getButtonByText(slot, "Back"));
    fireEvent.click(getButtonByText(slot, "SQLite"));
    fireEvent.click(getButtonByText(slot, "Next"));
    fireEvent.click(getButtonByText(slot, "Submit answer"));

    expect(submit).toHaveBeenCalledExactlyOnceWith({
      answers: { q1: { selected: ["q1o1"] } },
    });
  });

  it("submits, switches questions, and cancels by keyboard with focus on an option button (#6321)", () => {
    const submit = vi.fn(async () => undefined);
    const cancel = vi.fn(async () => undefined);
    const slot = render(multi, { submit, cancel });
    const metrics = getButtonByText(slot, "Metrics");
    fireEvent.click(metrics);
    metrics.focus();

    fireEvent.keyDown(metrics, { key: "ArrowRight" });
    expect(slot.getByText("2 of 2")).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(slot.getByText("1 of 2")).toBeTruthy();

    fireEvent.keyDown(document.activeElement!, { key: "Enter", ctrlKey: true });
    expect(slot.getByText("2 of 2")).toBeTruthy();
    expect(
      getButtonByText(slot, "Submit answer").getAttribute("aria-keyshortcuts"),
    ).toBe("Control+Enter");
    const sqlite = getButtonByText(slot, "SQLite");
    fireEvent.click(sqlite);
    sqlite.focus();
    fireEvent.keyDown(sqlite, { key: "Enter", ctrlKey: true });
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      answers: {
        q0: { selected: ["q0o0"] },
        q1: { selected: ["q1o1"] },
      },
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("moves to the next question with Enter in a free-text field and keeps arrows for the text", () => {
    const slot = render(multi);
    fireEvent.click(getButtonByText(slot, "Other…"));
    const textarea = slot.getByLabelText("Extras answer");
    fireEvent.change(textarea, { target: { value: "Logs" } });
    expect(fireEvent.keyDown(textarea, { key: "ArrowRight" })).toBe(true);
    expect(slot.getByText("1 of 2")).toBeTruthy();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(slot.getByText("2 of 2")).toBeTruthy();
    expect(document.activeElement?.hasAttribute("data-question-form")).toBe(
      true,
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(slot.getByText("1 of 2")).toBeTruthy();
  });

  it("cancels with the cancel shortcut from the card and from its free-text field", () => {
    const cancel = vi.fn(async () => undefined);
    const slot = render(multi, { cancel });
    fireEvent.click(getButtonByText(slot, "Other…"));
    fireEvent.keyDown(slot.getByLabelText("Extras answer"), {
      key: ".",
      ctrlKey: true,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("leaves the shortcuts to other text fields while a question is open", () => {
    const submit = vi.fn(async () => undefined);
    const cancel = vi.fn(async () => undefined);
    const slot = render(multi, { submit, cancel });
    fireEvent.click(getButtonByText(slot, "Metrics"));
    const composer = document.createElement("textarea");
    document.body.append(composer);
    try {
      composer.focus();
      for (const key of ["Enter", "."]) {
        expect(fireEvent.keyDown(composer, { key, ctrlKey: true })).toBe(true);
      }
      expect(fireEvent.keyDown(composer, { key: "ArrowRight" })).toBe(true);
      expect(slot.getByText("1 of 2")).toBeTruthy();
      expect(cancel).not.toHaveBeenCalled();
      fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
      expect(slot.getByText("2 of 2")).toBeTruthy();
    } finally {
      composer.remove();
    }
  });

  it("cancels the request instead of submitting", () => {
    const cancel = vi.fn(async () => undefined);
    const slot = render(multi, { cancel });

    fireEvent.click(getButtonByText(slot, "Cancel"));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("question answer dictation", () => {
  it("appends a transcript to the latest edited answer without submitting", () => {
    const submit = vi.fn(async () => undefined);
    const slot = render(singleSelect, { submit });
    fireEvent.click(getButtonByText(slot, "Other…"));
    const input = slot.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Initial" } });
    const recording = vi.mocked(useVoiceInput).mock.calls.at(-1)?.[0];
    fireEvent.click(slot.getByRole("button", { name: "Start voice input" }));
    fireEvent.change(input, { target: { value: "Edited" } });
    act(() => recording?.onTranscript("dictated answer", "insert"));
    expect(input).toHaveProperty("value", "Edited dictated answer");
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(getButtonByText(slot, "Submit answer"));
    expect(submit).toHaveBeenCalledWith({
      answers: { q0: { selected: [], freeText: "Edited dictated answer" } },
    });
  });

  it("ignores late transcripts after the custom answer is closed", () => {
    const slot = render(singleSelect);
    fireEvent.click(getButtonByText(slot, "Other…"));
    fireEvent.change(slot.getByRole("textbox"), {
      target: { value: "Keep this" },
    });
    const recording = vi.mocked(useVoiceInput).mock.calls.at(-1)?.[0];
    fireEvent.click(getButtonByText(slot, "Postgres"));
    fireEvent.click(getButtonByText(slot, "Other…"));
    act(() => recording?.onTranscript("discard this", "insert"));
    expect(slot.getByRole("textbox")).toHaveProperty("value", "Keep this");
  });

  it("blocks navigation and submission while transcription is pending", () => {
    const idle = vi.mocked(useVoiceInput)({
      recordingKey: null,
      onTranscript: vi.fn(),
      onTranscribe: vi.fn(),
    });
    vi.mocked(useVoiceInput).mockReturnValue({
      ...idle,
      state: "transcribing",
      isProcessing: true,
      isListening: true,
    });
    const submit = vi.fn(async () => undefined);
    const slot = render(singleSelect, { submit });
    fireEvent.click(getButtonByText(slot, "Other…"));
    const input = slot.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Typed answer" } });
    expect(getButtonByText(slot, "Submit answer").disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(slot.getByRole("button", { name: "Cancel transcription" }));
    expect(idle.cancel).toHaveBeenCalledOnce();
  });
});

describe("question tabs on a narrow card", () => {
  const TAB_WIDTH = 60;
  const VIEWPORT_WIDTH = 150;
  const scrollLefts = new WeakMap<Element, number>();
  const stubbed: Array<[keyof HTMLElement, PropertyDescriptor | undefined]> =
    [];

  function isViewport(element: Element): boolean {
    return element.hasAttribute("data-question-tabs");
  }

  function tabIndex(element: Element): number | null {
    const parent = element.parentElement;
    if (!parent || !isViewport(parent)) return null;
    return Array.from(parent.children).indexOf(element);
  }

  function stub(name: keyof HTMLElement, descriptor: PropertyDescriptor) {
    stubbed.push([
      name,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
    ]);
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      ...descriptor,
    });
  }

  function stubGeometry(tabCount: number) {
    const scrollWidth = tabCount * TAB_WIDTH;
    const maxScrollLeft = Math.max(0, scrollWidth - VIEWPORT_WIDTH);
    stub("clientWidth", {
      get(this: HTMLElement) {
        return isViewport(this) ? VIEWPORT_WIDTH : 0;
      },
    });
    stub("scrollWidth", {
      get(this: HTMLElement) {
        return isViewport(this) ? Math.max(scrollWidth, VIEWPORT_WIDTH) : 0;
      },
    });
    stub("offsetWidth", {
      get(this: HTMLElement) {
        return tabIndex(this) === null ? 0 : TAB_WIDTH;
      },
    });
    stub("offsetLeft", {
      get(this: HTMLElement) {
        return (tabIndex(this) ?? 0) * TAB_WIDTH;
      },
    });
    stub("scrollLeft", {
      get(this: HTMLElement) {
        return scrollLefts.get(this) ?? 0;
      },
      set(this: HTMLElement, value: number) {
        scrollLefts.set(this, Math.min(Math.max(0, value), maxScrollLeft));
      },
    });
  }

  afterEach(() => {
    for (const [name, descriptor] of stubbed.splice(0).reverse()) {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, name, descriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, name);
      }
    }
  });

  function questionsFor(count: number): InteractionPayload {
    return {
      questions: Array.from({ length: count }, (_, index) => ({
        id: `q${index}`,
        prompt: `Question ${index + 1}?`,
        shortLabel: `Q${index + 1}`,
        multiSelect: false,
        allowFreeText: false,
        required: false,
        options: [{ value: `q${index}o0`, label: "Yes" }],
      })),
    };
  }

  function fades(slot: ReturnType<typeof render>) {
    const visible = (placement: string) =>
      slot.container
        .querySelector(`[data-overflow-fade="${placement}"]`)
        ?.classList.contains("opacity-100") ?? false;
    return { left: visible("left"), right: visible("right") };
  }

  function viewport(slot: ReturnType<typeof render>): HTMLElement {
    const element = slot.container.querySelector("[data-question-tabs]");
    if (!(element instanceof HTMLElement)) {
      throw new Error("question tabs are not rendered");
    }
    return element;
  }

  it("scrolls the current question's tab clear of the fade and fades only the edges with tabs past them", () => {
    stubGeometry(10);
    const slot = render(questionsFor(10));
    expect(viewport(slot).scrollLeft).toBe(0);
    expect(fades(slot)).toEqual({ left: false, right: true });

    fireEvent.click(getButtonByText(slot, "Q8"));
    expect(viewport(slot).scrollLeft).toBe(8 * TAB_WIDTH + 24 - VIEWPORT_WIDTH);
    expect(fades(slot)).toEqual({ left: true, right: true });

    fireEvent.click(getButtonByText(slot, "Next"));
    fireEvent.click(getButtonByText(slot, "Next"));
    expect(slot.getByText("10 of 10")).toBeTruthy();
    expect(viewport(slot).scrollLeft).toBe(10 * TAB_WIDTH - VIEWPORT_WIDTH);
    expect(fades(slot)).toEqual({ left: true, right: false });

    fireEvent.click(getButtonByText(slot, "Q1"));
    expect(viewport(slot).scrollLeft).toBe(0);
    expect(fades(slot)).toEqual({ left: false, right: true });
  });

  it("shows no fade when every tab fits", () => {
    stubGeometry(2);
    const slot = render(questionsFor(2));
    fireEvent.click(getButtonByText(slot, "Next"));
    expect(slot.getByText("2 of 2")).toBeTruthy();
    expect(fades(slot)).toEqual({ left: false, right: false });
  });
});
