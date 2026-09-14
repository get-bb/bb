// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";

function renderTooltip(onFocus?: () => void) {
  return render(
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger onFocus={onFocus}>Open usage</TooltipTrigger>
        <TooltipContent>Provider usage</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );
}

function tooltipLabels(): string[] {
  return screen
    .queryAllByRole("tooltip")
    .map((node) => node.textContent?.trim() ?? "");
}

afterEach(cleanup);

describe("tooltip focus modality", () => {
  it("stays closed when focus arrives after pointer input", () => {
    renderTooltip();
    const trigger = screen.getByRole("button", { name: "Open usage" });

    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.pointerUp(trigger, { pointerType: "touch" });
    fireEvent.focus(trigger);

    expect(tooltipLabels()).toEqual([]);
  });

  it("stays closed when an overlay restores focus after a pointer dismissal", () => {
    renderTooltip();
    const trigger = screen.getByRole("button", { name: "Open usage" });

    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    fireEvent.pointerUp(document.body, { pointerType: "touch" });
    trigger.focus();
    fireEvent.focus(trigger);

    expect(tooltipLabels()).toEqual([]);
  });

  it("opens when focus arrives after keyboard input", () => {
    renderTooltip();
    const trigger = screen.getByRole("button", { name: "Open usage" });

    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.focus(trigger);

    expect(tooltipLabels()).toEqual(["Provider usage"]);
  });

  it("opens on pointer hover regardless of the last input modality", async () => {
    renderTooltip();
    const trigger = screen.getByRole("button", { name: "Open usage" });

    fireEvent.pointerDown(document.body, { pointerType: "mouse" });
    fireEvent.pointerMove(trigger, { pointerType: "mouse" });

    await waitFor(() => {
      expect(tooltipLabels()).toEqual(["Provider usage"]);
    });
  });

  it("still runs a caller-supplied focus handler", () => {
    const onFocus = vi.fn();
    renderTooltip(onFocus);
    const trigger = screen.getByRole("button", { name: "Open usage" });

    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.pointerUp(trigger, { pointerType: "touch" });
    fireEvent.focus(trigger);

    expect(onFocus).toHaveBeenCalledOnce();
  });
});
