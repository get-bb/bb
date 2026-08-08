// @vitest-environment jsdom

// ProseMirror reads `navigator` once, while its module loads, to set
// `browser.safari` and `browser.ios`. The sibling suite mocks `navigator` per
// test, which lands too late to turn those flags on. So this file claims the
// iPad identity in a hoisted block, before any import runs, and it is the only
// suite that exercises ProseMirror's real iOS Enter path.
import { vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(navigator, "vendor", {
    configurable: true,
    value: "Apple Computer, Inc.",
  });
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) " +
      "AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  });
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 5,
  });
});

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  PromptBoxInternal,
} from "./PromptBoxInternal";

// ProseMirror waits this long before it replays a swallowed iOS Enter.
const IOS_ENTER_REPLAY_MS = 200;

function getPromptEditorElement(): HTMLElement {
  const editorElement = document.querySelector(".ProseMirror");
  if (!(editorElement instanceof HTMLElement)) {
    throw new Error("Prompt editor element was not rendered");
  }
  return editorElement;
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
});

describe("PromptBoxInternal on a real iPadOS ProseMirror build", () => {
  it("submits a Magic Keyboard Enter once, with no replayed second submit", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <PromptBoxInternal
        value="Run this"
        mentionRanges={[]}
        onChange={onChange}
        onSubmit={onSubmit}
        mentionMenuPlacement="bottom"
        typeahead={{
          mention: {
            suggestions: [],
            isLoading: false,
            isError: false,
            onQueryChange: vi.fn(),
          },
          command: INERT_TYPEAHEAD_COMMAND_CONFIG,
        }}
      />,
    );

    fireEvent.keyDown(getPromptEditorElement(), {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
    });

    expect(onSubmit).toHaveBeenCalledOnce();

    // The hook handles the event, so ProseMirror never arms its iOS fallback.
    // If it ever does, the replay would submit a second time.
    act(() => {
      vi.advanceTimersByTime(IOS_ENTER_REPLAY_MS * 2);
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("turns a software-keyboard Return into a newline through the iOS replay", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <PromptBoxInternal
        value="First line"
        mentionRanges={[]}
        onChange={onChange}
        onSubmit={onSubmit}
        mentionMenuPlacement="bottom"
        typeahead={{
          mention: {
            suggestions: [],
            isLoading: false,
            isError: false,
            onQueryChange: vi.fn(),
          },
          command: INERT_TYPEAHEAD_COMMAND_CONFIG,
        }}
      />,
    );

    // The iPad software keyboard reports an empty `code`, so the hook declines
    // the event and ProseMirror swallows it into its 200 ms fallback.
    fireEvent.keyDown(getPromptEditorElement(), {
      key: "Enter",
      code: "",
      keyCode: 13,
    });

    // Nothing has happened yet. That delay is itself the proof that
    // ProseMirror's iOS branch is live in this suite: off that branch,
    // ProseMirror would have inserted the newline synchronously.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(IOS_ENTER_REPLAY_MS + 50);
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith("First line\n", []);
  });
});
