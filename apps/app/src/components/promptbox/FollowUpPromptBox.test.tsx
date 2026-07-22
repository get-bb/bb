// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  FollowUpPromptBox,
  type FollowUpSubmitMode,
} from "@/components/promptbox/FollowUpPromptBox";

const mocks = vi.hoisted(() => {
  const values = {
    executionControls: vi.fn(),
    isCompactViewport: false,
    isPointerCoarse: false,
    scrollToBottom: vi.fn(),
    permissionModePicker: vi.fn(),
  };
  return Object.assign(values, {});
});
let resizeObserverCallback: ResizeObserverCallback | null = null;

vi.mock("@/components/ui/bottom-anchored-scroll-body.js", () => ({
  useBottomAnchoredScroll: () => ({
    isAtBottom: false,
    scrollToBottom: mocks.scrollToBottom,
    scrollElementIntoView: vi.fn(),
    scrollElementIntoViewClampedToMaxScroll: vi.fn(),
    captureScrollAnchor: vi.fn(),
  }),
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => mocks.isCompactViewport,
}));

vi.mock("@bb/shared-ui/hooks/use-pointer-coarse", () => ({
  usePointerCoarse: () => mocks.isPointerCoarse,
}));

vi.mock("@/components/promptbox/PromptBoxInternal", () => ({
  PromptBoxInternal: ({
    footerStart,
    compact,
    onSubmit,
    promptBoxRef,
    submission,
    suppressPluginComposerCustomizations,
    zenMode,
    heightAnimationKey,
    minHeight,
  }: {
    footerStart?: ReactNode;
    compact?: {
      isCompact: boolean;
      placeholder?: string;
    };
    onSubmit: () => void;
    promptBoxRef?: {
      current: {
        captureHeightForLayoutChange: () => void;
        focusEnd: () => void;
      } | null;
    };
    submission?: { onModifierSubmit?: () => void };
    suppressPluginComposerCustomizations?: boolean;
    zenMode?: { resetKey: string | number };
    heightAnimationKey?: string | number;
    minHeight?: number;
  }) => (
    <div
      data-testid="prompt-box"
      data-compact={compact?.isCompact}
      data-zen-reset-key={zenMode?.resetKey}
      data-height-animation-key={heightAnimationKey}
      data-min-height={minHeight}
      data-plugin-customizations-suppressed={
        suppressPluginComposerCustomizations ? "true" : "false"
      }
    >
      {footerStart}
      <input
        aria-label="Follow-up prompt"
        ref={(node) => {
          if (!promptBoxRef) return;
          promptBoxRef.current = node
            ? {
                captureHeightForLayoutChange: () => {},
                focusEnd: () => {
                  node.focus();
                  node.setSelectionRange(node.value.length, node.value.length);
                },
              }
            : null;
        }}
      />
      {compact?.isCompact ? <span>{compact.placeholder}</span> : null}
      <button type="button" onClick={onSubmit}>
        Submit
      </button>
      <button type="button" onClick={submission?.onModifierSubmit}>
        Modifier submit
      </button>
    </div>
  ),
}));

vi.mock("@/components/promptbox/usePromptVoice", () => ({
  usePromptVoice: () => ({
    state: "idle",
    isSupported: false,
    stream: null,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  }),
}));

vi.mock("@/components/promptbox/ExecutionControls", () => ({
  ExecutionControls: (props: { disabled?: boolean }) => {
    mocks.executionControls(props);
    return null;
  },
}));

vi.mock("@/components/pickers/PermissionModePicker", () => ({
  PermissionModePicker: (props: {
    disabled?: boolean;
    showChevronWhenDisabled?: boolean;
  }) => {
    mocks.permissionModePicker(props);
    return null;
  },
}));

vi.mock("@/views/thread-detail/ThreadTimelineScrollToBottomButton", () => ({
  ThreadTimelineScrollToBottomButton: () => null,
}));

vi.mock("@/components/thread/timeline", () => ({
  ThreadContextWindowIndicator: () => null,
}));

