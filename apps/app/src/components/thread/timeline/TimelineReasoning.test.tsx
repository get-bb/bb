// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { systemRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { TimelineReasoningExpansionProvider } from "./TimelineReasoningExpansion";
import { TimelineWorkingIndicator } from "./TimelineWorkingIndicator";

const reasoningId = "thread:op:reasoning:turn-1:item-1";
const thought = systemRow({
  id: reasoningId,
  systemKind: "operation",
  operationKind: "reasoning",
  title: "Thought for 12s",
  detail: "Compare both render paths.",
  status: "completed",
  startedAt: 1_000,
  completedAt: 13_000,
});
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function Fixture({
  phase,
  id = reasoningId,
  text = "Compare both render paths.",
}: {
  phase: "live" | "completed";
  id?: string;
  text?: string;
}) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TimelineReasoningExpansionProvider>
          {phase === "live" ? (
            <TimelineWorkingIndicator
              key={id}
              reasoningId={id}
              isThinking
              details={text}
            />
          ) : (
            <ThreadTimelineRows
              timelineRows={[thought]}
              threadRuntimeDisplayStatus="idle"
              workspaceRootPath={undefined}
            />
          )}
        </TimelineReasoningExpansionProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  client.clear();
});

describe("reasoning disclosure lifecycle", () => {
  it("keeps expansion, the icon, and prose styling when the live indicator becomes a completed row", () => {
    const { container, rerender } = render(<Fixture phase="live" />);
    fireEvent.click(screen.getByRole("button", { name: "Thinking…" }));
    expect(
      screen
        .getByRole("button", { name: "Thinking…" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(container.querySelector('[data-icon="Brain"]')).not.toBeNull();
    rerender(<Fixture phase="completed" />);
    expect(
      screen
        .getByRole("button", { name: /Thought.*12s/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(container.querySelector('[data-icon="Brain"]')).not.toBeNull();
    expect(
      screen.getByText("Compare both render paths.").closest("pre"),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Thought.*12s/ }));
    expect(
      screen
        .getByRole("button", { name: /Thought.*12s/ })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("does not inherit expansion for the next thought and keeps the icon before text arrives", () => {
    const { container, rerender } = render(<Fixture phase="live" text="" />);
    expect(container.querySelector('[data-icon="Brain"]')).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<Fixture phase="live" />);
    fireEvent.click(screen.getByRole("button", { name: "Thinking…" }));
    rerender(<Fixture phase="live" id="next-reasoning" />);
    expect(
      screen
        .getByRole("button", { name: "Thinking…" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
