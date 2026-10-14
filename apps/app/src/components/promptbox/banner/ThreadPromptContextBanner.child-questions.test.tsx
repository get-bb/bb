// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingInteraction } from "@bb/domain";
import {
  ThreadPromptContextBanner,
  type ChildThreadQuestion,
  type ThreadPromptChildThreadsSection,
  type ThreadPromptContextBannerExpandedSection,
} from "./ThreadPromptContextBanner";

const mocks = vi.hoisted(() => ({
  resolveHook: vi.fn(),
  resolve: vi.fn(async () => ({})),
}));

vi.mock("@/hooks/mutations/thread-interaction-mutations", () => ({
  useResolveThreadPendingInteraction: (threadId: string) => {
    mocks.resolveHook(threadId);
    return { mutateAsync: mocks.resolve, isPending: false, error: null };
  },
  useCancelThreadPendingInteraction: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { interactions: { respond: vi.fn(), cancel: vi.fn() } } },
}));

function childQuestion(
  childThreadId: string,
  prompt: string,
  createdAt: number,
): ChildThreadQuestion {
  const interaction: PendingInteraction = {
    id: `pint_${childThreadId}`,
    threadId: childThreadId,
    turnId: "turn_1",
    providerId: "claude-code",
    providerThreadId: "pt_1",
    providerRequestId: `req_${childThreadId}`,
    status: "pending",
    statusReason: null,
    createdAt,
    resolvedAt: null,
    resolution: null,
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "choice",
          prompt,
          multiSelect: false,
          allowFreeText: false,
          options: [
            { value: "a", label: "Alpha", description: "First choice" },
            { value: "b", label: "Beta", description: "Second choice" },
          ],
        },
      ],
    },
  };
  return {
    childThreadId,
    childTitle: `Child ${childThreadId}`,
    href: `/threads/${childThreadId}`,
    interaction,
  };
}

const newest = childQuestion("thr_b", "Which size?", 3);
const middle = childQuestion("thr_c", "Which shape?", 2);
const oldest = childQuestion("thr_a", "Which color?", 1);

function section(
  pendingInteractions: readonly ChildThreadQuestion[],
): ThreadPromptChildThreadsSection {
  return {
    items: [
      ...pendingInteractions.map((item) => ({
        id: item.childThreadId,
        title: item.childTitle,
        href: item.href,
        hasPendingInteraction: true,
      })),
      {
        id: "thr_working",
        title: "Investigate failing checks",
        href: "/threads/thr_working",
        hasPendingInteraction: false,
      },
    ],
    pendingInteractions,
  };
}

function Harness({
  childThreads,
  initiallyExpanded,
}: {
  childThreads: ThreadPromptChildThreadsSection;
  initiallyExpanded: boolean;
}) {
  const [expandedSection, setExpandedSection] =
    useState<ThreadPromptContextBannerExpandedSection | null>(
      initiallyExpanded ? "childThreads" : null,
    );
  return (
    <ThreadPromptContextBanner
      gitSection={null}
      gitSectionPending={false}
      archivedSection={null}
      environmentGoneSection={null}
      parentThreadSection={null}
      childThreadsSection={childThreads}
      pullRequestSection={null}
      expandedSection={expandedSection}
      onToggleSection={(next) =>
        setExpandedSection((current) => (current === next ? null : next))
      }
    />
  );
}

function bannerElement(
  childThreads: ThreadPromptChildThreadsSection,
  initiallyExpanded = true,
  queryClient = new QueryClient(),
) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Harness
          childThreads={childThreads}
          initiallyExpanded={initiallyExpanded}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function openForm() {
  return screen.queryByTestId("user-question-banner");
}

function shownSource(): string | null {
  return screen.getByRole("link", { name: /^Child thr_/ }).textContent;
}

function press(name: "Previous question" | "Next question") {
  const button = screen.getByRole("button", { name });
  button.focus();
  fireEvent.click(button);
}

afterEach(() => {
  cleanup();
  mocks.resolveHook.mockClear();
  mocks.resolve.mockClear();
});

