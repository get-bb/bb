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
import { emptyPromptDraftState } from "@/lib/prompt-draft";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import { AUTOMATION_PROMPT_ACTION } from "./PromptBoxActionsMenu";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  PromptBoxInternal,
  suppressPromptEditorAnchorActivation,
  type PromptBoxAction,
  type PromptBoxHandle,
  type PromptVoiceConfig,
  type TypeaheadConfig,
} from "./PromptBoxInternal";
import type {
  PromptMentionSuggestion,
  ProviderCommandSuggestion,
} from "./mentions/types";

vi.mock("@/components/plugin/PluginComposerAccessories", () => ({
  PluginComposerAccessories: () => (
    <span data-testid="plugin-composer-accessories" />
  ),
}));

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
  AUTOMATION_PROMPT_ACTION,
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
  mentionTriggers,
  mentionSuggestions = [],
  onMentionQueryChange = () => {},
  commandSuggestions = [],
  onCommandQueryChange = () => {},
}: {
  mentionTriggers?: TypeaheadConfig["mention"]["triggers"];
  mentionSuggestions?: TypeaheadConfig["mention"]["suggestions"];
  onMentionQueryChange?: TypeaheadConfig["mention"]["onQueryChange"];
  commandSuggestions?: TypeaheadConfig["command"]["suggestions"];
  onCommandQueryChange?: (query: string | null) => void;
} = {}): TypeaheadConfig {
  return {
    mention: {
      triggers: mentionTriggers,
      suggestions: mentionSuggestions,
      isLoading: false,
      isError: false,
      onQueryChange: onMentionQueryChange,
    },
    command: {
      trigger: "/",
      suggestions: commandSuggestions,
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
        value,
      })}
      promptBoxRef={promptBoxRef}
    />
  );
}

function PromptBoxFocusOnMountHarness() {
  const promptBoxRef = useRef<PromptBoxHandle | null>(null);

  useLayoutEffect(() => {
    promptBoxRef.current?.focusEnd();
  }, []);

  return (
    <PromptBoxInternal
      {...createPromptBoxProps()}
      promptBoxRef={promptBoxRef}
    />
  );
}

function PromptBoxHistoryAutoFocusHarness({
  historyResetKey,
}: {
  historyResetKey: string | number;
}) {
  return (
    <>
      <button type="button">Outside focus target</button>
      <PromptBoxInternal
        {...createPromptBoxProps({
          history: {
            currentDraft: emptyPromptDraftState(),
            entries: [],
            onSelectEntry: vi.fn(),
            resetKey: historyResetKey,
          },
        })}
      />
    </>
  );
}

function PromptBoxHistoryAutoFocusAfterLayoutStealHarness({
  historyResetKey,
}: {
  historyResetKey: string | number;
}) {
  const outsideTargetRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    outsideTargetRef.current?.focus();
  }, [historyResetKey]);

  return (
    <>
      <PromptBoxInternal
        {...createPromptBoxProps({
          history: {
            currentDraft: emptyPromptDraftState(),
            entries: [],
            onSelectEntry: vi.fn(),
            resetKey: historyResetKey,
          },
        })}
      />
      <button ref={outsideTargetRef} type="button">
        Late layout focus target
      </button>
    </>
  );
}

function renderPromptBox(
  initialValue: string,
  options: {
    mentionTriggers?: TypeaheadConfig["mention"]["triggers"];
    mentionSuggestions?: TypeaheadConfig["mention"]["suggestions"];
    commandSuggestions?: TypeaheadConfig["command"]["suggestions"];
  } = {},
) {
  const changes: PromptChange[] = [];
  const onMentionQueryChange = vi.fn();
  const onCommandQueryChange = vi.fn();
  const promptBoxRef = createRef<PromptBoxHandle>();

  function PromptBoxHarness() {
    const [value, setValue] = useState(initialValue);
    const [mentionRanges, setMentionRanges] = useState<PromptTextMention[]>([]);
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
        typeahead={buildTypeaheadConfig({
          mentionTriggers: options.mentionTriggers,
          mentionSuggestions: options.mentionSuggestions,
          onMentionQueryChange,
          commandSuggestions: options.commandSuggestions,
          onCommandQueryChange,
        })}
        mentionMenuPlacement="bottom"
        attachments={{}}
        promptActions={promptActions}
        promptBoxRef={promptBoxRef}
      />
    );
  }

  render(<PromptBoxHarness />);
  return {
    changes,
    onMentionQueryChange,
    onCommandQueryChange,
    promptBoxRef,
  };
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
  // The prompt schedules passive autofocus on its first animation frame. Let
  // that settle before opening the portaled menu so the frame cannot move
  // focus back to the editor while the menu item is being selected.
  await waitFor(() =>
    expect(document.activeElement).toBe(getPromptEditorElement()),
  );
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  const trigger = screen.getByRole("button", { name: "Prompt actions" });
  fireEvent.pointerDown(trigger, { button: 0 });
  const menu = await screen.findByRole("menu", { name: "Prompt actions" });
  const menuItem = within(menu).getByRole("menuitem", { name: label });
  fireEvent.click(menuItem);
  // Radix removes the portaled menu asynchronously. Let that close settle so
  // a following test or second action cannot select an item from the stale
  // closing portal.
  await waitFor(() =>
    expect(screen.queryByRole("menu", { name: "Prompt actions" })).toBeNull(),
  );
  if (label !== "Attach files") {
    await waitFor(() =>
      expect(document.activeElement).toBe(getPromptEditorElement()),
    );
  }
}

