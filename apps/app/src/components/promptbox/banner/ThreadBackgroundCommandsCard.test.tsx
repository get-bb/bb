// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backgroundCommandRow,
  workflowRow,
} from "@/test/fixtures/thread-timeline-rows";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ThreadBackgroundCommandsCard } from "./ThreadBackgroundCommandsCard";

let resizeObserverCallback: ResizeObserverCallback | null = null;
let resizeObserver: TestResizeObserver | null = null;

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
    resizeObserver = this;
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

function reportCardWidth(target: Element, width: number): void {
  if (!resizeObserverCallback || !resizeObserver) {
    throw new Error("Expected the background card to observe its width.");
  }
  const callback = resizeObserverCallback;
  const observer = resizeObserver;
  const size: ResizeObserverSize = { inlineSize: width, blockSize: 32 };
  const entry: ResizeObserverEntry = {
    target,
    contentRect: new DOMRect(0, 0, width, 32),
    borderBoxSize: [size],
    contentBoxSize: [size],
    devicePixelContentBoxSize: [size],
  };
  act(() => callback([entry], observer));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resizeObserverCallback = null;
  resizeObserver = null;
});

describe("ThreadBackgroundCommandsCard", () => {
  it("summarizes and expands a single background command in compact mode", () => {
    const description = "Poll all CI runs for batching head until completion";
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    function CompactCard() {
      const [isExpanded, setIsExpanded] = useState(false);
      return (
        <CompactViewportOverrideProvider isCompactViewport>
          <ThreadBackgroundCommandsCard
            commands={[
              backgroundCommandRow({
                description,
                startedAt: 1,
                status: "pending",
                taskStatus: "running",
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
      name: "Running 1 background command",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(setIntervalSpy).not.toHaveBeenCalled();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(description).textContent).toBe(description);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("uses the card width when a narrow composer sits in a wide viewport", () => {
    const description = "Poll all CI runs for batching head until completion";
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <ThreadBackgroundCommandsCard
          commands={[
            backgroundCommandRow({
              description,
              startedAt: 1,
              status: "pending",
              taskStatus: "running",
            }),
          ]}
          isExpanded={false}
          onToggle={() => {}}
        />
      </CompactViewportOverrideProvider>,
    );

    const card = screen.getByRole("region", { name: "Background commands" });
    expect(
      screen.queryByRole("button", { name: "Running 1 background command" }),
    ).toBeNull();

    reportCardWidth(card, 320);

    expect(
      screen.getByRole("button", { name: "Running 1 background command" }),
    ).not.toBeNull();
  });

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
                startedAt: 1,
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

    const item = screen.getByRole("button", {
      name: `Background agent: ${description} · Model haiku`,
    });
    expect(item.textContent).toContain("Running background agent:");
    expect(item.textContent).toContain(description);
    expect(screen.getByTitle("Model: haiku").textContent).toBe("haiku");
  });

  describe("row click-through", () => {
    it("scrolls to and flashes the row when it is already rendered in the main timeline", () => {
      const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
      const description = "Sleep 45 then echo done";
      const row = backgroundCommandRow({
        id: "wf-1",
        description,
        status: "pending",
        taskStatus: "running",
      });

      render(
        <>
          <div data-timeline-row-id="wf-1">Main timeline row</div>
          <ThreadBackgroundCommandsCard
            commands={[row]}
            isExpanded={false}
            onToggle={() => {}}
          />
        </>,
      );

      const target = document.querySelector('[data-timeline-row-id="wf-1"]');
      expect(target).not.toBeNull();

      fireEvent.click(
        screen.getByRole("button", {
          name: `Background command: ${description}`,
        }),
      );

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
      expect(target?.classList.contains("bb-search-flash")).toBe(true);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("opens a detail drawer when the row is not rendered in the main timeline", () => {
      const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
      const description = "Sleep 45 then echo done";
      const row = backgroundCommandRow({
        id: "wf-1",
        description,
        status: "pending",
        taskStatus: "running",
      });

      render(
        <ThreadBackgroundCommandsCard
          commands={[row]}
          isExpanded={false}
          onToggle={() => {}}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: `Background command: ${description}`,
        }),
      );

      expect(scrollIntoView).not.toHaveBeenCalled();
      const dialog = screen.getByRole("dialog");
      expect(dialog.textContent).toContain(description);
    });

    it("targets the clicked row's own id, not always the primary row's, when expanded", () => {
      const primaryDescription = "Poll CI batching head";
      const secondaryDescription = "Sleep 45 then echo done";
      const primary = backgroundCommandRow({
        id: "wf-primary",
        description: primaryDescription,
        status: "pending",
        taskStatus: "running",
      });
      const secondary = backgroundCommandRow({
        id: "wf-secondary",
        description: secondaryDescription,
        status: "pending",
        taskStatus: "running",
      });

      render(
        <>
          <div data-timeline-row-id="wf-secondary">Main timeline row</div>
          <ThreadBackgroundCommandsCard
            commands={[primary, secondary]}
            isExpanded
            onToggle={() => {}}
          />
        </>,
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: `Background command: ${secondaryDescription}`,
        }),
      );

      expect(screen.queryByRole("dialog")).toBeNull();
      const target = document.querySelector(
        '[data-timeline-row-id="wf-secondary"]',
      );
      expect(target?.classList.contains("bb-search-flash")).toBe(true);
    });

    it("does not navigate when the header toggle is clicked", () => {
      const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
      const description = "Sleep 45 then echo done";
      const primary = backgroundCommandRow({
        id: "wf-1",
        description,
        status: "pending",
        taskStatus: "running",
      });
      const secondary = backgroundCommandRow({
        id: "wf-2",
        description: "Another background command",
        status: "pending",
        taskStatus: "running",
      });

      render(
        <ThreadBackgroundCommandsCard
          commands={[primary, secondary]}
          isExpanded={false}
          onToggle={() => {}}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: /^Background commands:/ }),
      );

      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("keeps the drawer in sync when the row's own data updates while it is open", () => {
      function Wrapper() {
        const [row, setRow] = useState(
          backgroundCommandRow({
            id: "wf-1",
            description: "Sleep 45 then echo done",
            status: "pending",
            taskStatus: "running",
          }),
        );
        return (
          <>
            <button
              type="button"
              onClick={() =>
                setRow(
                  backgroundCommandRow({
                    id: "wf-1",
                    description: "Sleep 45 then echo done",
                    status: "completed",
                    taskStatus: "completed",
                    summary: "Background command finished, exit 0",
                  }),
                )
              }
            >
              simulate update
            </button>
            <ThreadBackgroundCommandsCard
              commands={[row]}
              isExpanded={false}
              onToggle={() => {}}
            />
          </>
        );
      }

      render(<Wrapper />);

      fireEvent.click(
        screen.getByRole("button", {
          name: "Background command: Sleep 45 then echo done",
        }),
      );
      expect(screen.getByRole("dialog").textContent).not.toContain(
        "finished, exit 0",
      );

      fireEvent.click(screen.getByText("simulate update"));

      expect(screen.getByRole("dialog").textContent).toContain(
        "finished, exit 0",
      );
    });

    it("keeps showing the row's last known data if it drops out of the commands list while the drawer is open", () => {
      const row = backgroundCommandRow({
        id: "wf-1",
        description: "Sleep 45 then echo done",
        status: "pending",
        taskStatus: "running",
      });
      const other = backgroundCommandRow({
        id: "wf-2",
        description: "Another background command",
        status: "pending",
        taskStatus: "running",
      });

      function Wrapper() {
        // `other` stays primary throughout so the card never unmounts;
        // `row` sits in the expanded list, individually clickable.
        const [commands, setCommands] = useState([other, row]);
        return (
          <>
            <button type="button" onClick={() => setCommands([other])}>
              drop wf-1
            </button>
            <ThreadBackgroundCommandsCard
              commands={commands}
              isExpanded
              onToggle={() => {}}
            />
          </>
        );
      }

      render(<Wrapper />);

      fireEvent.click(
        screen.getByRole("button", {
          name: "Background command: Sleep 45 then echo done",
        }),
      );
      expect(screen.getByRole("dialog").textContent).toContain(
        "Sleep 45 then echo done",
      );

      fireEvent.click(screen.getByText("drop wf-1"));

      expect(screen.getByRole("dialog").textContent).toContain(
        "Sleep 45 then echo done",
      );
    });
  });
});
