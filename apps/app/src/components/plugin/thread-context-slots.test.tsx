// @vitest-environment jsdom

import { useEffect, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalThreadContextSegmentProps } from "@get-bb/plugin-sdk";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  removePluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { ThreadPromptContextBanner } from "@/components/promptbox/banner/ThreadPromptContextBanner";

const lifecycle: string[] = [];
function Segment({
  threadId,
  part,
  segmentCount,
  isExpanded,
  onToggle,
}: ExperimentalThreadContextSegmentProps) {
  const [clicks, setClicks] = useState(0);
  useEffect(() => {
    lifecycle.push(`mount:${threadId}:${part}`);
    return () => {
      lifecycle.push(`unmount:${threadId}:${part}`);
    };
  }, [threadId, part]);
  return part === "summary" ? (
    <button
      onClick={() => {
        setClicks((value) => value + 1);
        onToggle();
      }}
    >
      Plugin {threadId} ({segmentCount}, {clicks})
    </button>
  ) : isExpanded ? (
    <p>Plugin details {threadId}</p>
  ) : null;
}
function Banner({
  threadId = "t1",
  parent = true,
}: {
  threadId?: string;
  parent?: boolean;
}) {
  return (
    <MemoryRouter>
      <ThreadPromptContextBanner
        threadId={threadId}
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={
          parent
            ? {
                parentThreadTitle: "Parent",
                href: "/threads/parent",
                relationship: "parent",
              }
            : null
        }
        childThreadsSection={null}
        pullRequestSection={null}
        expandedSection={null}
        onToggleSection={() => {}}
      />
    </MemoryRouter>
  );
}
function install(useVisible?: (input: { threadId: string }) => boolean) {
  setPluginSlotRegistrations(
    "context-fixture",
    collectPluginAppRegistrations(
      definePluginApp((app) => {
        app.slots.experimental_threadContextSegment({
          id: "context",
          title: "Plugin context",
          component: Segment,
          ...(useVisible ? { useVisible } : {}),
        });
      }),
    ),
  );
}
afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  lifecycle.length = 0;
  vi.restoreAllMocks();
});

describe("thread context contributions", () => {
  it("shares the core parent row, renders details below it, and clears state on thread or generation changes", () => {
    install();
    const view = render(<Banner />);
    const summary = screen.getByRole("button", { name: "Plugin t1 (2, 0)" });
    const core = screen.getByRole("button", { name: /Parent Parent/ });
    expect(
      summary.closest('[aria-label="Thread context before sending"]'),
    ).toBe(core.closest('[aria-label="Thread context before sending"]'));
    fireEvent.click(summary);
    const details = screen.getByText("Plugin details t1");
    expect(summary.parentElement?.contains(details)).toBe(false);
    expect(
      screen.getByRole("button", { name: "Plugin t1 (2, 1)" }),
    ).toBeTruthy();
    view.rerender(<Banner threadId="t2" />);
    expect(
      screen.getByRole("button", { name: "Plugin t2 (2, 0)" }),
    ).toBeTruthy();
    expect(screen.queryByText("Plugin details t2")).toBeNull();
    act(() => install());
    expect(
      screen.getByRole("button", { name: "Plugin t2 (2, 0)" }),
    ).toBeTruthy();
    act(() => removePluginSlotRegistrations("context-fixture"));
    expect(screen.queryByText(/Plugin t2/)).toBeNull();
    expect(screen.getByRole("link", { name: /Parent/ })).toBeTruthy();
    expect(lifecycle).toContain("unmount:t1:summary");
    expect(
      lifecycle.filter((item) => item === "mount:t2:summary"),
    ).toHaveLength(2);
  });

  it("updates visibility in plugin scope and excludes hidden segments from core's layout", () => {
    let changeVisibility: (value: boolean) => void = () => {};
    install(function useVisible() {
      const [visible, setVisible] = useState(false);
      changeVisibility = setVisible;
      return visible;
    });
    render(<Banner />);
    expect(screen.getByRole("link", { name: /Parent/ })).toBeTruthy();
    expect(screen.queryByText(/Plugin t1/)).toBeNull();
    act(() => changeVisibility(true));
    expect(
      screen.getByRole("button", { name: "Plugin t1 (2, 0)" }),
    ).toBeTruthy();
    act(() => changeVisibility(false));
    expect(screen.queryByText(/Plugin t1/)).toBeNull();
    expect(screen.getByRole("link", { name: /Parent/ })).toBeTruthy();
  });

  it("observes a plugin even when core has no context to show", () => {
    const visible = vi.fn(() => true);
    install(visible);
    render(<Banner parent={false} />);
    expect(visible).toHaveBeenCalledWith({ threadId: "t1" });
    expect(
      screen.getByRole("button", { name: "Plugin t1 (1, 0)" }),
    ).toBeTruthy();
  });

  it("does not mount any contribution without a thread", () => {
    const visible = vi.fn(() => true);
    install(visible);
    render(<Banner threadId="" parent={false} />);
    expect(visible).not.toHaveBeenCalled();
    expect(lifecycle).toEqual([]);
  });

  it("contains a visibility-hook crash and preserves core context", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let crash: () => void = () => {};
    install(function useVisible() {
      const [failed, setFailed] = useState(false);
      crash = () => setFailed(true);
      if (failed) throw new Error("fixture visibility");
      return true;
    });
    render(<Banner />);
    expect(
      screen.getByRole("button", { name: "Plugin t1 (2, 0)" }),
    ).toBeTruthy();
    act(crash);
    expect(screen.getByRole("link", { name: /Parent/ })).toBeTruthy();
    expect(screen.queryByText(/Plugin t1/)).toBeNull();
  });
});
