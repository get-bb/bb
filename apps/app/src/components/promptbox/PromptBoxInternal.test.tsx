// @vitest-environment jsdom

import type { PromptTextMention } from "@bb/domain";
import {
  createRef,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CREATE_LOOP_PROMPT } from "./PromptBoxActionsMenu";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  PromptBoxInternal,
  suppressPromptEditorAnchorActivation,
  type PromptBoxAction,
  type PromptBoxHandle,
  type TypeaheadConfig,
} from "./PromptBoxInternal";

type PromptBoxProps = ComponentProps<typeof PromptBoxInternal>;

interface PromptChange {
  mentions: PromptTextMention[];
  value: string;
}

const promptActions: readonly PromptBoxAction[] = [
  { kind: "skills", text: "/" },
  {
    kind: "plan",
    command: { trigger: "/", name: "plan", trailingText: " " },
    text: "/plan ",
  },
  {
    kind: "goal",
    command: { trigger: "/", name: "goal", trailingText: " " },
    text: "/goal ",
  },
  { kind: "loop", text: CREATE_LOOP_PROMPT },
];

function createPromptBoxProps(
  overrides: Partial<PromptBoxProps> = {},
): PromptBoxProps {
  return {
    value: "",
    mentionRanges: [],
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    mentionMenuPlacement: "bottom",
    typeahead: {
      mention: {
        suggestions: [],
        isLoading: false,
        isError: false,
        onQueryChange: vi.fn(),
      },
      command: INERT_TYPEAHEAD_COMMAND_CONFIG,
    },
    ...overrides,
  };
}

function buildTypeaheadConfig({
  onCommandQueryChange = () => {},
}: {
  onCommandQueryChange?: (query: string | null) => void;
} = {}): TypeaheadConfig {
  return {
    mention: {
      suggestions: [],
      isLoading: false,
      isError: false,
      onQueryChange: () => {},
    },
    command: {
      trigger: "/",
      suggestions: [],
      isLoading: false,
      isError: false,
      hasMore: false,
      isLoadingMore: false,
      loadMore: () => {},
      onQueryChange: onCommandQueryChange,
    },
  };
}

function PromptBoxRaceHarness({
  onChange,
  value,
}: {
  onChange: PromptBoxProps["onChange"];
  value: string;
}) {
  const promptBoxRef = useRef<PromptBoxHandle | null>(null);
  const insertedForValueRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (value === "" || insertedForValueRef.current === value) return;

    insertedForValueRef.current = value;
    promptBoxRef.current?.focusEnd();
    promptBoxRef.current?.insertTextAtCursor("reply");
  }, [value]);

  return (
    <PromptBoxInternal
      {...createPromptBoxProps({
        onChange,
        promptBoxRef,
        value,
      })}
    />
  );
}

function renderPromptBox(initialValue: string) {
  const changes: PromptChange[] = [];
  const onCommandQueryChange = vi.fn();
  const promptBoxRef = createRef<PromptBoxHandle>();

  function PromptBoxHarness() {
    const [value, setValue] = useState(initialValue);
    const [mentionRanges, setMentionRanges] = useState<PromptTextMention[]>(
      [],
    );
    return (
      <PromptBoxInternal
        value={value}
        mentionRanges={mentionRanges}
        onChange={(nextValue, nextMentions) => {
          changes.push({ mentions: nextMentions, value: nextValue });
          setValue(nextValue);
          setMentionRanges(nextMentions);
        }}
        onSubmit={() => {}}
        typeahead={buildTypeaheadConfig({ onCommandQueryChange })}
        mentionMenuPlacement="bottom"
        attachments={{}}
        promptActions={promptActions}
        promptBoxRef={promptBoxRef}
      />
    );
  }

  render(<PromptBoxHarness />);
  return { changes, onCommandQueryChange, promptBoxRef };
}

function dispatchThroughEditorTarget({
  eventName,
  target,
}: {
  eventName: "auxclick" | "click";
  target: HTMLElement;
}) {
  const editorRoot = document.createElement("div");
  editorRoot.append(target);
  document.body.append(editorRoot);

  let suppressed = false;
  editorRoot.addEventListener(eventName, (event) => {
    suppressed = suppressPromptEditorAnchorActivation(event);
  });

  const event = new MouseEvent(eventName, {
    bubbles: true,
    cancelable: true,
  });
  const defaultAllowed = target.dispatchEvent(event);

  editorRoot.remove();
  return { defaultAllowed, event, suppressed };
}

