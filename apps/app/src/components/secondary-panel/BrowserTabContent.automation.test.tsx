// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserAutomationIndicator } from "./BrowserTabContent";

afterEach(cleanup);

describe("Browser automation tab indicator", () => {
  it("shows the owning thread and exposes an accessible active Stop control", () => {
    const onStop = vi.fn();
    const { rerender } = render(
      <BrowserAutomationIndicator active onStop={onStop} threadId="thr_owner" />,
    );

    expect(screen.getByText("Agent using this tab")).toBeTruthy();
    expect(screen.getByText(/Thread thr_owner/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Stop agent Browser automation" }),
    );
    expect(onStop).toHaveBeenCalledOnce();

    rerender(
      <BrowserAutomationIndicator
        active={false}
        onStop={onStop}
        threadId="thr_owner"
      />,
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Stop agent Browser automation",
      }).disabled,
    ).toBe(true);
  });
});
