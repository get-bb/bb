// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextStep } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import * as appSurface from "@/lib/app-surface";
import { conversationRow, turnRow } from "@/test/fixtures/thread-timeline-rows";
import {
  NextStepRow,
  nextStepRowId,
  nextStepReminderLabel,
  useThreadNextStep,
} from "./NextStepRow";

function suggestion(overrides: Partial<NextStep> = {}): NextStep {
  return {
    id: "suggestion-1",
    analyticsId: "c2080216-e80b-4310-9868-529952fd3ec4",
    threadId: "thread-1",
    turnId: "turn-1",
    title: "Fix the related failing tests",
    why: "The completed run found two related failures.",
    evidence: [{ source: "conversation", ref: "message-1" }],
    action: {
      kind: "task",
      task: { prompt: "Fix the related tests", parallel: true },
    },
    status: "proposed",
    createdAt: 1,
    shownAt: null,
    result: null,
    ...overrides,
  };
}

const observers = new Set<(visible: boolean) => void>();

beforeEach(() => {
  vi.spyOn(appSurface, "getAppSurface").mockReturnValue("web");
  vi.spyOn(sdk.threads, "experimental_showNextStep").mockResolvedValue(
    suggestion(),
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private notify: (visible: boolean) => void;
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        this.notify = (visible) => callback([{ isIntersecting: visible }]);
      }
      observe() {
        observers.add(this.notify);
      }
      disconnect() {
        observers.delete(this.notify);
      }
    },
  );
});

afterEach(() => {
  cleanup();
  observers.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderSuggestion(value: NextStep) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["threads", value.threadId, "next-step"], value);
  render(
    <QueryClientProvider client={client}>
      <NextStepRow suggestion={value} />
    </QueryClientProvider>,
  );
  return client;
}

function setVisible(visible: boolean) {
  act(() => {
    for (const notify of observers) notify(visible);
  });
}

describe("Next step availability", () => {
  it("loads the proposal only after the running turn finishes", async () => {
    const get = vi
      .spyOn(sdk.threads, "experimental_nextStep")
      .mockResolvedValueOnce(suggestion({ status: "proposed" }))
      .mockResolvedValueOnce(suggestion({ status: "expired" }));
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ active }) => useThreadNextStep("thread-1", active),
      { initialProps: { active: true }, wrapper },
    );
    expect(get).not.toHaveBeenCalled();
    rerender({ active: false });
    await waitFor(() => expect(result.current.data?.status).toBe("proposed"));
    expect(get).toHaveBeenCalledWith("thread-1");
    rerender({ active: true });
    expect(get).toHaveBeenCalledTimes(1);
    rerender({ active: false });
    await waitFor(() => expect(result.current.data?.status).toBe("expired"));
    expect(get).toHaveBeenCalledTimes(2);
    client.clear();
  });
});

describe("Next step timeline placement", () => {
  it("places the row after the final matching turn content, including collapsed turns", () => {
    const first = conversationRow({
      id: "first",
      turnId: "turn-1",
      text: "Checking",
    });
    const last = conversationRow({
      id: "last",
      turnId: "turn-1",
      text: "Done",
    });
    const other = conversationRow({
      id: "other",
      turnId: "turn-2",
      text: "Another turn",
    });
    expect(nextStepRowId([first, last, other], suggestion())).toBe("last");
    expect(
      nextStepRowId(
        [turnRow({ id: "collapsed", turnId: "turn-1", status: "completed" })],
        suggestion(),
      ),
    ).toBe("collapsed");
  });

  it("hides a stale proposal as soon as a new user message appears", () => {
    const last = conversationRow({ turnId: "turn-1", text: "Done" });
    const followup = conversationRow({
      id: "followup",
      turnId: "turn-2",
      role: "user",
      text: "Work on something else",
    });
    expect(nextStepRowId([last, followup], suggestion())).toBeNull();
    expect(
      nextStepRowId([last, followup], suggestion({ status: "accepted" })),
    ).toBe(last.id);
  });

  it("does not show pending, dismissed, failed, or unrelated suggestions", () => {
    const row = turnRow({ id: "turn", turnId: "turn-1", status: "completed" });
    for (const status of [
      "pending",
      "dismissed",
      "expired",
      "undone",
    ] as const) {
      expect(nextStepRowId([row], suggestion({ status }))).toBeNull();
    }
    expect(
      nextStepRowId([{ ...row, status: "error" }], suggestion()),
    ).toBeNull();
    expect(nextStepRowId([row], suggestion({ turnId: "other" }))).toBeNull();
  });
});

