// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backgroundCommandRow,
  workflowRow,
} from "@/test/fixtures/thread-timeline-rows";
import { ThreadBackgroundCommandsCard } from "./ThreadBackgroundCommandsCard";

const NOW = 1_800_000_000_000;

function runningCommand(
  id: string,
  description: string,
  secondsAgo: number,
): TimelineWorkflowWorkRow {
  return backgroundCommandRow({
    id,
    description,
    startedAt: NOW - secondsAgo * 1_000,
    status: "pending",
    taskStatus: "running",
  });
}

const newestFirst = [
  runningCommand("bg:wait", "Wait seven minutes then check run progress", 42),
  runningCommand("bg:e2e", "Run the E2E harness against PR-E 088f81214", 127),
  runningCommand("bg:tail", "Tail the dev server log", 663),
];

function StatefulCard({ commands }: { commands: TimelineWorkflowWorkRow[] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <ThreadBackgroundCommandsCard
      commands={commands}
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded((value) => !value)}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ThreadBackgroundCommandsCard", () => {
  it("shows how long the newest command has run while the others are folded", () => {
    render(<StatefulCard commands={newestFirst} />);

    const toggle = screen.getByRole("button", {
      name: "Background commands (3): Wait seven minutes then check run progress",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("42s");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("unfolds the older commands above the newest, oldest first, from the same row", () => {
    render(<StatefulCard commands={newestFirst} />);
    const toggle = screen.getByRole("button", {
      name: /^Background commands \(3\)/,
    });
    toggle.focus();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(toggle);
    const list = screen.getByRole("list");
    expect(toggle.getAttribute("aria-controls")).toBe(list.id);
    expect(
      list.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const [oldest, middle] = screen.getAllByRole("listitem");
    expect(oldest?.textContent).toContain("Tail the dev server log");
    expect(oldest?.textContent).toContain("11m 3s");
    expect(middle?.textContent).toContain(
      "Run the E2E harness against PR-E 088f81214",
    );
    expect(middle?.textContent).toContain("2m 7s");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("11m 3s");
    expect(toggle.textContent).toContain("42s");
  });

  it("forgets the unfolded rows once fewer than two commands run", () => {
    const [newest] = newestFirst;
    if (!newest) throw new Error("Expected a fixture command.");
    const { container, rerender } = render(
      <StatefulCard commands={newestFirst} />,
    );
    const toggle = screen.getByRole("button");
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    rerender(<StatefulCard commands={[newest]} />);
    rerender(<StatefulCard commands={newestFirst} />);

    expect(container.querySelectorAll("li")).toHaveLength(0);
  });

  it("renders a single command as a plain row with its duration", () => {
    const [newest] = newestFirst;
    if (!newest) throw new Error("Expected a fixture command.");
    render(<StatefulCard commands={[newest]} />);

    const card = screen.getByRole("region", { name: "Background commands" });
    expect(screen.queryByRole("button")).toBeNull();
    expect(card.textContent).toContain(
      "Wait seven minutes then check run progress",
    );
    expect(card.textContent).toContain("42s");
  });

  it("labels mixed activity and shows a background agent's model", () => {
    const [, e2e] = newestFirst;
    if (!e2e) throw new Error("Expected a fixture command.");
    const agent = workflowRow({
      id: "bg:agent",
      description: "Audit plugin pin fixtures",
      model: "haiku",
      startedAt: NOW - 5_000,
      status: "pending",
      taskStatus: "running",
      taskType: "local_agent",
      workflowName: null,
    });
    render(<StatefulCard commands={[agent, e2e]} />);

    expect(
      screen.getByRole("button", {
        name: "Background activity (2): Audit plugin pin fixtures · Model haiku",
      }),
    ).toBeTruthy();
    expect(screen.getByTitle("Model: haiku").textContent).toBe("haiku");
  });
});

describe("prompt-stack card bodies", () => {
  it("mounts only the newest row's live duration until a background-activity card first opens", () => {
    vi.useFakeTimers();
    const setInterval = vi.spyOn(globalThis, "setInterval");
    const startedAt = Date.now() - 5_000;
    function Card() {
      const [isExpanded, setIsExpanded] = useState(false);
      return (
        <ThreadBackgroundCommandsCard
          commands={[1, 2, 3].map((index) =>
            workflowRow({
              id: `wf_${index}`,
              description: `Background agent ${index}`,
              model: "haiku",
              startedAt,
              status: "pending",
              taskStatus: "running",
              taskType: "local_agent",
              workflowName: null,
            }),
          )}
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded((value) => !value)}
        />
      );
    }
    render(<Card />);
    expect(screen.queryByText("Background agent 2")).toBeNull();
    expect(setInterval).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Background agent 2")).not.toBeNull();
    expect(setInterval).toHaveBeenCalledTimes(1);
  });
});
