// @vitest-environment jsdom
import {
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
  } = {},
) {
  return renderReact(
    <AppCommandProvider>
      <ThreadQuestionFormHost>
        <QuestionForm
          questions={payload.questions}
          disabled={false}
          cancelDisabled={false}
          onSubmit={(answers) => {
            void handlers.submit?.({ answers });
          }}
          onCancel={() => {
            void handlers.cancel?.();
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
