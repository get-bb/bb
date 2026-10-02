// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromptTextMention } from "@bb/domain";
import { EMPTY_ORDERED_MENTION_SUGGESTIONS } from "@bb/client-core";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  PromptBoxInternal,
  type PromptBoxHandle,
} from "./PromptBoxInternal";
import * as promptEditorEngine from "./editor/prompt-editor-engine";

const loaderState = vi.hoisted(() => ({
  resolve: null as null | ((engine: unknown) => void),
  engine: null as unknown,
}));

vi.mock("./editor/load-prompt-editor-engine", () => ({
  loadPromptEditorEngine: () =>
    new Promise((resolve) => {
      loaderState.resolve = resolve;
    }),
  peekPromptEditorEngine: () => loaderState.engine,
}));

function mentionTypeahead() {
  return {
    mention: {
      results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
      isLoading: false,
      isError: false,
      onQueryChange: vi.fn(),
    },
    command: INERT_TYPEAHEAD_COMMAND_CONFIG,
  };
}

function getFallbackTextarea(): HTMLTextAreaElement {
  const textarea = document.querySelector(
    "textarea[data-promptbox-fallback-textarea]",
  );
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error("Fallback composer textarea was not rendered");
  }
  return textarea;
}

function getPromptEditorElement(): HTMLElement {
  const editorElement = document.querySelector(".ProseMirror");
  if (!(editorElement instanceof HTMLElement)) {
    throw new Error("Prompt editor element was not rendered");
  }
  return editorElement;
}

afterEach(() => {
  cleanup();
  loaderState.resolve = null;
  loaderState.engine = null;
});

describe("PromptBoxInternal lazy editor engine", () => {
  it("keeps text typed in the fallback textarea and hands focus to the editor", async () => {
    function Harness() {
      const [value, setValue] = useState("");
      const [mentionRanges, setMentionRanges] = useState<PromptTextMention[]>(
        [],
      );
      return (
        <PromptBoxInternal
          value={value}
          mentionRanges={mentionRanges}
          onChange={(nextValue, nextMentions) => {
            setValue(nextValue);
            setMentionRanges(nextMentions);
          }}
          onSubmit={vi.fn()}
          mentionMenuPlacement="bottom"
          typeahead={mentionTypeahead()}
        />
      );
    }

    render(<Harness />);
    const textarea = getFallbackTextarea();
    textarea.focus();
    fireEvent.change(textarea, { target: { value: "hello" } });
    expect(textarea.value).toBe("hello");

    await act(async () => {
      loaderState.engine = promptEditorEngine;
      loaderState.resolve?.(promptEditorEngine);
    });

    const editor = await waitFor(() => getPromptEditorElement());
    await waitFor(() => expect(editor.textContent).toContain("hello"));
    await waitFor(() =>
      expect(
        document.activeElement === editor ||
          editor.contains(document.activeElement),
      ).toBe(true),
    );
  });

  it("renders no fallback textarea when the engine is already loaded", () => {
    loaderState.engine = promptEditorEngine;
    render(
      <PromptBoxInternal
        value=""
        mentionRanges={[]}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        mentionMenuPlacement="bottom"
        typeahead={mentionTypeahead()}
      />,
    );

    expect(
      document.querySelector("textarea[data-promptbox-fallback-textarea]"),
    ).toBeNull();
  });

  it("focuses the fallback textarea through focusEnd before the engine loads", async () => {
    loaderState.engine = null;
    const promptBoxRef = createRef<PromptBoxHandle>();
    render(
      <PromptBoxInternal
        value=""
        mentionRanges={[]}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        autoFocus={false}
        promptBoxRef={promptBoxRef}
        mentionMenuPlacement="bottom"
        typeahead={mentionTypeahead()}
      />,
    );

    await waitFor(() => expect(promptBoxRef.current).not.toBeNull());
    const textarea = getFallbackTextarea();
    act(() => {
      promptBoxRef.current?.focusEnd();
    });
    expect(document.activeElement).toBe(textarea);
  });
});
