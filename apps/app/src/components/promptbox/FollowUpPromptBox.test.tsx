// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POINTER_COARSE_QUERY } from "@/components/ui/hooks/use-pointer-coarse";
import { restoreMatchMedia, setupMatchMedia } from "@/test/helpers/match-media";
import {
  FollowUpPromptBox,
  type FollowUpPromptBoxProps,
} from "./FollowUpPromptBox";

function makeFollowUpPromptBoxProps(): FollowUpPromptBoxProps {
  return {
    attachments: {},
    stack: null,
    composer: {
      history: {
        currentDraft: { text: "", mentions: [], attachments: [] },
        entries: [],
        onSelectEntry: vi.fn(),
      },
      isFollowUpSubmitting: false,
      message: "Please continue",
      mentionRanges: [],
      onChangeMessage: vi.fn(),
      onModifierSubmit: vi.fn(),
      onSubmit: vi.fn(),
      promptPlaceholder: "Stopping thread...",
      canModifierSubmit: false,
      submitMode: { kind: "blocked", reason: "stopping" },
      threadRuntimeDisplayStatus: "active",
    },
    environmentSummary: null,
    contextWindowUsage: null,
    execution: {
      provider: {},
      model: {
        selected: "gpt-5",
        options: [],
        onChange: vi.fn(),
      },
      reasoning: {
        value: "medium",
        options: [],
        onChange: vi.fn(),
      },
    },
    permission: {
      value: "full",
      options: [],
      onChange: vi.fn(),
      supported: false,
    },
    typeahead: {
      mention: {
        suggestions: [],
        isLoading: false,
        isError: false,
        onQueryChange: vi.fn(),
      },
      command: {
        trigger: null,
        suggestions: [],
        isLoading: false,
        isError: false,
        onQueryChange: vi.fn(),
      },
    },
    zenModeResetKey: "thread-1",
  };
}

afterEach(() => {
  cleanup();
  restoreMatchMedia();
});

