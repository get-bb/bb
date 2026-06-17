// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ThreadTimelinePendingTodos } from "@bb/domain";
import { ThreadPlanCard } from "./ThreadPlanCard";

afterEach(cleanup);

const activePlan: ThreadTimelinePendingTodos = {
  sourceSeq: 12,
  updatedAt: 12,
  items: [
    {
      id: "plan:completed",
      text: "Read the existing prompt stack components",
      status: "completed",
    },
    {
      id: "plan:active",
      text: "Render the active plan as a prompt-stack card",
      status: "in_progress",
    },
    {
      id: "plan:pending",
      text: "Add story and regression coverage",
      status: "pending",
    },
  ],
};

const completedPlan: ThreadTimelinePendingTodos = {
  sourceSeq: 13,
  updatedAt: 13,
  items: [
    {
      id: "plan:done",
      text: "Already complete",
      status: "completed",
    },
  ],
};

describe("ThreadPlanCard", () => {
  it("renders active plan steps with summary metadata", () => {
    render(
      <ThreadPlanCard plan={activePlan} isExpanded={true} onToggle={() => {}} />,
    );

    expect(
      screen.getByRole("button", {
        name: "Plan: Render the active plan as a prompt-stack card",
      }),
    ).not.toBeNull();
    expect(screen.getByText("Active")).not.toBeNull();
    expect(screen.getByText("3 steps")).not.toBeNull();
    expect(screen.getByText("1/3 complete")).not.toBeNull();
    expect(document.querySelector('[data-icon="ListTodo"]')).not.toBeNull();
  });

  it("orders active, pending, then completed plan steps", () => {
    render(
      <ThreadPlanCard plan={activePlan} isExpanded={true} onToggle={() => {}} />,
    );

    const active = screen.getAllByText(
      "Render the active plan as a prompt-stack card",
    )[1]!;
    const pending = screen.getByText("Add story and regression coverage");
    const completed = screen.getByText(
      "Read the existing prompt stack components",
    );

    expect(
      active.compareDocumentPosition(pending) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      pending.compareDocumentPosition(completed) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("collapses through the header toggle", () => {
    function Harness() {
      const [expanded, setExpanded] = useState(true);
      return (
        <ThreadPlanCard
          plan={activePlan}
          isExpanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
        />
      );
    }

    render(<Harness />);
    const button = screen.getByRole("button", {
      name: "Plan: Render the active plan as a prompt-stack card",
    });
    const body = document.getElementById("thread-plan-card-body");

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(body?.getAttribute("aria-hidden")).toBe("false");

    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(body?.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not render completed-only plan snapshots", () => {
    const { container } = render(
      <ThreadPlanCard
        plan={completedPlan}
        isExpanded={true}
        onToggle={() => {}}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