async function selectCommandSuggestion(label: string) {
  const suggestion = await screen.findByRole("button", { name: label });
  fireEvent.mouseDown(suggestion, { button: 0 });
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
  pasteClipboard({ plainText: text });
}

function pasteClipboard({
  html = "",
  plainText = "",
}: {
  html?: string;
  plainText?: string;
}) {
  fireEvent.paste(getPromptEditorElement(), {
    clipboardData: {
      items: [],
      getData: (type: string) => {
        if (type === "text/html") return html;
        if (type === "text/plain") return plainText;
        return "";
      },
    },
  });
}

function mockPointerCoarse(matches: boolean): () => void {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  return () => {
    window.matchMedia = originalMatchMedia;
  };
}

afterEach(() => {
  cleanup();
  resetPluginLogoStoreForTest();
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
  it("suppresses and restores plugin accessories without remounting the editor", () => {
    const props = createPromptBoxProps({ value: "Retained draft" });
    const view = render(<PromptBoxInternal {...props} />);
    const editor = getPromptEditorElement();

    expect(screen.getByTestId("plugin-composer-accessories")).not.toBeNull();

    view.rerender(
      <PromptBoxInternal {...props} suppressPluginComposerAccessories />,
    );

    expect(screen.queryByTestId("plugin-composer-accessories")).toBeNull();
    expect(getPromptEditorElement()).toBe(editor);

    view.rerender(
      <PromptBoxInternal
        {...props}
        suppressPluginComposerAccessories={false}
      />,
    );

    expect(screen.getByTestId("plugin-composer-accessories")).not.toBeNull();
    expect(getPromptEditorElement()).toBe(editor);
  });

  it("decorates only draft text while shimmering and removes it when cleared", async () => {
    const props = createPromptBoxProps({ value: "Keep this draft readable" });
    const view = render(<PromptBoxInternal {...props} textEffect="shimmer" />);

    await waitFor(() => {
      expect(
        view.container.querySelector(".prompt-text-shimmer")?.textContent,
      ).toBe("Keep this draft readable");
    });
    expect(
      view.container
        .querySelector("[data-promptbox]")
        ?.classList.contains("prompt-text-shimmer"),
    ).toBe(false);

    view.rerender(<PromptBoxInternal {...props} textEffect={null} />);
    await waitFor(() => {
      expect(view.container.querySelector(".prompt-text-shimmer")).toBeNull();
    });
  });

  it("honors early focusEnd requests once the editor is ready", async () => {
    const restoreMatchMedia = mockPointerCoarse(false);
    try {
      render(<PromptBoxFocusOnMountHarness />);

      await waitForPromptFocus();
    } finally {
      restoreMatchMedia();
    }
  });

  it("skips passive autofocus on coarse pointers", async () => {
    const restoreMatchMedia = mockPointerCoarse(true);
    try {
      render(<PromptBoxInternal {...createPromptBoxProps()} />);

      await waitFor(() =>
        expect(getPromptEditorElement()).toBeInstanceOf(HTMLElement),
      );
      expect(document.activeElement).not.toBe(getPromptEditorElement());
    } finally {
      restoreMatchMedia();
    }
  });

  it("does not honor focus-end requests on coarse pointers", async () => {
    const restoreMatchMedia = mockPointerCoarse(true);
    try {
      const promptBoxRef = createRef<PromptBoxHandle>();
      const baseProps = createPromptBoxProps({
        focusEndKey: 0,
        promptBoxRef,
      });
      const view = render(<PromptBoxInternal {...baseProps} />);

      await waitFor(() => expect(promptBoxRef.current).not.toBeNull());
      const outsideTarget = document.createElement("button");
      document.body.append(outsideTarget);
      outsideTarget.focus();

      view.rerender(<PromptBoxInternal {...baseProps} focusEndKey={1} />);
      promptBoxRef.current?.focusEnd();

      expect(document.activeElement).toBe(outsideTarget);
      outsideTarget.remove();
    } finally {
      restoreMatchMedia();
    }
  });

  it("refocuses when the history reset key changes on fine pointers", async () => {
    const restoreMatchMedia = mockPointerCoarse(false);
    try {
      const view = render(
        <PromptBoxHistoryAutoFocusHarness historyResetKey={0} />,
      );

      await waitForPromptFocus();
      const outsideTarget = screen.getByRole("button", {
        name: "Outside focus target",
      });
      outsideTarget.focus();
      expect(document.activeElement).toBe(outsideTarget);

      view.rerender(<PromptBoxHistoryAutoFocusHarness historyResetKey={1} />);

      await waitForPromptFocus();
    } finally {
      restoreMatchMedia();
    }
  });

  it("refocuses after another layout effect steals focus", async () => {
    const restoreMatchMedia = mockPointerCoarse(false);
    try {
      const view = render(
        <PromptBoxHistoryAutoFocusAfterLayoutStealHarness
          historyResetKey={0}
        />,
      );

      await waitForPromptFocus();

      view.rerender(
        <PromptBoxHistoryAutoFocusAfterLayoutStealHarness
          historyResetKey={1}
        />,
      );

      await waitForPromptFocus();
    } finally {
      restoreMatchMedia();
    }
  });

  it("does not refocus for history reset key changes on coarse pointers", async () => {
    const restoreMatchMedia = mockPointerCoarse(true);
    try {
      const view = render(
        <PromptBoxHistoryAutoFocusHarness historyResetKey={0} />,
      );

      await waitFor(() =>
        expect(getPromptEditorElement()).toBeInstanceOf(HTMLElement),
      );
      const outsideTarget = screen.getByRole("button", {
        name: "Outside focus target",
      });
      outsideTarget.focus();
      expect(document.activeElement).toBe(outsideTarget);

      view.rerender(<PromptBoxHistoryAutoFocusHarness historyResetKey={1} />);

      expect(document.activeElement).toBe(outsideTarget);
    } finally {
      restoreMatchMedia();
    }
  });

  it("applies an added quote before focus-end insertion can edit the old document", () => {
    const onChange = vi.fn();
    const view = render(<PromptBoxRaceHarness onChange={onChange} value="" />);

    view.rerender(
      <PromptBoxRaceHarness onChange={onChange} value={"> selected text\n"} />,
    );

    expect(onChange).toHaveBeenLastCalledWith("> selected text\n\nreply", []);
  });

  it("places focus-end insertion below an added quote", async () => {
    const onChange = vi.fn();
    const promptBoxRef = createRef<PromptBoxHandle>();
    const baseProps = createPromptBoxProps({
      onChange,
      promptBoxRef,
      value: "",
      focusEndKey: 0,
    });
    const view = render(<PromptBoxInternal {...baseProps} />);

    view.rerender(
      <PromptBoxInternal
        {...baseProps}
        value={"> selected text\n"}
        focusEndKey={1}
      />,
    );

    await waitForPromptFocus();
    await act(async () => {
      promptBoxRef.current?.insertTextAtCursor("reply");
    });

    expect(onChange).toHaveBeenLastCalledWith("> selected text\n\nreply", []);
  });
});