function createFollowUpPromptBoxProps(
  submitMode: FollowUpSubmitMode,
): Parameters<typeof FollowUpPromptBox>[0] {
  return {
    attachments: {
      items: [],
      projectId: "proj_test",
      isAttaching: false,
      error: null,
      onAttachFiles: vi.fn(),
      onRemove: vi.fn(),
    },
    stack: null,
    composer: {
      history: {
        currentDraft: { text: "Follow up", mentions: [], attachments: [] },
        entries: [],
        onSelectEntry: vi.fn(),
      },
      isFollowUpSubmitting: false,
      message: "Follow up",
      mentionRanges: [],
      onChangeMessage: vi.fn(),
      onModifierSubmit: vi.fn(),
      onSubmit: vi.fn(),
      compactPromptPlaceholder: "Ask a follow-up",
      promptPlaceholder: "Ask for a follow-up",
      canModifierSubmit: true,
      submitMode,
      threadRuntimeDisplayStatus:
        submitMode.kind === "queue" ? "active" : "idle",
    },
    environmentSummary: null,
    contextWindowUsage: null,
    execution: {
      provider: {
        selectedId: "codex",
        displayName: "Codex",
      },
      model: {
        selected: "gpt-5",
        options: [],
        moreOptions: [],
        isLoading: false,
        loadFailed: false,
        onChange: vi.fn(),
      },
      reasoning: {
        value: "medium",
        options: [],
        onChange: vi.fn(),
      },
    },
    permission: {
      value: "accept-edits",
      options: [{ value: "accept-edits", label: "Accept Edits" }],
      onChange: vi.fn(),
      supported: true,
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
        hasMore: false,
        isLoadingMore: false,
        loadMore: vi.fn(),
        onQueryChange: vi.fn(),
      },
    },
    zenModeResetKey: "thr_test",
  };
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mocks.isCompactViewport = false;
  mocks.isPointerCoarse = false;
  resizeObserverCallback = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallback = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

