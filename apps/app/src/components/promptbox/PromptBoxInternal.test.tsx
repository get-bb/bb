// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import {
  useLayoutEffect,
  useRef,
  type ComponentProps,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  PromptBoxInternal,
  suppressPromptEditorAnchorActivation,
  type PromptBoxHandle,
} from "./PromptBoxInternal";

type PromptBoxProps = ComponentProps<typeof PromptBoxInternal>;

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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
      "> selected text\nreply",
      [],
    );
  });
});