function setupCoarsePointerViewport(): void {
  setupMatchMedia({
    matchesByQuery: new Map([[POINTER_COARSE_QUERY, true]]),
  });
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

describe("FollowUpPromptBox", () => {
  it("does not autofocus the prompt editor on coarse pointer devices", async () => {
    setupCoarsePointerViewport();
    const props = makeFollowUpPromptBoxProps();
    props.composer = {
      ...props.composer,
      promptPlaceholder: "Ask for follow-up changes",
      submitMode: { kind: "ready" },
    };

    render(<FollowUpPromptBox {...props} />);

    const editor = screen.getByRole("textbox");
    await waitForAnimationFrame();

    expect(document.activeElement).not.toBe(editor);
  });

  it("focuses the composer when focusEndKey changes (edit message), even on coarse pointers", async () => {
    setupCoarsePointerViewport();
    const props = makeFollowUpPromptBoxProps();
    props.composer = {
      ...props.composer,
      message: "",
      promptPlaceholder: "Ask for follow-up changes",
      submitMode: { kind: "ready" },
    };
    props.focusEndKey = 0;

    const { rerender } = render(<FollowUpPromptBox {...props} />);
    const editor = screen.getByRole("textbox");
    await waitForAnimationFrame();
    // Coarse pointer suppresses the passive mount autofocus.
    expect(document.activeElement).not.toBe(editor);

    // Editing a queued message restores its text into the draft AND bumps
    // focusEndKey in the same commit; the composer focuses so the user can type.
    //
    // We assert only focus + content here — the two things jsdom can verify. The
    // caret landing at the END of the restored text is a real-browser ProseMirror
    // selection-mapping behaviour that jsdom does NOT reproduce (it always places
    // the caret at the end after setContent regardless of focus order), so an
    // offset assertion here would pass even with the bug. The end-caret guarantee
    // instead comes from the focus effect being declared after the content-sync
    // effect in PromptBoxInternal (so focus("end") runs post-setContent), and is
    // covered by manual QA.
    const restored = "Restored draft text";
    rerender(
      <FollowUpPromptBox
        {...props}
        composer={{ ...props.composer, message: restored }}
        focusEndKey={1}
      />,
    );
    await waitForAnimationFrame();

    expect(document.activeElement).toBe(editor);
    expect(editor.textContent).toContain(restored);
  });

  it("uses modifier submit with Cmd+Enter without invoking the normal submit", () => {
    const props = makeFollowUpPromptBoxProps();
    const onModifierSubmit = vi.fn();
    const onSubmit = vi.fn();
    props.composer = {
      ...props.composer,
      canModifierSubmit: true,
      onModifierSubmit,
      onSubmit,
      promptPlaceholder: "Ask for follow-up changes",
      submitMode: { kind: "queue", onStop: vi.fn() },
    };

    render(<FollowUpPromptBox {...props} />);

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    const wasNotCanceled = fireEvent.keyDown(textarea, {
      key: "Enter",
      metaKey: true,
    });

    expect(wasNotCanceled).toBe(false);
    expect(onModifierSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("uses the normal submit path for Cmd+Enter when modifier submit is unavailable", () => {
    const props = makeFollowUpPromptBoxProps();
    const onModifierSubmit = vi.fn();
    const onSubmit = vi.fn();
    props.composer = {
      ...props.composer,
      canModifierSubmit: false,
      onModifierSubmit,
      onSubmit,
      promptPlaceholder: "Ask for follow-up changes",
      submitMode: { kind: "ready" },
    };

    render(<FollowUpPromptBox {...props} />);

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    const wasNotCanceled = fireEvent.keyDown(textarea, {
      key: "Enter",
      metaKey: true,
    });

    expect(wasNotCanceled).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onModifierSubmit).not.toHaveBeenCalled();
  });

  it("renders only the stop action in stop-only mode", () => {
    const props = makeFollowUpPromptBoxProps();
    const onStop = vi.fn();
    const onSubmit = vi.fn();
    props.composer = {
      ...props.composer,
      onSubmit,
      promptPlaceholder: "Provisioning workspace...",
      submitMode: { kind: "stop-only", onStop },
      threadRuntimeDisplayStatus: "provisioning",
    };

    render(<FollowUpPromptBox {...props} />);

    expect(screen.queryByTitle("Submit (Enter)")).toBeNull();
    fireEvent.click(screen.getByTitle("Stop run"));

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders a disabled permission picker showing the locked mode when readOnly", () => {
    const props = makeFollowUpPromptBoxProps();
    const onChange = vi.fn();
    props.readOnly = true;
    props.permission = {
      value: "readonly",
      options: [
        { value: "full", label: "Full Access" },
        { value: "workspace-write", label: "Workspace Write" },
        { value: "readonly", label: "Readonly" },
      ],
      onChange,
      supported: true,
    };

    render(<FollowUpPromptBox {...props} />);

    // The SAME permission picker the main thread renders, but disabled: the
    // button is present, non-interactive, and shows the compact "Read" label —
    // identical to the interactive picker's label.
    const picker = screen.getByRole("button", { name: "Permission mode" });
    expect(picker.hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText("Read").length).toBeGreaterThan(0);

    fireEvent.click(picker);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("preserves ordinary Enter submit behavior", () => {
    const props = makeFollowUpPromptBoxProps();
    const onModifierSubmit = vi.fn();
    const onSubmit = vi.fn();
    props.composer = {
      ...props.composer,
      canModifierSubmit: true,
      onModifierSubmit,
      onSubmit,
      promptPlaceholder: "Ask for follow-up changes",
      submitMode: { kind: "queue", onStop: vi.fn() },
    };

    render(<FollowUpPromptBox {...props} />);

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    const wasNotCanceled = fireEvent.keyDown(textarea, { key: "Enter" });

    expect(wasNotCanceled).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onModifierSubmit).not.toHaveBeenCalled();
  });
});