describe("FollowUpPromptBox", () => {
  it("includes expanding plugin banners in measured stack compensation", () => {
    setPluginSlotRegistrations("measured-banner", {
      homepageSections: [],
      settingsSections: [],
      navPanels: [],
      threadPanelActions: [],
      composerCustomizations: [
        {
          id: "measured",
          banners: [
            {
              id: "banner",
              component: () => <div>Expandable plugin banner</div>,
            },
          ],
        },
      ],
      pendingInteractions: [],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
    });
    const draft = { text: "Follow up", mentions: [], attachments: [] };
    const props = createFollowUpPromptBoxProps({ kind: "ready" });
    render(
      <FollowUpPromptBox
        {...props}
        stack={<></>}
        pluginComposerHost={{
          scope: { kind: "thread", threadId: "thr_test" },
          draft,
          textEffectKey: "thread:thr_test",
          getCurrent: () => draft,
          setDraft: vi.fn(),
          focus: vi.fn(),
        }}
        pluginComposerScope={{ kind: "thread", threadId: "thr_test" }}
      />,
    );
    expect(screen.getByText("Expandable plugin banner")).toBeTruthy();
    const promptBox = screen.getByTestId("prompt-box");
    const initialMinHeight = Number(promptBox.getAttribute("data-min-height"));

    act(() => {
      resizeObserverCallback?.(
        [{ contentRect: { height: 24 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    expect(Number(promptBox.getAttribute("data-min-height"))).toBeLessThan(
      initialMinHeight,
    );
  });

  it("renders plugin banners above native stack content", () => {
    setPluginSlotRegistrations("ordered-banner", {
      homepageSections: [],
      settingsSections: [],
      navPanels: [],
      threadPanelActions: [],
      composerCustomizations: [
        {
          id: "ordered",
          banners: [
            {
              id: "header",
              component: () => <div data-testid="plugin-header">Header</div>,
            },
          ],
        },
      ],
      pendingInteractions: [],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
    });
    const draft = { text: "Follow up", mentions: [], attachments: [] };
    const props = createFollowUpPromptBoxProps({ kind: "ready" });
    render(
      <FollowUpPromptBox
        {...props}
        stack={<div data-testid="queued-messages">Queued messages</div>}
        pluginComposerHost={{
          scope: { kind: "thread", threadId: "thr_test" },
          draft,
          textEffectKey: "thread:thr_test",
          getCurrent: () => draft,
          setDraft: vi.fn(),
          focus: vi.fn(),
        }}
        pluginComposerScope={{ kind: "thread", threadId: "thr_test" }}
      />,
    );

    const pluginHeaderRoot = screen
      .getByTestId("plugin-header")
      .closest("[data-bb-plugin-root]");
    const queuedMessages = screen.getByTestId("queued-messages");
    expect(queuedMessages.previousElementSibling).toBe(pluginHeaderRoot);
  });

  it("keeps the bottom composer mounted when its stack changes", () => {
    const props = createFollowUpPromptBoxProps({ kind: "ready" });

    const { container, rerender } = render(<FollowUpPromptBox {...props} />);
    const promptBox = screen.getByTestId("prompt-box");
    const input = screen.getByLabelText<HTMLInputElement>("Follow-up prompt");
    input.value = "Uncommitted editor state";
    input.focus();
    input.setSelectionRange(0, 0);

    expect(
      container
        .querySelector("[data-follow-up-composer-anchor]")
        ?.querySelector('[data-testid="prompt-box"]'),
    ).toBe(promptBox);

    rerender(
      <FollowUpPromptBox
        {...props}
        stack={<div data-testid="new-stack-item">Queue</div>}
      />,
    );

    expect(screen.getByTestId("new-stack-item")).toBeTruthy();
    expect(screen.getAllByTestId("prompt-box")).toHaveLength(1);
    expect(screen.getByLabelText("Follow-up prompt")).toBe(input);
    expect(input.value).toBe("Uncommitted editor state");
    fireEvent.click(screen.getByText("Submit"));
    expect(props.composer?.onSubmit).toHaveBeenCalledOnce();
  });

  it.each([
    ["main-thread", true],
    ["side-chat", false],
  ] as const)(
    "renders queued-message banners before the %s inline composer",
    (_kind, isPrimaryComposer) => {
      setPluginSlotRegistrations("queued-tools", {
        homepageSections: [],
        settingsSections: [],
        navPanels: [],
        threadPanelActions: [],
        composerCustomizations: [
          {
            id: "queued-banner",
            scopes: ["queued-message"],
            banners: [
              {
                id: "status",
                chrome: "bare",
                component: () => (
                  <div data-testid="queued-plugin-banner">Queued status</div>
                ),
              },
            ],
          },
        ],
        pendingInteractions: [],
        sidebarFooterActions: [],
        fileOpeners: [],
        messageDirectives: [],
      });
      const draft = { text: "Queued draft", mentions: [], attachments: [] };
      const scope = {
        kind: "queued-message" as const,
        threadId: "thr_test",
        queuedMessageId: "queued_1",
      };
      const props = createFollowUpPromptBoxProps({ kind: "ready" });
      render(
        <FollowUpPromptBox
          {...props}
          isPrimaryComposer={isPrimaryComposer}
          pluginComposerHost={{
            scope,
            draft,
            textEffectKey: "queued:queued_1",
            getCurrent: () => draft,
            setDraft: vi.fn(),
            focus: vi.fn(),
          }}
          pluginComposerScope={scope}
        />,
      );

      const banner = screen.getByTestId("queued-plugin-banner");
      const promptBox = screen.getByTestId("prompt-box");
      expect(
        banner.compareDocumentPosition(promptBox) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
      expect(screen.getAllByTestId("queued-plugin-banner")).toHaveLength(1);
    },
  );

  it("forwards customization suppression changes without remounting the composer", () => {
    const props = createFollowUpPromptBoxProps({ kind: "ready" });
    const { rerender } = render(
      <FollowUpPromptBox {...props} suppressPluginComposerCustomizations />,
    );
    const promptBox = screen.getByTestId("prompt-box");
    const input = screen.getByLabelText("Follow-up prompt");

    expect(promptBox.dataset.pluginCustomizationsSuppressed).toBe("true");

    rerender(
      <FollowUpPromptBox
        {...props}
        suppressPluginComposerCustomizations={false}
      />,
    );

    expect(screen.getByTestId("prompt-box")).toBe(promptBox);
    expect(screen.getByLabelText("Follow-up prompt")).toBe(input);
    expect(promptBox.dataset.pluginCustomizationsSuppressed).toBe("false");
  });

  it("scrolls to the bottom after submitting a ready follow-up", () => {
    const props = createFollowUpPromptBoxProps({ kind: "ready" });
    render(<FollowUpPromptBox {...props} />);

    fireEvent.click(screen.getByText("Submit"));

    expect(props.composer?.onSubmit).toHaveBeenCalledOnce();
    expect(mocks.scrollToBottom).toHaveBeenCalledOnce();
  });

  it("preserves scroll position after queueing a follow-up", () => {
    const props = createFollowUpPromptBoxProps({
      kind: "queue",
      onStop: vi.fn(),
    });
    render(<FollowUpPromptBox {...props} />);

    fireEvent.click(screen.getByText("Submit"));

    expect(props.composer?.onSubmit).toHaveBeenCalledOnce();
    expect(mocks.scrollToBottom).not.toHaveBeenCalled();
  });

  it("disables the permission picker while plan mode is active", () => {
    const props = createFollowUpPromptBoxProps({
      kind: "queue",
      onStop: vi.fn(),
    });

    render(
      <FollowUpPromptBox
        {...props}
        activePromptMode={{
          mode: "plan",
          providerId: "codex",
          prompt: "inspect the failing test",
        }}
      />,
    );

    expect(mocks.permissionModePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        disabled: true,
        showChevronWhenDisabled: true,
      }),
    );
  });

  it("can lock permission without disabling execution controls", () => {
    const props = createFollowUpPromptBoxProps({ kind: "ready" });

    render(<FollowUpPromptBox {...props} permissionReadOnly />);

    expect(mocks.executionControls).toHaveBeenCalledWith(
      expect.objectContaining({
        disabled: false,
      }),
    );
    expect(mocks.permissionModePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        disabled: true,
      }),
    );
  });

  it("starts as a single compact row on mobile without size controls", () => {
    mocks.isCompactViewport = true;
    const props = createFollowUpPromptBoxProps({ kind: "ready" });
    props.environmentSummary = <span>Local environment</span>;
    render(<FollowUpPromptBox {...props} />);

    expect(screen.getByTestId("prompt-box").getAttribute("data-compact")).toBe(
      "true",
    );
    expect(screen.getByText("Ask a follow-up")).toBeTruthy();
    expect(screen.queryByText("Local environment")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Make prompt box/u }),
    ).toBeNull();
  });

  it("expands while focus is within the mobile composer", () => {
    mocks.isCompactViewport = true;
    const props = createFollowUpPromptBoxProps({ kind: "ready" });
    props.environmentSummary = <span>Local environment</span>;
    render(<FollowUpPromptBox {...props} />);

    const input = screen.getByRole("textbox", { name: "Follow-up prompt" });
    const submit = screen.getByRole("button", { name: "Submit" });
    fireEvent.focus(input);

    expect(screen.getByTestId("prompt-box").getAttribute("data-compact")).toBe(
      "false",
    );
    expect(screen.getByText("Local environment")).toBeTruthy();

    fireEvent.blur(input, { relatedTarget: submit });
    fireEvent.focus(submit);
    expect(screen.getByTestId("prompt-box").getAttribute("data-compact")).toBe(
      "false",
    );
  });

  it("does not move the mobile input before the first tap can focus it", () => {
    mocks.isCompactViewport = true;
    render(
      <FollowUpPromptBox
        {...createFollowUpPromptBoxProps({ kind: "ready" })}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Follow-up prompt" });

    fireEvent.pointerDown(input);
    expect(screen.getByTestId("prompt-box").getAttribute("data-compact")).toBe(
      "true",
    );

    fireEvent.focus(input);
    expect(screen.getByTestId("prompt-box").getAttribute("data-compact")).toBe(
      "false",
    );
  });

  it("coordinates coarse-pointer expansion with a visual viewport change", async () => {
    mocks.isCompactViewport = true;
    mocks.isPointerCoarse = true;
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport",
    );
    const visualViewport = Object.assign(new EventTarget(), { height: 500 });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });

    try {
      render(
        <FollowUpPromptBox
          {...createFollowUpPromptBoxProps({ kind: "ready" })}
        />,
      );
      const input = screen.getByRole("textbox", { name: "Follow-up prompt" });

      fireEvent.focus(input);
      expect(
        screen.getByTestId("prompt-box").getAttribute("data-compact"),
      ).toBe("true");

      act(() => {
        visualViewport.height = 460;
        visualViewport.dispatchEvent(new Event("resize"));
      });
      expect(
        screen.getByTestId("prompt-box").getAttribute("data-compact"),
      ).toBe("true");

      act(() => {
        visualViewport.height = 300;
        visualViewport.dispatchEvent(new Event("resize"));
      });
      await vi.waitFor(() =>
        expect(
          screen.getByTestId("prompt-box").getAttribute("data-compact"),
        ).toBe("false"),
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window, "visualViewport", originalDescriptor);
      } else {
        Reflect.deleteProperty(window, "visualViewport");
      }
    }
  });

  it("collapses on an interaction outside the mobile composer", () => {
    mocks.isCompactViewport = true;
    render(
      <>
        <FollowUpPromptBox
          {...createFollowUpPromptBoxProps({ kind: "ready" })}
        />
        <button type="button">Outside composer</button>
      </>,
    );
    const input = screen.getByRole("textbox", { name: "Follow-up prompt" });
    const outside = screen.getByRole("button", { name: "Outside composer" });

    fireEvent.focus(input);
    fireEvent.pointerDown(outside);

    expect(screen.getByTestId("prompt-box").getAttribute("data-compact")).toBe(
      "true",
    );
  });

  it("stays expanded while a composer-owned overlay is open", () => {
    mocks.isCompactViewport = true;
    render(
      <>
        <FollowUpPromptBox
          {...createFollowUpPromptBoxProps({ kind: "ready" })}
        />
        <button type="button">Portaled picker content</button>
      </>,
    );
    const input = screen.getByRole("textbox", { name: "Follow-up prompt" });
    const trigger = screen.getByRole("button", { name: "Submit" });
    const portaledContent = screen.getByRole("button", {
      name: "Portaled picker content",
    });
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "true");
    fireEvent.focus(input);

    fireEvent.pointerDown(portaledContent);
    fireEvent.focusIn(portaledContent);

    expect(screen.getByTestId("prompt-box").getAttribute("data-compact")).toBe(
      "false",
    );

    trigger.setAttribute("aria-expanded", "false");
    fireEvent.pointerDown(portaledContent);
    expect(screen.getByTestId("prompt-box").getAttribute("data-compact")).toBe(
      "true",
    );
  });

  it("stays expanded after pressing a non-focusable composer control", () => {
    mocks.isCompactViewport = true;
    const props = createFollowUpPromptBoxProps({ kind: "ready" });
    props.environmentSummary = (
      <button type="button" disabled>
        Read only mode
      </button>
    );
    render(<FollowUpPromptBox {...props} />);
    const input = screen.getByRole("textbox", { name: "Follow-up prompt" });
    fireEvent.focus(input);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Read only mode" }),
    );
    fireEvent.blur(input);

    expect(screen.getByTestId("prompt-box").getAttribute("data-compact")).toBe(
      "false",
    );
  });

  it("keeps the full composer visible on desktop", () => {
    const props = createFollowUpPromptBoxProps({ kind: "ready" });
    props.environmentSummary = <span>Local environment</span>;
    render(<FollowUpPromptBox {...props} />);

    expect(screen.getByTestId("prompt-box").getAttribute("data-compact")).toBe(
      null,
    );
    expect(screen.getByText("Local environment")).toBeTruthy();
  });

  it("exposes focus state so narrow prompt containers can expand", () => {
    render(
      <>
        <FollowUpPromptBox
          {...createFollowUpPromptBoxProps({ kind: "ready" })}
        />
        <button type="button">Outside composer</button>
      </>,
    );
    const composer = document.querySelector("[data-follow-up-composer]");
    const input = screen.getByRole("textbox", { name: "Follow-up prompt" });

    expect(composer?.hasAttribute("data-follow-up-composer-expanded")).toBe(
      false,
    );
    expect(screen.getByTestId("prompt-box").dataset.heightAnimationKey).toBe(
      "compact",
    );

    fireEvent.focus(input);
    expect(composer?.hasAttribute("data-follow-up-composer-expanded")).toBe(
      true,
    );
    expect(screen.getByTestId("prompt-box").dataset.heightAnimationKey).toBe(
      "expanded",
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Outside composer" }),
    );
    expect(composer?.hasAttribute("data-follow-up-composer-expanded")).toBe(
      false,
    );
    expect(screen.getByTestId("prompt-box").dataset.heightAnimationKey).toBe(
      "compact",
    );
  });

  it("keeps the composer mounted across compact breakpoint changes", () => {
    const props = createFollowUpPromptBoxProps({ kind: "ready" });
    const { rerender } = render(<FollowUpPromptBox {...props} />);
    const initialPromptBox = screen.getByTestId("prompt-box");

    mocks.isCompactViewport = true;
    rerender(<FollowUpPromptBox {...props} focusEndKey="mobile" />);

    expect(screen.getByTestId("prompt-box")).toBe(initialPromptBox);
    expect(initialPromptBox.getAttribute("data-zen-reset-key")).toBe(
      "thr_test:mobile",
    );
  });

  it("uses the caller-specific compact placeholder", () => {
    mocks.isCompactViewport = true;
    const props = createFollowUpPromptBoxProps({
      kind: "blocked",
      reason: "stopping",
    });
    if (props.composer === null) throw new Error("Missing composer");
    props.composer.compactPromptPlaceholder = "Stopping side chat...";
    props.composer.promptPlaceholder = "Stopping side chat...";
    render(<FollowUpPromptBox {...props} />);

    expect(screen.getByText("Stopping side chat...")).toBeTruthy();
  });
});
