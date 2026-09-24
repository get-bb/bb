// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  type NavigateFunction,
  type NavigateOptions,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

const compactViewport = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@bb/shared-ui/hooks/use-compact-viewport")
    >();
  return {
    ...actual,
    useIsCompactViewport: () => {
      compactViewport.calls += 1;
      return false;
    },
  };
});

function NavigationProbe({
  navigateRef,
}: {
  navigateRef: { current: NavigateFunction | null };
}) {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate, navigateRef]);
  return <div data-testid="location">{location.pathname}</div>;
}

function PaneTimeline({ threadId }: { threadId: string }) {
  const [rows] = useState(() => [
    conversationRow({
      id: `${threadId}-message`,
      role: "assistant",
      seq: 12,
      sourceSeqStart: 12,
      sourceSeqEnd: 12,
      text: `Message in ${threadId}`,
      threadId,
    }),
  ]);
  return (
    <ThreadTimelineRows
      threadId={threadId}
      timelineRows={rows}
      threadRuntimeDisplayStatus="idle"
      workspaceRootPath={undefined}
    />
  );
}

function renderTwoPaneTimelines() {
  const navigateRef: { current: NavigateFunction | null } = { current: null };
  const view = render(
    <MemoryRouter initialEntries={["/threads/thr_a"]}>
      <QueryClientProvider client={new QueryClient()}>
        <NavigationProbe navigateRef={navigateRef} />
        <PaneTimeline threadId="thr_a" />
        <PaneTimeline threadId="thr_b" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const navigate = (path: string, options?: NavigateOptions) => {
    if (navigateRef.current === null) {
      throw new Error("Expected router navigate");
    }
    void navigateRef.current(path, options);
  };
  return { ...view, navigate };
}

beforeEach(() => {
  compactViewport.calls = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(performance.now());
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ThreadTimelineRows location subscription", () => {
  it("does not re-render timeline lists when a focus navigation carries no search target", async () => {
    const { navigate } = renderTwoPaneTimelines();
    await screen.findByText("Message in thr_b");
    compactViewport.calls = 0;

    act(() => {
      navigate("/threads/thr_b", { replace: true });
    });
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/threads/thr_b"),
    );
    act(() => {
      navigate("/threads/thr_a", { replace: true });
    });
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/threads/thr_a"),
    );

    expect(compactViewport.calls).toBe(0);
  });

  it("still delivers an in-place search jump only to the matching thread's timeline", async () => {
    const { container, navigate } = renderTwoPaneTimelines();
    await screen.findByText("Message in thr_b");

    act(() => {
      navigate("/threads/thr_a", {
        state: { searchMessageSeq: 12, searchThreadId: "thr_a" },
      });
    });

    const matchingRow = container.querySelector(
      '[data-timeline-row-id="thr_a-message"]',
    );
    await waitFor(() =>
      expect(matchingRow?.classList.contains("bb-search-flash")).toBe(true),
    );
    expect(
      container
        .querySelector('[data-timeline-row-id="thr_b-message"]')
        ?.classList.contains("bb-search-flash"),
    ).toBe(false);
  });
});
