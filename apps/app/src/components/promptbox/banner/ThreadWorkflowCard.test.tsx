// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workflowRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadWorkflowCard } from "./ThreadWorkflowCard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function ToggleableCard() {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <ThreadWorkflowCard
      hostUnavailable={false}
      workflow={workflowRow({
        id: "row-wf",
        status: "pending",
        taskStatus: "running",
        workflowName: "release-review",
        startedAt: Date.now() - 5_000,
      })}
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded((value) => !value)}
    />
  );
}

describe("ThreadWorkflowCard", () => {
  it("opens from the card, closes from the chevron row, and moves focus with each toggle", () => {
    render(<ToggleableCard />);

    const header = screen.getByRole("button", {
      name: "Workflow: release-review",
    });
    const body = document.getElementById(header.getAttribute("aria-controls")!);
    expect(body?.getAttribute("aria-labelledby")).toBe(header.id);
    expect(header.querySelector('[data-icon="ChevronDown"]')).not.toBeNull();

    fireEvent.click(header);
    const collapse = screen.getByRole("button", {
      name: "Collapse workflow release-review",
    });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(header.querySelector('[data-icon="ChevronDown"]')).toBeNull();
    expect(document.activeElement).toBe(collapse);

    fireEvent.click(collapse);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(header);
  });

  it("says the machine is offline instead of counting time", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    render(
      <ThreadWorkflowCard
        hostUnavailable
        workflow={workflowRow({
          id: "row-wf",
          status: "pending",
          taskStatus: "running",
          workflowName: "release-review",
          startedAt: Date.now() - 60_000,
        })}
        isExpanded={false}
        onToggle={() => {}}
      />,
    );

    const header = screen.getByRole("button", {
      name: "Workflow, machine offline: release-review",
    });
    expect(header.textContent).toContain("machine offline");
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});
