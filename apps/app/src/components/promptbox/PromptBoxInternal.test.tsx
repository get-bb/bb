// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PromptBoxInternal,
  type PromptBoxAction,
  type TypeaheadConfig,
} from "./PromptBoxInternal";

interface PromptChange {
  value: string;
}

const promptActions: readonly PromptBoxAction[] = [
  { kind: "skills", text: "$" },
  { kind: "plan", text: "/plan " },
  { kind: "goal", text: "/goal " },
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
      suggestions: [
        {
          kind: "command",
          name: "plan",
          source: "skill",
          origin: "user",
          description: null,
          argumentHint: null,
        },
      ],
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

  function PromptBoxHarness() {
    const [value, setValue] = useState(initialValue);
    return (
      <PromptBoxInternal
        value={value}
        mentionRanges={[]}
        onChange={(nextValue) => {
          changes.push({ value: nextValue });
          setValue(nextValue);
        }}
        onSubmit={() => {}}
        typeahead={buildTypeaheadConfig({ onCommandQueryChange })}
        mentionMenuPlacement="bottom"
        attachments={{}}
        promptActions={promptActions}
      />
    );
  }

  render(<PromptBoxHarness />);
  return { changes, onCommandQueryChange };
}

async function selectPromptAction(label: string) {
  const trigger = screen.getByRole("button", { name: "Prompt actions" });
  fireEvent.pointerDown(trigger, { button: 0 });
  const menuItem = await screen.findByRole("menuitem", { name: label });
  fireEvent.click(menuItem);
}

function latestValue(changes: readonly PromptChange[]): string | undefined {
  return changes[changes.length - 1]?.value;
}

afterEach(cleanup);

describe("PromptBoxInternal prompt actions", () => {
  it("inserts the skills trigger with no trailing space", async () => {
    const { changes, onCommandQueryChange } = renderPromptBox("");

    await selectPromptAction("Skills");

    await waitFor(() => expect(latestValue(changes)).toBe("$"));
    expect(onCommandQueryChange).toHaveBeenCalledWith("");
  });

  it("does not duplicate the skills trigger when it is already active", async () => {
    const { changes } = renderPromptBox("$");

    await selectPromptAction("Skills");

    expect(changes).toHaveLength(0);
  });

  it("replaces an active skills command token with plan mode", async () => {
    const { changes } = renderPromptBox("Start $");

    await selectPromptAction("Plan");

    await waitFor(() => expect(latestValue(changes)).toBe("Start /plan "));
  });

  it("replaces an active partial skills command token with plan mode", async () => {
    const { changes } = renderPromptBox("Start $pl");

    await selectPromptAction("Plan");

    await waitFor(() => expect(latestValue(changes)).toBe("Start /plan "));
  });

  it("does not duplicate command text immediately before the cursor", async () => {
    const { changes } = renderPromptBox("Start /goal ");

    await selectPromptAction("Goal");

    expect(changes).toHaveLength(0);
  });
});