async function selectPromptAction(label: string) {
  const trigger = screen.getByRole("button", { name: "Prompt actions" });
  fireEvent.pointerDown(trigger, { button: 0 });
  const menu = await screen.findByRole("menu", { name: "Prompt actions" });
  const menuItem = within(menu).getByRole("menuitem", { name: label });
  fireEvent.click(menuItem);
}

function getPromptEditorElement(): HTMLElement {
  const editorElement = document.querySelector(".ProseMirror");
  if (!(editorElement instanceof HTMLElement)) {
    throw new Error("Prompt editor element was not rendered");
  }
  return editorElement;
}

function latestValue(changes: readonly PromptChange[]): string | undefined {
  return changes[changes.length - 1]?.value;
}

function latestChange(
  changes: readonly PromptChange[],
): PromptChange | undefined {
  return changes[changes.length - 1];
}

async function waitForPromptFocus() {
  await waitFor(() =>
    expect(document.activeElement).toBe(getPromptEditorElement()),
  );
}

async function focusPromptEnd(promptBoxRef: RefObject<PromptBoxHandle | null>) {
  await waitFor(() => expect(promptBoxRef.current).not.toBeNull());
  await act(async () => {
    promptBoxRef.current?.focusEnd();
  });
}

function pastePlainText(text: string) {
  fireEvent.paste(getPromptEditorElement(), {
    clipboardData: {
      items: [],
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("suppressPromptEditorAnchorActivation", () => {
  it("cancels anchor clicks inside the prompt editor", () => {
    const anchor = document.createElement("a");
    anchor.href = "https://example.com";
    anchor.textContent = "https://example.com";

    const result = dispatchThroughEditorTarget({
      eventName: "click",
      target: anchor,
    });

    expect(result.suppressed).toBe(true);
    expect(result.event.defaultPrevented).toBe(true);
    expect(result.defaultAllowed).toBe(false);
  });

  it("cancels auxiliary anchor clicks inside the prompt editor", () => {
    const anchor = document.createElement("a");
    anchor.href = "https://example.com";
    anchor.textContent = "https://example.com";

    const result = dispatchThroughEditorTarget({
      eventName: "auxclick",
      target: anchor,
    });

    expect(result.suppressed).toBe(true);
    expect(result.event.defaultPrevented).toBe(true);
    expect(result.defaultAllowed).toBe(false);
  });

  it("does not cancel ordinary prompt editor clicks", () => {
    const span = document.createElement("span");
    span.textContent = "plain prompt text";

    const result = dispatchThroughEditorTarget({
      eventName: "click",
      target: span,
    });

    expect(result.suppressed).toBe(false);
    expect(result.event.defaultPrevented).toBe(false);
    expect(result.defaultAllowed).toBe(true);
  });
});

describe("PromptBoxInternal controlled value sync", () => {
  it("applies an added quote before focus-end insertion can edit the old document", () => {
    const onChange = vi.fn();
    const view = render(
      <PromptBoxRaceHarness onChange={onChange} value="" />,
    );

    view.rerender(
      <PromptBoxRaceHarness onChange={onChange} value={"> selected text\n"} />,
    );

    expect(onChange).toHaveBeenLastCalledWith(
      "> selected text\n\nreply",
      [],
    );
  });
});

describe("PromptBoxInternal zen mode layout", () => {
  it("keeps long editor content constrained to the scroll area", async () => {
    const storageKey = "bb.test.promptbox.zen-layout";
    window.localStorage.removeItem(storageKey);

    render(
      <PromptBoxInternal
        {...createPromptBoxProps({
          value: Array.from({ length: 40 }, (_, index) => `Line ${index + 1}`)
            .join("\n"),
          zenMode: { storageKey },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Enter zen mode" }));

    await waitFor(() => {
      const scrollContainer = document.querySelector(
        "[data-promptbox-editor-scroll]",
      );
      if (!(scrollContainer instanceof HTMLElement)) {
        throw new Error("Prompt editor scroll container was not rendered");
      }

      expect(scrollContainer.classList.contains("min-h-0")).toBe(true);
      expect(scrollContainer.parentElement?.classList.contains("min-h-0")).toBe(
        true,
      );
    });

    const footerRow =
      screen.getByRole("button", { name: "Attach files" }).parentElement
        ?.parentElement;
    expect(footerRow?.classList.contains("shrink-0")).toBe(true);

    window.localStorage.removeItem(storageKey);
  });
});

describe("PromptBoxInternal prompt actions", () => {
  it("places prompt actions before the right-side action cluster", () => {
    renderPromptBox("");

    const promptActionsButton = screen.getByRole("button", {
      name: "Prompt actions",
    });
    const attachButton = screen.getByRole("button", { name: "Attach files" });

    expect(
      promptActionsButton.compareDocumentPosition(attachButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("inserts the skills trigger with no trailing space", async () => {
    const { changes, onCommandQueryChange } = renderPromptBox("");

    await selectPromptAction("Skills");

    await waitFor(() => expect(latestValue(changes)).toBe("/"));
    await waitFor(() =>
      expect(document.activeElement).toBe(getPromptEditorElement()),
    );
    expect(onCommandQueryChange).toHaveBeenCalledWith("");
  });

  it("does not duplicate the skills trigger when it is already active", async () => {
    const { changes } = renderPromptBox("/");

    await selectPromptAction("Skills");

    expect(changes).toHaveLength(0);
  });

  it("replaces an active skills command token with plan mode", async () => {
    const { changes, promptBoxRef } = renderPromptBox("Start /");

    await focusPromptEnd(promptBoxRef);
    await selectPromptAction("Plan");

    await waitFor(() => expect(latestValue(changes)).toBe("Start /plan "));
    expect(latestChange(changes)?.mentions).toEqual([
      {
        start: "Start ".length,
        end: "Start /plan".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "plan",
          source: "command",
          origin: "user",
          label: "plan",
          argumentHint: null,
        },
      },
    ]);
  });

  it("replaces an active partial skills command token with plan mode", async () => {
    const { changes, promptBoxRef } = renderPromptBox("Start /pl");

    await focusPromptEnd(promptBoxRef);
    await selectPromptAction("Plan");

    await waitFor(() => expect(latestValue(changes)).toBe("Start /plan "));
    expect(latestChange(changes)?.mentions).toEqual([
      {
        start: "Start ".length,
        end: "Start /plan".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "plan",
          source: "command",
          origin: "user",
          label: "plan",
          argumentHint: null,
        },
      },
    ]);
  });

  it.each([
    ["Start /", "Plan", "Start /plan "],
    ["Start /p", "Plan", "Start /plan "],
    ["Start /g", "Goal", "Start /goal "],
  ])(
    "replaces an active partial slash token %s with %s",
    async (initialValue, actionLabel, expectedValue) => {
      const { changes, promptBoxRef } = renderPromptBox(initialValue);

      await focusPromptEnd(promptBoxRef);
      await selectPromptAction(actionLabel);

      await waitFor(() => expect(latestValue(changes)).toBe(expectedValue));
    },
  );

  it("inserts goal mode as a command pill", async () => {
    const { changes, promptBoxRef } = renderPromptBox("");

    await focusPromptEnd(promptBoxRef);
    await selectPromptAction("Goal");

    await waitFor(() => expect(latestValue(changes)).toBe("/goal "));
    await waitFor(() =>
      expect(document.querySelector('[data-icon="Target"]')).not.toBeNull(),
    );
    expect(latestChange(changes)?.mentions).toEqual([
      {
        start: 0,
        end: "/goal".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "goal",
          source: "command",
          origin: "user",
          label: "goal",
          argumentHint: null,
        },
      },
    ]);
  });

  it("inserts loop creation prompt as plain text", async () => {
    const { changes, promptBoxRef } = renderPromptBox("");

    await focusPromptEnd(promptBoxRef);
    await selectPromptAction("Loop");

    await waitFor(() => expect(latestValue(changes)).toBe(CREATE_LOOP_PROMPT));
    expect(latestChange(changes)?.mentions).toEqual([]);
  });

  it("does not duplicate command text immediately before the cursor", async () => {
    const { changes, promptBoxRef } = renderPromptBox("Start /goal ");

    await focusPromptEnd(promptBoxRef);
    await selectPromptAction("Goal");

    expect(changes).toHaveLength(0);
  });

  it("replaces a just-selected plan action with goal at the cursor", async () => {
    const { changes, promptBoxRef } = renderPromptBox("");

    await focusPromptEnd(promptBoxRef);
    await selectPromptAction("Plan");
    await waitFor(() => expect(latestValue(changes)).toBe("/plan "));
    await waitForPromptFocus();

    await selectPromptAction("Goal");

    await waitFor(() => expect(latestValue(changes)).toBe("/goal "));
    expect(latestChange(changes)?.mentions).toEqual([
      {
        start: 0,
        end: "/goal".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "goal",
          source: "command",
          origin: "user",
          label: "goal",
          argumentHint: null,
        },
      },
    ]);
  });

  it("replaces a just-selected skills trigger with plan at the cursor", async () => {
    const { changes, promptBoxRef } = renderPromptBox("");

    await focusPromptEnd(promptBoxRef);
    await selectPromptAction("Skills");
    await waitFor(() => expect(latestValue(changes)).toBe("/"));
    await waitForPromptFocus();

    await selectPromptAction("Plan");

    await waitFor(() => expect(latestValue(changes)).toBe("/plan "));
    expect(latestChange(changes)?.mentions).toEqual([
      {
        start: 0,
        end: "/plan".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "plan",
          source: "command",
          origin: "user",
          label: "plan",
          argumentHint: null,
        },
      },
    ]);
  });

  it("pastes prompt action command tokens as goal and plan pills", async () => {
    const { changes, promptBoxRef } = renderPromptBox("");
    const text = "/plan inspect first\n/goal finish the change";

    await focusPromptEnd(promptBoxRef);
    pastePlainText(text);

    await waitFor(() => expect(latestValue(changes)).toBe(text));
    expect(latestChange(changes)?.mentions).toEqual([
      {
        start: 0,
        end: "/plan".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "plan",
          source: "command",
          origin: "user",
          label: "plan",
          argumentHint: null,
        },
      },
      {
        start: "/plan inspect first\n".length,
        end: "/plan inspect first\n/goal".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "goal",
          source: "command",
          origin: "user",
          label: "goal",
          argumentHint: null,
        },
      },
    ]);
  });

  it("replaces a just-selected goal action with skills at the cursor", async () => {
    const { changes, promptBoxRef } = renderPromptBox("");

    await focusPromptEnd(promptBoxRef);
    await selectPromptAction("Goal");
    await waitFor(() => expect(latestValue(changes)).toBe("/goal "));
    await waitForPromptFocus();

    await selectPromptAction("Skills");

    await waitFor(() => expect(latestValue(changes)).toBe("/"));
    expect(latestChange(changes)?.mentions).toEqual([]);
  });

  it("replaces a just-selected goal action with loop at the cursor", async () => {
    const { changes, promptBoxRef } = renderPromptBox("");

    await focusPromptEnd(promptBoxRef);
    await selectPromptAction("Goal");
    await waitFor(() => expect(latestValue(changes)).toBe("/goal "));
    await waitForPromptFocus();

    await selectPromptAction("Loop");

    await waitFor(() => expect(latestValue(changes)).toBe(CREATE_LOOP_PROMPT));
    expect(latestChange(changes)?.mentions).toEqual([]);
  });

  it("keeps typed content after a prompt action when selecting another action", async () => {
    const { changes, promptBoxRef } = renderPromptBox("");

    await focusPromptEnd(promptBoxRef);
    await selectPromptAction("Plan");
    await waitFor(() => expect(latestValue(changes)).toBe("/plan "));
    await waitForPromptFocus();

    await act(async () => {
      promptBoxRef.current?.insertTextAtCursor("clean up");
    });
    await waitFor(() => expect(latestValue(changes)).toBe("/plan clean up"));

    await selectPromptAction("Goal");

    await waitFor(() => expect(latestValue(changes)).toContain("clean up"));
    expect(latestValue(changes)).not.toBe("/goal ");
  });
});