describe("PromptBoxInternal zen mode layout", () => {
  it("animates the prompt box height when toggling zen mode", async () => {
    const storageKey = "bb.test.promptbox.zen-height-animation";
    window.localStorage.removeItem(storageKey);

    render(
      <PromptBoxInternal
        {...createPromptBoxProps({
          zenMode: { storageKey },
        })}
      />,
    );

    const form = document.querySelector("[data-promptbox]");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Prompt box form was not rendered");
    }

    vi.spyOn(form, "getBoundingClientRect")
      .mockReturnValueOnce(new DOMRect(0, 0, 320, 96))
      .mockReturnValueOnce(new DOMRect(0, 0, 320, 512))
      .mockReturnValue(new DOMRect(0, 0, 320, 512));

    expect(
      screen.queryByRole("button", { name: "Make prompt box smaller" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Make prompt box larger" }),
    );

    await waitFor(() => {
      expect(form.style.transition).toContain("height 240ms");
      expect(form.style.height).toBe("512px");
    });
    expect(
      screen.getByRole("button", { name: "Make prompt box smaller" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Make prompt box larger" }),
    ).toBeNull();

    fireEvent.transitionEnd(form, { propertyName: "height" });
    window.localStorage.removeItem(storageKey);
  });

  it("keeps long editor content constrained to the scroll area", async () => {
    const storageKey = "bb.test.promptbox.zen-layout";
    window.localStorage.removeItem(storageKey);

    render(
      <PromptBoxInternal
        {...createPromptBoxProps({
          value: Array.from(
            { length: 40 },
            (_, index) => `Line ${index + 1}`,
          ).join("\n"),
          promptActions,
          zenMode: { storageKey },
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Make prompt box larger" }),
    );

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

    const footerRow = screen.getByRole("button", { name: "Prompt actions" })
      .parentElement?.parentElement;
    expect(footerRow?.classList.contains("shrink-0")).toBe(true);

    window.localStorage.removeItem(storageKey);
  });
});

describe("PromptBoxInternal compact layout", () => {
  it("publishes the container-compact placeholder for CSS", () => {
    const baseProps = createPromptBoxProps();
    const view = render(
      <PromptBoxInternal
        {...baseProps}
        containerCompactPlaceholder="Reconnecting..."
      />,
    );
    const form = document.querySelector("[data-promptbox]");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Prompt box form was not rendered");
    }

    expect(
      form.style.getPropertyValue("--promptbox-container-compact-placeholder"),
    ).toBe('"Reconnecting..."');

    view.rerender(<PromptBoxInternal {...baseProps} />);
    expect(
      form.style.getPropertyValue("--promptbox-container-compact-placeholder"),
    ).toBe("");
  });

  it("animates between compact and full layouts", async () => {
    const promptBoxRef = createRef<PromptBoxHandle>();
    const baseProps = createPromptBoxProps({ promptBoxRef });
    const view = render(
      <PromptBoxInternal
        {...baseProps}
        compact={{ isCompact: true, placeholder: "Ask a follow-up" }}
      />,
    );
    const form = document.querySelector("[data-promptbox]");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Prompt box form was not rendered");
    }
    vi.spyOn(form, "getBoundingClientRect")
      .mockReturnValueOnce(new DOMRect(0, 0, 320, 48))
      .mockReturnValueOnce(new DOMRect(0, 0, 320, 144))
      .mockReturnValue(new DOMRect(0, 0, 320, 144));

    act(() => promptBoxRef.current?.captureHeightForLayoutChange());
    view.rerender(
      <PromptBoxInternal
        {...baseProps}
        compact={{ isCompact: false, placeholder: "Ask a follow-up" }}
      />,
    );

    await waitFor(() => {
      expect(form.style.transition).toContain("height 240ms");
      expect(form.style.height).toBe("144px");
      expect(form.style.overflow).toBe("hidden");
    });
    fireEvent.transitionEnd(form, { propertyName: "height" });
    expect(form.style.overflow).toBe("");
  });

  it("animates an externally driven layout change", async () => {
    const promptBoxRef = createRef<PromptBoxHandle>();
    const baseProps = createPromptBoxProps({ promptBoxRef });
    const view = render(
      <PromptBoxInternal {...baseProps} heightAnimationKey="compact" />,
    );
    const form = document.querySelector("[data-promptbox]");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Prompt box form was not rendered");
    }
    vi.spyOn(form, "getBoundingClientRect")
      .mockReturnValueOnce(new DOMRect(0, 0, 320, 48))
      .mockReturnValueOnce(new DOMRect(0, 0, 320, 144))
      .mockReturnValue(new DOMRect(0, 0, 320, 144));

    act(() => promptBoxRef.current?.captureHeightForLayoutChange());
    view.rerender(
      <PromptBoxInternal {...baseProps} heightAnimationKey="expanded" />,
    );

    await waitFor(() => {
      expect(form.style.transition).toContain("height 240ms");
      expect(form.style.height).toBe("144px");
    });
    fireEvent.transitionEnd(form, { propertyName: "height" });
  });

  it("skips an external layout animation when the height did not change", () => {
    const promptBoxRef = createRef<PromptBoxHandle>();
    const baseProps = createPromptBoxProps({ promptBoxRef });
    const view = render(
      <PromptBoxInternal {...baseProps} heightAnimationKey="compact" />,
    );
    const form = document.querySelector("[data-promptbox]");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Prompt box form was not rendered");
    }
    vi.spyOn(form, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 320, 144),
    );

    act(() => promptBoxRef.current?.captureHeightForLayoutChange());
    view.rerender(
      <PromptBoxInternal {...baseProps} heightAnimationKey="expanded" />,
    );

    expect(form.style.transition).toBe("");
    expect(form.style.height).toBe("");
  });

  it("keeps only the one-line editor and primary action", () => {
    const voice: PromptVoiceConfig = {
      state: "idle",
      isSupported: true,
      stream: null,
      start: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
    };

    render(
      <PromptBoxInternal
        {...createPromptBoxProps({
          value:
            "A compact follow-up that is much wider than the available mobile space\nA hidden second line",
          attachments: { onAttachFiles: vi.fn() },
          footerStart: <button type="button">Model selector</button>,
          compact: {
            isCompact: true,
            placeholder: "Ask a follow-up",
          },
          promptActions,
          voice,
        })}
      />,
    );

    const form = document.querySelector("[data-promptbox]");
    expect(form?.getAttribute("data-promptbox-compact")).toBe("");
    const submitButton = screen.getByRole("button", {
      name: "Submit (Enter)",
    });
    expect(submitButton.classList.contains("size-8")).toBe(true);
    expect(submitButton.classList.contains("p-0")).toBe(true);
    expect(submitButton.classList.contains("ml-1")).toBe(false);
    expect(submitButton.classList.contains("transition-colors")).toBe(true);
    expect(submitButton.classList.contains("transition-all")).toBe(false);
    expect(screen.queryByRole("button", { name: "Prompt actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Model selector" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Attach files" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Start voice input" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Make prompt box/u }),
    ).toBeNull();
    expect(getPromptEditorElement().getAttribute("data-placeholder")).toBe(
      "Ask a follow-up",
    );
    const compactContent = document.querySelector(
      "[data-promptbox-compact-content]",
    );
    expect(compactContent).toBeTruthy();
    expect(compactContent?.classList.contains("items-center")).toBe(true);
    expect(
      document
        .querySelector("[data-promptbox-editor-scroll]")
        ?.classList.contains("pt-0"),
    ).toBe(true);
  });

  it("keeps all Markdown and mention text in the navigable preview", async () => {
    const mentionToken =
      "@apps/app/src/components/promptbox/PromptBoxInternal.tsx";
    const value = [
      `> Review ${mentionToken} with the rest of this long quoted request`,
      "> Then verify the hidden continuation",
      "A hidden paragraph after the quote",
    ].join("\n");
    const mentionStart = value.indexOf(mentionToken);

    render(
      <PromptBoxInternal
        {...createPromptBoxProps({
          value,
          mentionRanges: [
            {
              start: mentionStart,
              end: mentionStart + mentionToken.length,
              resource: {
                kind: "path",
                source: "workspace",
                entryKind: "file",
                path: "apps/app/src/components/promptbox/PromptBoxInternal.tsx",
                label: "PromptBoxInternal.tsx",
              },
            },
          ],
          compact: {
            isCompact: true,
            placeholder: "Ask a follow-up",
          },
        })}
      />,
    );

    const compactContent = document.querySelector(
      "[data-promptbox-compact-content]",
    );
    const editor = getPromptEditorElement();
    expect(compactContent?.contains(editor)).toBe(true);
    expect(editor.firstElementChild?.tagName).toBe("BLOCKQUOTE");
    await waitFor(() =>
      expect(editor.querySelector(".prompt-mention-pill")).toBeTruthy(),
    );
    expect(editor.querySelector("br")).toBeTruthy();
    expect(editor.children.length).toBeGreaterThan(1);
    expect(editor.textContent).toContain("A hidden paragraph after the quote");
  });

  it("anchors only the primary action during a container-driven reveal", () => {
    render(
      <PromptBoxInternal
        {...createPromptBoxProps({
          voice: {
            state: "idle",
            isSupported: true,
            stream: null,
            start: vi.fn(),
            stop: vi.fn(),
            cancel: vi.fn(),
          },
        })}
      />,
    );

    const submitGroup = document.querySelector("[data-promptbox-submit-group]");
    const submit = screen.getByRole("button", { name: "Submit (Enter)" });
    const voice = screen.getByRole("button", { name: "Start voice input" });

    expect(submitGroup?.contains(submit)).toBe(true);
    expect(submitGroup?.contains(voice)).toBe(false);
  });

  it("does not expose zen controls in the full mobile layout", () => {
    render(
      <PromptBoxInternal
        {...createPromptBoxProps({
          attachments: { onAttachFiles: vi.fn() },
          compact: { isCompact: false },
          promptActions,
        })}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Make prompt box/u }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Prompt actions" })).toBeTruthy();
  });
});

describe("PromptBoxInternal mention triggers", () => {
  const githubIssueSuggestion: PromptMentionSuggestion = {
    kind: "plugin",
    pluginId: "github",
    providerId: "issue",
    itemId: "issue:owner/repo#42",
    providerLabel: "GitHub issues",
    title: "#42 Fix login bug",
    subtitle: "owner/repo",
    icon: null,
    replacement: "#42 Fix login bug",
  };

  it("renders a plugin mention's named icon hint", async () => {
    const suggestion = { ...githubIssueSuggestion, icon: "FileText" };
    const { promptBoxRef } = renderPromptBox("@fix", {
      mentionSuggestions: [suggestion],
    });

    await focusPromptEnd(promptBoxRef);
    const row = await screen.findByRole("button", { name: /Fix login bug/u });
    expect(row.querySelector('[data-icon="FileText"]')).not.toBeNull();
  });

  it("keeps a plugin mention's named icon hint in the inserted pill", async () => {
    setPluginLogoUrls(new Map());
    const suggestion = { ...githubIssueSuggestion, icon: "FileText" };
    const { promptBoxRef } = renderPromptBox("@fix", {
      mentionSuggestions: [suggestion],
    });

    await focusPromptEnd(promptBoxRef);
    fireEvent.mouseDown(
      await screen.findByRole("button", { name: /Fix login bug/u }),
      { button: 0 },
    );

    await waitFor(() =>
      expect(
        getPromptEditorElement().querySelector('[data-icon="FileText"]'),
      ).not.toBeNull(),
    );
  });

  it("reports hash mention queries with the active trigger", async () => {
    const { onMentionQueryChange, promptBoxRef } = renderPromptBox("#42", {
      mentionTriggers: ["@", "#"],
    });

    await focusPromptEnd(promptBoxRef);

    await waitFor(() =>
      expect(onMentionQueryChange).toHaveBeenCalledWith("42", "#"),
    );
  });

  it("does not open the menu for a bare non-at mention trigger", async () => {
    const { onMentionQueryChange, promptBoxRef } = renderPromptBox("#", {
      mentionTriggers: ["@", "#"],
      mentionSuggestions: [githubIssueSuggestion],
    });

    await focusPromptEnd(promptBoxRef);

    await waitFor(() =>
      expect(onMentionQueryChange).toHaveBeenCalledWith("", "#"),
    );
    expect(screen.queryByText("GitHub issues")).toBeNull();
  });

  it("inserts hash-triggered plugin mentions without duplicating the prefix", async () => {
    setPluginLogoUrls(
      new Map([
        [
          "github",
          {
            icon: null,
            compactIconUrl: null,
            logoUrl: "/api/v1/plugins/github/assets/logo?h=abc",
            logoDarkUrl: null,
          },
        ],
      ]),
    );
    const { changes, promptBoxRef } = renderPromptBox("#42", {
      mentionTriggers: ["@", "#"],
      mentionSuggestions: [githubIssueSuggestion],
    });

    await focusPromptEnd(promptBoxRef);
    const suggestion = await screen.findByRole("button", {
      name: /#42 Fix login bug/u,
    });
    fireEvent.mouseDown(suggestion, { button: 0 });

    await waitFor(() =>
      expect(latestValue(changes)).toBe("#42 Fix login bug "),
    );
    expect(latestChange(changes)?.mentions).toEqual([
      {
        start: 0,
        end: "#42 Fix login bug".length,
        resource: {
          kind: "plugin",
          pluginId: "github",
          icon: null,
          itemId: "issue:owner/repo#42",
          label: "#42 Fix login bug",
        },
      },
    ]);
    const promptEditor = getPromptEditorElement();
    expect(promptEditor.querySelector('[data-icon="Zap"]')).toBeTruthy();
    expect(promptEditor.querySelector("img")).toBeNull();
  });

  it("keeps path-first mention results in keyboard navigation order", async () => {
    const pathSuggestion: PromptMentionSuggestion = {
      kind: "path",
      source: "workspace",
      entryKind: "file",
      path: "src/app.ts",
      name: "app.ts",
      replacement: "src/app.ts",
    };
    const threadSuggestion: PromptMentionSuggestion = {
      kind: "thread",
      path: "thread:thr_app",
      replacement: "thread:thr_app",
      projectId: "proj_app",
      projectName: "App",
      threadId: "thr_app",
      title: "App thread",
    };
    const { promptBoxRef } = renderPromptBox("@src/", {
      mentionSuggestions: [pathSuggestion, threadSuggestion],
    });

    await focusPromptEnd(promptBoxRef);
    const workspaceLabel = await screen.findByText("Workspace");
    const menu = workspaceLabel.closest(".overflow-hidden");
    if (!(menu instanceof HTMLElement)) {
      throw new Error("Expected mention menu");
    }
    const [pathButton, threadButton] = within(menu).getAllByRole("button");
    expect(pathButton.textContent).toContain("app.ts");
    expect(threadButton.textContent).toContain("App thread");
    expect(pathButton.className).toContain("bg-state-active");

    fireEvent.keyDown(getPromptEditorElement(), { key: "ArrowDown" });

    await waitFor(() =>
      expect(threadButton.className).toContain("bg-state-active"),
    );
  });
});

describe("PromptBoxInternal prompt actions", () => {
  it("preserves blockquote structure when pasting copied blockquote html", async () => {
    const { changes, promptBoxRef } = renderPromptBox("");

    await focusPromptEnd(promptBoxRef);
    pasteClipboard({
      html: "<blockquote><p>quoted</p></blockquote>",
      plainText: "> quoted",
    });

    await waitFor(() => expect(latestValue(changes)).toBe("> quoted"));
    expect(getPromptEditorElement().querySelector("blockquote")).not.toBeNull();
  });

  it("opens the file picker from the prompt actions menu", async () => {
    const onAttachFiles = vi.fn();
    render(
      <PromptBoxInternal
        {...createPromptBoxProps({
          attachments: { onAttachFiles },
          promptActions,
        })}
      />,
    );

    const attachmentInput = document.querySelector('input[type="file"]');
    if (!(attachmentInput instanceof HTMLInputElement)) {
      throw new Error("Attachment input was not rendered");
    }
    const clickFileInput = vi
      .spyOn(attachmentInput, "click")
      .mockImplementation(() => {});

    await selectPromptAction("Attach files");

    expect(clickFileInput).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole("menu", { name: "Prompt actions" })).toBeNull(),
    );
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

  it("inserts automation mode as a command pill", async () => {
    const { changes, promptBoxRef } = renderPromptBox("");

    await focusPromptEnd(promptBoxRef);
    await selectPromptAction("Automation");

    await waitFor(() => expect(latestValue(changes)).toBe("/automation "));
    expect(latestChange(changes)?.mentions).toEqual([
      {
        start: 0,
        end: "/automation".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "automation",
          source: "command",
          origin: "user",
          label: "automation",
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

  it("pastes prompt action command tokens as goal, plan, and automation pills", async () => {
    const { changes, promptBoxRef } = renderPromptBox("");
    const text =
      "/plan inspect first\n/goal finish the change\n/automation keep checking";

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
      {
        start: "/plan inspect first\n/goal finish the change\n".length,
        end: "/plan inspect first\n/goal finish the change\n/automation".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "automation",
          source: "command",
          origin: "user",
          label: "automation",
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

  it("replaces a just-selected goal action with automation at the cursor", async () => {
    const { changes, promptBoxRef } = renderPromptBox("");

    await focusPromptEnd(promptBoxRef);
    await selectPromptAction("Goal");
    await waitFor(() => expect(latestValue(changes)).toBe("/goal "));
    await waitForPromptFocus();

    await selectPromptAction("Automation");

    await waitFor(() => expect(latestValue(changes)).toBe("/automation "));
    expect(latestChange(changes)?.mentions).toEqual([
      {
        start: 0,
        end: "/automation".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "automation",
          source: "command",
          origin: "user",
          label: "automation",
          argumentHint: null,
        },
      },
    ]);
  });

  it("selects automation from slash typeahead as a command pill", async () => {
    const { changes, promptBoxRef } = renderPromptBox("/auto", {
      commandSuggestions: [
        {
          kind: "command",
          name: "automation",
          source: "command",
          origin: "user",
          description: null,
          argumentHint: null,
        },
      ],
    });

    await focusPromptEnd(promptBoxRef);
    await selectCommandSuggestion("automation");

    await waitFor(() => expect(latestValue(changes)).toBe("/automation "));
    expect(latestChange(changes)?.mentions).toEqual([
      {
        start: 0,
        end: "/automation".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "automation",
          source: "command",
          origin: "user",
          label: "automation",
          argumentHint: null,
        },
      },
    ]);
  });

  it("selects a slash typeahead command as a command pill", async () => {
    const { changes, promptBoxRef } = renderPromptBox("/re", {
      commandSuggestions: [
        {
          kind: "command",
          name: "review",
          source: "command",
          origin: "user",
          description: null,
          argumentHint: null,
        },
      ],
    });

    await focusPromptEnd(promptBoxRef);
    await selectCommandSuggestion("review");

    await waitFor(() => expect(latestValue(changes)).toBe("/review "));
    expect(latestChange(changes)?.mentions).toEqual([
      {
        start: 0,
        end: "/review".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "review",
          source: "command",
          origin: "user",
          label: "review",
          argumentHint: null,
        },
      },
    ]);
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

describe("PromptBoxInternal command typeahead submit", () => {
  const compactSuggestion: ProviderCommandSuggestion = {
    kind: "command",
    name: "compact",
    source: "command",
    origin: "builtin",
    description: "Compact context",
    argumentHint: null,
  };
  const userSkillSuggestion: ProviderCommandSuggestion = {
    kind: "command",
    name: "review",
    source: "skill",
    origin: "user",
    description: "Review a PR",
    argumentHint: null,
  };

  function renderCommandPromptBox(suggestion: ProviderCommandSuggestion) {
    const onSubmit = vi.fn();
    const changes: PromptChange[] = [];
    const promptBoxRef = createRef<PromptBoxHandle>();

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
            changes.push({ mentions: nextMentions, value: nextValue });
            setValue(nextValue);
            setMentionRanges(nextMentions);
          }}
          onSubmit={onSubmit}
          typeahead={{
            mention: {
              suggestions: [],
              isLoading: false,
              isError: false,
              onQueryChange: () => {},
            },
            command: {
              trigger: "/",
              suggestions: [suggestion],
              isLoading: false,
              isError: false,
              hasMore: false,
              isLoadingMore: false,
              loadMore: () => {},
              onQueryChange: () => {},
            },
          }}
          mentionMenuPlacement="bottom"
          promptBoxRef={promptBoxRef}
        />
      );
    }

    render(<Harness />);
    return { changes, onSubmit, promptBoxRef };
  }

  async function openCommandMenu(
    promptBoxRef: RefObject<PromptBoxHandle | null>,
    token: string,
    name: string,
  ) {
    await focusPromptEnd(promptBoxRef);
    await act(async () => {
      promptBoxRef.current?.insertTextAtCursor(token);
    });
    await act(async () => {});
    await waitFor(() => expect(screen.queryByText(name)).not.toBeNull());
  }

  it("submits when a built-in command is selected with Enter", async () => {
    const { changes, onSubmit, promptBoxRef } =
      renderCommandPromptBox(compactSuggestion);
    await openCommandMenu(promptBoxRef, "/compact", "compact");

    await act(async () => {
      fireEvent.keyDown(getPromptEditorElement(), { key: "Enter" });
    });
    await act(async () => {});

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // The command mention is applied (and therefore submitted), not left as
    // bare text — Codex reads the mention to trigger compaction and Claude
    // sends the `/compact` text as-is.
    expect(latestChange(changes)?.mentions).toEqual([
      {
        start: 0,
        end: "/compact".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "compact",
          source: "command",
          origin: "builtin",
          label: "compact",
          argumentHint: null,
        },
      },
    ]);
  });

  it("does not submit when a non-built-in command is selected with Enter", async () => {
    const { changes, onSubmit, promptBoxRef } =
      renderCommandPromptBox(userSkillSuggestion);
    await openCommandMenu(promptBoxRef, "/review", "review");

    await act(async () => {
      fireEvent.keyDown(getPromptEditorElement(), { key: "Enter" });
    });
    await act(async () => {});

    expect(onSubmit).not.toHaveBeenCalled();
    // The pill is still inserted so the user can add arguments before sending.
    expect(latestChange(changes)?.mentions?.[0]?.resource).toMatchObject({
      name: "review",
      origin: "user",
    });
  });

  it("does not submit when a built-in command is selected with Tab", async () => {
    const { onSubmit, promptBoxRef } =
      renderCommandPromptBox(compactSuggestion);
    await openCommandMenu(promptBoxRef, "/compact", "compact");

    await act(async () => {
      fireEvent.keyDown(getPromptEditorElement(), { key: "Tab" });
    });
    await act(async () => {});

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("PromptBoxInternal command typeahead navigation", () => {
  it("uses the rendered section order for Arrow keys and Enter", async () => {
    const { changes, promptBoxRef } = renderPromptBox("/", {
      commandSuggestions: [
        {
          kind: "command",
          name: "plan",
          source: "command",
          origin: "user",
          description: null,
          argumentHint: null,
        },
        {
          kind: "command",
          name: "review",
          source: "skill",
          origin: "user",
          description: null,
          argumentHint: null,
        },
        {
          kind: "command",
          name: "compact",
          source: "command",
          origin: "builtin",
          description: null,
          argumentHint: null,
        },
        {
          kind: "command",
          name: "interview",
          source: "command",
          origin: "user",
          description: null,
          argumentHint: null,
        },
        {
          kind: "command",
          name: "deploy",
          source: "command",
          origin: "project",
          description: null,
          argumentHint: null,
        },
      ],
    });

    await focusPromptEnd(promptBoxRef);
    const sectionLabel = await screen.findByText("Commands");
    const menu = sectionLabel.closest(".overflow-hidden");
    if (!(menu instanceof HTMLElement)) {
      throw new Error("Expected command menu");
    }
    const buttons = within(menu).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "compact",
      "review",
      "deploy",
      "plan",
      "interview",
    ]);

    const editor = getPromptEditorElement();
    for (const name of ["compact", "review", "deploy", "plan", "interview"]) {
      const button = within(menu).getByRole("button", { name });
      await waitFor(() =>
        expect(button.className).toContain("bg-state-active"),
      );
      if (name !== "interview") {
        fireEvent.keyDown(editor, { key: "ArrowDown" });
      }
    }
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => expect(latestValue(changes)).toBe("/interview "));
    expect(latestChange(changes)?.mentions[0]?.resource).toMatchObject({
      kind: "command",
      name: "interview",
    });
  });
});

describe("voice recording escape", () => {
  function voiceConfig(
    overrides: Partial<PromptVoiceConfig> = {},
  ): PromptVoiceConfig {
    return {
      state: "recording",
      isSupported: true,
      stream: null,
      start: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
      ...overrides,
    };
  }

  function pressEscape(): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.body.dispatchEvent(event);
    });
    return event;
  }

  it("cancels the recording on Escape and consumes the event before the composer's dismiss", () => {
    const cancel = vi.fn();
    render(
      <PromptBoxInternal
        {...createPromptBoxProps({ voice: voiceConfig({ cancel }) })}
      />,
    );

    // Stand in for the composer's own bubble-phase Escape-to-dismiss listener.
    const dismiss = vi.fn();
    const onWindowEscape = (event: Event) => {
      if ((event as KeyboardEvent).key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onWindowEscape);
    const event = pressEscape();
    window.removeEventListener("keydown", onWindowEscape);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("cancels on Escape while transcribing too", () => {
    const cancel = vi.fn();
    render(
      <PromptBoxInternal
        {...createPromptBoxProps({
          voice: voiceConfig({ state: "transcribing", cancel }),
        })}
      />,
    );

    expect(pressEscape().defaultPrevented).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape alone when not recording", () => {
    const cancel = vi.fn();
    render(
      <PromptBoxInternal
        {...createPromptBoxProps({
          voice: voiceConfig({ state: "idle", cancel }),
        })}
      />,
    );

    expect(pressEscape().defaultPrevented).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });
});
