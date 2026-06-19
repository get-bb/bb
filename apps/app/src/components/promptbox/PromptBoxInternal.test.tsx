// @vitest-environment jsdom

import type { PromptTextMention } from "@bb/domain";
import { createRef, useState, type RefObject } from "react";
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
import {
  PromptBoxInternal,
  type PromptBoxAction,
  type PromptBoxHandle,
  type TypeaheadConfig,
} from "./PromptBoxInternal";

interface PromptChange {
  mentions: PromptTextMention[];
  value: string;
}

const promptActions: readonly PromptBoxAction[] = [
  { kind: "skills", text: "$" },
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
];

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
      trigger: "$",
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

afterEach(cleanup);

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

    await waitFor(() => expect(latestValue(changes)).toBe("$"));
    await waitFor(() =>
      expect(document.activeElement).toBe(getPromptEditorElement()),
    );
    expect(onCommandQueryChange).toHaveBeenCalledWith("");
  });

  it("does not duplicate the skills trigger when it is already active", async () => {
    const { changes } = renderPromptBox("$");

    await selectPromptAction("Skills");

    expect(changes).toHaveLength(0);
  });

  it("replaces an active skills command token with plan mode", async () => {
    const { changes, promptBoxRef } = renderPromptBox("Start $");

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
    const { changes, promptBoxRef } = renderPromptBox("Start $pl");

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
    await waitFor(() => expect(latestValue(changes)).toBe("$"));
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

  it("replaces a just-selected goal action with skills at the cursor", async () => {
    const { changes, promptBoxRef } = renderPromptBox("");

    await focusPromptEnd(promptBoxRef);
    await selectPromptAction("Goal");
    await waitFor(() => expect(latestValue(changes)).toBe("/goal "));
    await waitForPromptFocus();

    await selectPromptAction("Skills");

    await waitFor(() => expect(latestValue(changes)).toBe("$"));
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
