// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { workflowRow } from "@/test/fixtures/thread-timeline-rows";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ThreadBackgroundCommandsCard } from "./ThreadBackgroundCommandsCard";

afterEach(cleanup);

describe("ThreadBackgroundCommandsCard", () => {
  it("summarizes and expands a single background agent in compact mode", () => {
    const description = "Inspect mobile background banner";

    function CompactCard() {
      const [isExpanded, setIsExpanded] = useState(false);
      return (
        <CompactViewportOverrideProvider isCompactViewport>
          <ThreadBackgroundCommandsCard
            commands={[
              workflowRow({
                description,
                model: "haiku",
                startedAt: Date.now() - 2_000,
                status: "pending",
                taskStatus: "running",
                taskType: "local_agent",
                workflowName: null,
              }),
            ]}
            isExpanded={isExpanded}
            onToggle={() => setIsExpanded((value) => !value)}
          />
        </CompactViewportOverrideProvider>
      );
    }

    render(<CompactCard />);

    const toggle = screen.getByRole("button", {
      name: "Running 1 background agent",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(description).textContent).toBe(description);
    expect(screen.getByTitle("Model: haiku").textContent).toBe("haiku");
  });

  it("keeps the detailed single-agent summary on wider screens", () => {
    const description = "Inspect mobile background banner";
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <ThreadBackgroundCommandsCard
          commands={[
            workflowRow({
              description,
              model: "haiku",
              startedAt: Date.now() - 2_000,
              status: "pending",
              taskStatus: "running",
              taskType: "local_agent",
              workflowName: null,
            }),
          ]}
          isExpanded={false}
          onToggle={() => {}}
        />
      </CompactViewportOverrideProvider>,
    );

    const item = screen.getByLabelText(
      `Background agent: ${description} · Model haiku`,
    );
    expect(item.textContent).toContain("Running background agent:");
    expect(item.textContent).toContain(description);
    expect(screen.getByTitle("Model: haiku").textContent).toBe("haiku");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