describe("ThreadPromptContextBanner child questions", () => {
  it("auto-expands to the row list without opening a question", () => {
    const { rerender } = render(bannerElement(section([]), false));

    rerender(bannerElement(section([newest, middle, oldest]), false));

    expect(screen.getByText("Active child threads")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Child thr_b/ }).textContent,
    ).toBe("Child thr_b: Which size?");
    expect(screen.getByText("Investigate failing checks")).toBeTruthy();
    expect(openForm()).toBe(null);
  });

  it("opens the clicked child's question compactly inside the banner", () => {
    render(bannerElement(section([newest, middle, oldest])));

    fireEvent.click(screen.getByRole("button", { name: /Child thr_c/ }));

    const form = openForm();
    expect(form?.getAttribute("data-presentation")).toBe("inline");
    expect(shownSource()).toBe("Child thr_c");
    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(screen.getAllByText("Which shape?").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit answer" })).toBe(null);
    expect(screen.queryByText("Investigate failing checks")).toBe(null);
  });

  it("expands to the row list from the collapsed header without opening a question", () => {
    render(bannerElement(section([newest, middle, oldest])));
    fireEvent.click(
      screen.getByRole("button", { name: "4 active child threads" }),
    );
    expect(openForm()).toBe(null);

    const header = screen.getByRole("button", {
      name: "4 active child threads, needs input: Child thr_b: Which size?",
    });
    fireEvent.click(header);

    expect(openForm()).toBe(null);
    expect(screen.getByText("Investigate failing checks")).toBeTruthy();
  });

  it("steps both ways, wraps, and keeps focus on the pressed caret", () => {
    render(bannerElement(section([newest, middle, oldest])));
    fireEvent.click(screen.getByRole("button", { name: /Child thr_b/ }));

    press("Next question");
    expect(shownSource()).toBe("Child thr_c");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Next question" }),
    );
    press("Next question");
    press("Next question");
    expect(shownSource()).toBe("Child thr_b");
    press("Previous question");
    expect(shownSource()).toBe("Child thr_a");
    expect(screen.getByText("3 of 3")).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Previous question" }),
    );
  });

  it("drops the back control when the parent has a single child thread", () => {
    const only = section([newest]);
    render(
      bannerElement({
        ...only,
        items: only.items.filter((item) => item.hasPendingInteraction),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Child thr_b/ }));

    expect(shownSource()).toBe("Child thr_b");
    expect(
      screen.queryByRole("button", { name: "Back to active child threads" }),
    ).toBe(null);
  });

  it("drops the stepper and the collapse row for a single open question", () => {
    render(bannerElement(section([newest])));
    expect(
      screen.getByRole("button", { name: /^Collapse \d+ child threads?$/ }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Child thr_b/ }));

    expect(shownSource()).toBe("Child thr_b");
    expect(screen.queryByRole("button", { name: "Next question" })).toBe(null);
    expect(screen.queryByText(/^\d+ of \d+$/)).toBe(null);
    expect(
      screen.queryByRole("button", { name: /^Collapse \d+ child threads?$/ }),
    ).toBe(null);
  });

  it("returns to the row list from the back button", () => {
    render(bannerElement(section([newest, middle, oldest])));
    fireEvent.click(screen.getByRole("button", { name: /Child thr_c/ }));

    fireEvent.click(
      screen.getByRole("button", { name: "Back to active child threads" }),
    );

    expect(openForm()).toBe(null);
    expect(screen.getByText("Investigate failing checks")).toBeTruthy();
  });

  it("returns to the row list on Escape", () => {
    render(bannerElement(section([newest, middle, oldest])));
    fireEvent.click(screen.getByRole("button", { name: /Child thr_b/ }));

    fireEvent.keyDown(screen.getByRole("button", { name: "Submit" }), {
      key: "Escape",
    });

    expect(openForm()).toBe(null);
    expect(screen.getByText("Investigate failing checks")).toBeTruthy();
  });

  it("returns to the row list on Cancel and leaves the question waiting", () => {
    render(bannerElement(section([newest, middle, oldest])));
    fireEvent.click(screen.getByRole("button", { name: /Child thr_c/ }));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(openForm()).toBe(null);
    expect(
      screen.getByRole("button", { name: /Child thr_c/ }).textContent,
    ).toBe("Child thr_c: Which shape?");
  });

  it("keeps the question open for an Escape that ends text composition", () => {
    render(bannerElement(section([newest, middle, oldest])));
    fireEvent.click(screen.getByRole("button", { name: /Child thr_b/ }));

    fireEvent.keyDown(screen.getByRole("button", { name: "Submit" }), {
      key: "Escape",
      isComposing: true,
    });

    expect(openForm()).not.toBe(null);
  });

  it("submits the answer to the open child's interaction", async () => {
    render(bannerElement(section([newest, middle, oldest])));
    fireEvent.click(screen.getByRole("button", { name: /Child thr_c/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Alpha/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1));
    expect(mocks.resolveHook).toHaveBeenLastCalledWith("thr_c");
    expect(mocks.resolve).toHaveBeenCalledWith({
      threadId: "thr_c",
      interactionId: "pint_thr_c",
      resolution: {
        kind: "user_answer",
        answers: { choice: { selected: ["a"] } },
      },
    });
  });

  it("does not re-render the open form when the banner updates around it", () => {
    const queryClient = new QueryClient();
    const { rerender } = render(
      bannerElement(section([newest, middle]), true, queryClient),
    );
    fireEvent.click(screen.getByRole("button", { name: /Child thr_b/ }));
    const formRenders = mocks.resolveHook.mock.calls.length;

    rerender(bannerElement(section([newest, middle]), true, queryClient));

    expect(shownSource()).toBe("Child thr_b");
    expect(mocks.resolveHook.mock.calls.length).toBe(formRenders);
  });

  it("moves to the next question after an answer, then closes when none remain", () => {
    const { rerender } = render(bannerElement(section([newest, middle])));
    fireEvent.click(screen.getByRole("button", { name: /Child thr_b/ }));

    rerender(bannerElement(section([middle])));
    expect(shownSource()).toBe("Child thr_c");

    rerender(bannerElement(section([])));
    expect(openForm()).toBe(null);
    expect(screen.getByText("Investigate failing checks")).toBeTruthy();
  });
});
