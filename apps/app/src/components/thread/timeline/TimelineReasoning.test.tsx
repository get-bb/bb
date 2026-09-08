// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { systemRow, fileReadRow } from "@/test/fixtures/thread-timeline-rows";
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
  nested = false,
}: {
  phase: "live" | "completed";
  id?: string;
  text?: string;
  nested?: boolean;
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
              timelineRows={[
                nested
                  ? {
                      ...thought,
                      id: "delegation:child:" + reasoningId,
                      systemKind: "operation",
                      operationKind: "reasoning",
                      reasoningId,
                      completedAt: 13_000,
                    }
                  : thought,
              ]}
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
  it.each([false, true])(
    "keeps expansion and prose styling on completion (nested: %s)",
    (nested) => {
      const { container, rerender } = render(
        <Fixture phase="live" nested={nested} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Thinking…" }));
      expect(
        screen
          .getByRole("button", { name: "Thinking…" })
          .getAttribute("aria-expanded"),
      ).toBe("true");
      expect(container.querySelector('[data-icon="AiBrain01"]')).toBeNull();
      rerender(<Fixture phase="completed" nested={nested} />);
      expect(
        screen
          .getByRole("button", { name: /Thought.*12s/ })
          .getAttribute("aria-expanded"),
      ).toBe("true");
      expect(container.querySelector('[data-icon="AiBrain01"]')).not.toBeNull();
      expect(
        screen.getByText("Compare both render paths.").closest("pre"),
      ).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Thought.*12s/ }));
      expect(
        screen
          .getByRole("button", { name: /Thought.*12s/ })
          .getAttribute("aria-expanded"),
      ).toBe("false");
    },
  );

  it("does not inherit expansion for the next thought and omits the icon before text arrives", () => {
    const { container, rerender } = render(<Fixture phase="live" text="" />);
    expect(container.querySelector('[data-icon="AiBrain01"]')).toBeNull();
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

it("reveals interleaved reasoning inside an exploration group", () => {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TimelineReasoningExpansionProvider>
          <ThreadTimelineRows
            timelineRows={[
              fileReadRow({ id: "read-a", path: "a.ts", seq: 1 }),
              thought,
              fileReadRow({ id: "read-b", path: "b.ts", seq: 3 }),
            ]}
            threadRuntimeDisplayStatus="idle"
            workspaceRootPath={undefined}
          />
        </TimelineReasoningExpansionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.queryByRole("button", { name: /Thought.*12s/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Explored 2 files/ }));
  fireEvent.click(screen.getByRole("button", { name: /Thought.*12s/ }));
  expect(screen.getByText("Compare both render paths.")).toBeTruthy();
});
