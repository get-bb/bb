// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FollowUpPromptBox,
  type FollowUpSubmitMode,
} from "@/components/promptbox/FollowUpPromptBox";

const mocks = vi.hoisted(() => {
  const values = {
    executionControls: vi.fn(),
    isCompactViewport: false,
    scrollElement: null as HTMLElement | null,
    scrollToBottom: vi.fn(),
    permissionModePicker: vi.fn(),
  };
  return Object.assign(values, {
    getScrollElement: () => values.scrollElement,
  });
});

vi.mock("@/components/ui/bottom-anchored-scroll-body.js", () => ({
  useBottomAnchoredScroll: () => ({
    getScrollElement: mocks.getScrollElement,
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

vi.mock("@/components/promptbox/PromptBoxInternal", () => ({
  PromptBoxInternal: ({
    footerStart,
    minimized,
    onSubmit,
    submission,
  }: {
    footerStart?: ReactNode;
    minimized?: {
      isMinimized: boolean;
      onToggle: () => void;
      placeholder?: string;
    };
    onSubmit: () => void;
    submission?: { onModifierSubmit?: () => void };
  }) => (
    <div data-testid="prompt-box" data-minimized={minimized?.isMinimized}>
      {footerStart}
      {minimized?.isMinimized ? <span>{minimized.placeholder}</span> : null}
      {minimized ? (
        <button type="button" onClick={minimized.onToggle}>
          {minimized.isMinimized
            ? "Make prompt box larger"
            : "Make prompt box smaller"}
        </button>
      ) : null}
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
      value: "readonly",
      options: [{ value: "readonly", label: "Read" }],
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
  vi.clearAllMocks();
});

beforeEach(() => {
  mocks.isCompactViewport = false;
  mocks.scrollElement = document.createElement("div");
});

describe("FollowUpPromptBox", () => {
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

  it("offers manual minimize and expand controls on mobile", () => {
    mocks.isCompactViewport = true;
    const props = createFollowUpPromptBoxProps({ kind: "ready" });
    props.environmentSummary = <span>Local environment</span>;
    render(<FollowUpPromptBox {...props} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Make prompt box smaller" }),
    );

    expect(
      screen.getByRole("button", { name: "Make prompt box larger" }),
    ).toBeTruthy();
    expect(screen.getByText("Ask a follow-up")).toBeTruthy();
    expect(screen.queryByText("Local environment")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Make prompt box larger" }),
    );

    expect(
      screen.getByRole("button", { name: "Make prompt box smaller" }),
    ).toBeTruthy();
    expect(screen.getByText("Local environment")).toBeTruthy();
  });

  it("automatically minimizes after the mobile timeline scrolls up", () => {
    mocks.isCompactViewport = true;
    if (!mocks.scrollElement) throw new Error("Missing scroll element");
    mocks.scrollElement.scrollTop = 200;
    render(
      <FollowUpPromptBox
        {...createFollowUpPromptBoxProps({ kind: "ready" })}
      />,
    );

    mocks.scrollElement.scrollTop = 190;
    fireEvent.scroll(mocks.scrollElement);

    expect(
      screen.getByRole("button", { name: "Make prompt box larger" }),
    ).toBeTruthy();
  });

  it("does not undo a manual expansion during the same upward scroll", () => {
    mocks.isCompactViewport = true;
    if (!mocks.scrollElement) throw new Error("Missing scroll element");
    mocks.scrollElement.scrollTop = 200;
    render(
      <FollowUpPromptBox
        {...createFollowUpPromptBoxProps({ kind: "ready" })}
      />,
    );

    mocks.scrollElement.scrollTop = 190;
    fireEvent.scroll(mocks.scrollElement);
    fireEvent.click(
      screen.getByRole("button", { name: "Make prompt box larger" }),
    );

    mocks.scrollElement.scrollTop = 175;
    fireEvent.scroll(mocks.scrollElement);
    expect(
      screen.getByRole("button", { name: "Make prompt box smaller" }),
    ).toBeTruthy();

    mocks.scrollElement.scrollTop = 185;
    fireEvent.scroll(mocks.scrollElement);
    mocks.scrollElement.scrollTop = 170;
    fireEvent.scroll(mocks.scrollElement);
    expect(
      screen.getByRole("button", { name: "Make prompt box larger" }),
    ).toBeTruthy();
  });

  it("does not expose minimize controls on desktop", () => {
    render(
      <FollowUpPromptBox
        {...createFollowUpPromptBoxProps({ kind: "ready" })}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Make prompt box smaller" }),
    ).toBeNull();
  });
});
