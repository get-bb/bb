// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  getActiveThreadPanelOpener,
  resetActiveThreadPanelOpenerForTest,
  usePublishThreadPanelOpener,
  type PluginThreadPanelOpenHandler,
} from "./plugin-thread-panel-navigation";

function Pane({
  opener,
  isFocused,
}: {
  opener: PluginThreadPanelOpenHandler;
  isFocused: boolean;
}) {
  usePublishThreadPanelOpener(opener, isFocused);
  return null;
}

afterEach(() => {
  cleanup();
  resetActiveThreadPanelOpenerForTest();
});

it("publishes only the focused pane's opener", () => {
  // A split mounts one thread view per pane, each with its own panel tabs, so
  // an unscoped store would open a plugin's panel in whichever pane mounted
  // last rather than the one the user is looking at.
  const left = vi.fn(() => true);
  const right = vi.fn(() => true);
  const { rerender } = render(
    <>
      <Pane opener={left} isFocused={true} />
      <Pane opener={right} isFocused={false} />
    </>,
  );

  getActiveThreadPanelOpener()?.({ actionId: "a", pluginId: "p" });
  expect(left).toHaveBeenCalledTimes(1);
  expect(right).not.toHaveBeenCalled();

  rerender(
    <>
      <Pane opener={left} isFocused={false} />
      <Pane opener={right} isFocused={true} />
    </>,
  );
  getActiveThreadPanelOpener()?.({ actionId: "a", pluginId: "p" });
  expect(right).toHaveBeenCalledTimes(1);
  expect(left).toHaveBeenCalledTimes(1);
});

it("reports no opener when no thread view is focused", () => {
  render(<Pane opener={vi.fn(() => true)} isFocused={false} />);
  expect(getActiveThreadPanelOpener()).toBeNull();
});
