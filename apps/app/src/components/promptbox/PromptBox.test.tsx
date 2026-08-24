// @vitest-environment jsdom

import type { PromptTextMention } from "@bb/domain";
import { createRef, useState, type RefObject } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptBox } from "./PromptBox";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  type PromptBoxHandle,
  type TypeaheadConfig,
} from "./PromptBoxInternal";

/**
 * First-focus handoff coverage (plan 008): the shell renders without the
 * tiptap editor; the first tap/paste/focus request realizes the editor and
 * every byte of input captured before the mount survives into it.
 */

function makeTypeahead(): TypeaheadConfig {
  return {
    mention: {
      suggestions: [],
      isLoading: false,
      isError: false,
      onQueryChange: vi.fn(),
    },
    command: INERT_TYPEAHEAD_COMMAND_CONFIG,
  };
}

interface HarnessProps {
  initialValue?: string;
  autoFocus?: boolean;
  focusEndKey?: string | number;
  onSubmit?: () => void;
  onChangeSpy?: (value: string, mentions: PromptTextMention[]) => void;
  onAttachFiles?: (files: File[]) => void;
  promptBoxRef?: RefObject<PromptBoxHandle | null>;
}

function ControlledPromptBox({
  initialValue = "",
  autoFocus = false,
  focusEndKey,
  onSubmit = () => {},
  onChangeSpy,
  onAttachFiles,
  promptBoxRef,
}: HarnessProps) {
  const [draft, setDraft] = useState<{
    value: string;
    mentions: PromptTextMention[];
  }>({ value: initialValue, mentions: [] });
  return (
    <PromptBox
      value={draft.value}
      mentionRanges={draft.mentions}
      onChange={(value, mentions) => {
        onChangeSpy?.(value, mentions);
        setDraft({ value, mentions });
      }}
      onSubmit={onSubmit}
      autoFocus={autoFocus}
      mentionMenuPlacement="bottom"
      typeahead={makeTypeahead()}
      {...(onAttachFiles ? { attachments: { items: [], onAttachFiles } } : {})}
      {...(promptBoxRef ? { promptBoxRef } : {})}
      {...(focusEndKey !== undefined ? { focusEndKey } : {})}
    />
  );
}

function queryMountedEditor(): HTMLElement | null {
  // The shell's preview is a contenteditable="false" .ProseMirror stand-in;
  // only the real tiptap editor is contenteditable="true".
  return document.querySelector<HTMLElement>(
    '.ProseMirror[contenteditable="true"]',
  );
}

function getInterimInput(): HTMLTextAreaElement {
  const interim = document.querySelector<HTMLTextAreaElement>(
    "[data-promptbox-interim-input]",
  );
  if (!interim) throw new Error("interim input not rendered");
  return interim;
}

async function waitForMountedEditor(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(queryMountedEditor()).not.toBeNull();
  });
  const editor = queryMountedEditor();
  if (!editor) throw new Error("editor did not mount");
  return editor;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PromptBox first-focus handoff", () => {
  it("parks the composer as a shell and mounts the editor on first tap with the draft intact", async () => {
    render(<ControlledPromptBox initialValue="Saved draft" />);

    // Shell state: the saved draft is visible immediately, no editor mounted.
    const preview = document.querySelector("[data-promptbox-shell-preview]");
    expect(preview).not.toBeNull();
    expect(preview?.textContent).toContain("Saved draft");
    expect(queryMountedEditor()).toBeNull();

    fireEvent.focus(getInterimInput());

    const editor = await waitForMountedEditor();
    expect(editor.textContent).toContain("Saved draft");
    expect(
      document.querySelector("[data-promptbox-shell-preview]"),
    ).toBeNull();
  });

  it("streams keystrokes typed before the mount into the draft and the editor", async () => {
    const onChangeSpy = vi.fn();
    render(<ControlledPromptBox onChangeSpy={onChangeSpy} />);

    const interim = getInterimInput();
    fireEvent.focus(interim);
    fireEvent.input(interim, { target: { value: "hi there" } });

    // The buffer flushes into the controlled draft on every input event.
    expect(onChangeSpy).toHaveBeenLastCalledWith("hi there", []);

    const editor = await waitForMountedEditor();
    expect(editor.textContent).toContain("hi there");
  });

  it("lands a text paste made before the mount in the editor after the mount", async () => {
    const onChangeSpy = vi.fn();
    render(<ControlledPromptBox onChangeSpy={onChangeSpy} />);

    const interim = getInterimInput();
    fireEvent.focus(interim);
    fireEvent.paste(interim, {
      clipboardData: {
        items: [],
        getData: (type: string) =>
          type === "text/plain" ? "pasted\r\nbefore mount" : "",
      },
    });

    expect(onChangeSpy).toHaveBeenLastCalledWith("pasted\nbefore mount", []);

    const editor = await waitForMountedEditor();
    expect(editor.textContent).toContain("pasted");
    expect(editor.textContent).toContain("before mount");
  });

  it("routes a file paste made before the mount to the attachments handler", () => {
    const onAttachFiles = vi.fn();
    render(<ControlledPromptBox onAttachFiles={onAttachFiles} />);

    const file = new File(["png-bytes"], "shot.png", { type: "image/png" });
    const interim = getInterimInput();
    fireEvent.focus(interim);
    fireEvent.paste(interim, {
      clipboardData: {
        items: [{ kind: "file", getAsFile: () => file }],
        getData: () => "",
      },
    });

    expect(onAttachFiles).toHaveBeenCalledWith([file]);
  });

  it("realizes the editor and moves focus into it for a programmatic focus request", async () => {
    const promptBoxRef = createRef<PromptBoxHandle | null>();
    render(<ControlledPromptBox promptBoxRef={promptBoxRef} />);
    expect(queryMountedEditor()).toBeNull();

    act(() => {
      promptBoxRef.current?.focusEnd();
    });

    const editor = await waitForMountedEditor();
    await waitFor(() => {
      expect(document.activeElement).toBe(editor);
    });
  });

  it("realizes the editor when focusEndKey changes (the thread view's focus bus)", async () => {
    const { rerender } = render(<ControlledPromptBox focusEndKey={0} />);
    expect(queryMountedEditor()).toBeNull();

    rerender(<ControlledPromptBox focusEndKey={1} />);

    await waitForMountedEditor();
  });

  it("realizes the editor on mount when autoFocus applies (fine pointer)", async () => {
    render(<ControlledPromptBox autoFocus />);

    await waitForMountedEditor();
  });

  it("submits on Enter from the interim surface before the editor exists", () => {
    const onSubmit = vi.fn();
    render(<ControlledPromptBox onSubmit={onSubmit} />);

    const interim = getInterimInput();
    fireEvent.focus(interim);
    fireEvent.input(interim, { target: { value: "ship it" } });
    fireEvent.keyDown(interim, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