describe("Next step actions", () => {
  it("keeps the proposal and allows retry when accepting fails", async () => {
    const accept = vi
      .spyOn(sdk.threads, "experimental_acceptNextStep")
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce(
        suggestion({
          status: "accepted",
          result: { kind: "task", threadIds: ["child"] },
        }),
      );
    const client = renderSuggestion(suggestion());
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn’t update this next step. Try again.",
    );
    expect(client.getQueryData(["threads", "thread-1", "next-step"])).toEqual(
      suggestion(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(
        client.getQueryData<NextStep>(["threads", "thread-1", "next-step"])
          ?.status,
      ).toBe("accepted"),
    );
    expect(accept).toHaveBeenCalledTimes(2);
    expect(accept).toHaveBeenLastCalledWith("thread-1");
  });

  it("dismisses through the shared action and updates the cached lifecycle", async () => {
    const dismiss = vi
      .spyOn(sdk.threads, "experimental_dismissNextStep")
      .mockResolvedValue(suggestion({ status: "dismissed" }));
    const client = renderSuggestion(suggestion());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss next step" }));
    await waitFor(() =>
      expect(
        client.getQueryData<NextStep>(["threads", "thread-1", "next-step"])
          ?.status,
      ).toBe("dismissed"),
    );
    expect(dismiss).toHaveBeenCalledWith("thread-1");
  });

  it("shows the result reminder and cancels it through the shared action", async () => {
    const accepted = suggestion({
      status: "accepted",
      action: {
        kind: "automation",
        automation: {
          prompt: "Triage CI",
          schedule: { runAt: Date.UTC(2026, 9, 22, 9), timezone: "UTC" },
        },
      },
      result: { kind: "automation", automationId: "automation-1" },
    });
    const undo = vi
      .spyOn(sdk.threads, "experimental_undoNextStep")
      .mockResolvedValue({ ...accepted, status: "undone" });
    const client = renderSuggestion(accepted);
    expect(screen.getByRole("status").textContent).toContain("Result reminder");
    expect(screen.queryByRole("button", { name: "Start now" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel reminder" }));
    await waitFor(() =>
      expect(
        client.getQueryData<NextStep>(["threads", "thread-1", "next-step"])
          ?.status,
      ).toBe("undone"),
    );
    expect(undo).toHaveBeenCalledWith("thread-1");
  });
});

describe("Next step impressions", () => {
  it("only records an impression when the row enters a visible page", async () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    renderSuggestion(suggestion());
    setVisible(true);
    expect(sdk.threads.experimental_showNextStep).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    setVisible(false);
    setVisible(true);
    await waitFor(() =>
      expect(sdk.threads.experimental_showNextStep).toHaveBeenCalledTimes(1),
    );
  });

  it("does not measure mobile impressions", () => {
    vi.mocked(appSurface.getAppSurface).mockReturnValue("mobile");
    renderSuggestion(suggestion());
    setVisible(true);
    expect(sdk.threads.experimental_showNextStep).not.toHaveBeenCalled();
  });
});

describe("Next step schedule", () => {
  it("uses the proposed timezone and tomorrow's calendar day across DST", () => {
    expect(
      nextStepReminderLabel(
        Date.parse("2026-11-02T14:00:00Z"),
        "America/New_York",
        Date.parse("2026-11-01T04:30:00Z"),
      ),
    ).toBe("Result reminder tomorrow at 9:00, or when you return");
  });

  it("does not keep calling an old scheduled date tomorrow", () => {
    expect(
      nextStepReminderLabel(
        Date.parse("2026-10-22T09:00:00Z"),
        "UTC",
        Date.parse("2026-10-23T09:00:00Z"),
      ),
    ).toBe("Result reminder Oct 22 at 9:00, or when you return");
  });
});
