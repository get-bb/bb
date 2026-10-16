// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExpandableTimelineRow } from "./ExpandableTimelineRow";

const title = {
  segments: [],
  decorations: [],
  tone: "default" as const,
  action: null,
  plain: "Commands",
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("settles a refreshed automatic group without retaining or animating its stale body", () => {
  vi.useFakeTimers();
  const row = (autoExpanded: boolean, text: string) => (
    <ExpandableTimelineRow
      autoExpanded={autoExpanded}
      title={title}
      titleContent="Commands"
      renderBody={() => <span>{text}</span>}
    />
  );
  const view = render(row(true, "Two running commands"));
  const body = screen.getByText("Two running commands");
  const region = body.closest<HTMLElement>("[aria-hidden]")!;

  view.rerender(row(false, "Three completed commands"));

  expect(body.isConnected).toBe(false);
  expect(screen.queryByText("Three completed commands")).toBeNull();
  expect(region.style.transitionDuration).toBe("0s");

  fireEvent.click(screen.getByRole("button", { name: "Commands" }));
  expect(screen.getByText("Three completed commands")).toBeTruthy();
  expect(region.style.transitionDuration).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Commands" }));
  expect(screen.getByText("Three completed commands")).toBeTruthy();
  act(() => vi.advanceTimersByTime(200));
  expect(screen.queryByText("Three completed commands")).toBeNull();
});
