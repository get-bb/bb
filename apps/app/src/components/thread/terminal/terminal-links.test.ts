// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import {
  createTerminalOsc8LinkHandler,
  isTerminalLinkActivation,
} from "./terminal-links";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockPlatform(platform: string, coarsePointer: boolean) {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: coarsePointer && query === "(pointer: coarse)",
      }) as MediaQueryList,
  );
}

it.each([
  ["MacIntel", false, {}, false],
  ["MacIntel", false, { metaKey: true }, true],
  ["MacIntel", false, { ctrlKey: true }, false],
  ["MacIntel", false, { metaKey: true, button: 2 }, false],
  ["Linux x86_64", false, {}, false],
  ["Linux x86_64", false, { ctrlKey: true }, true],
  ["Win32", false, { ctrlKey: true }, true],
  ["Win32", false, { metaKey: true }, false],
  ["iPhone", true, {}, true],
  ["iPhone", true, { button: 2 }, false],
])(
  "on %s (coarse pointer %s) a click with %o opens links: %s",
  (platform, coarsePointer, init, opens) => {
    mockPlatform(platform, coarsePointer);
    expect(isTerminalLinkActivation(new MouseEvent("click", init))).toBe(
      opens,
    );
  },
);

it("preserves OSC-8 provenance through hover and modified activation", () => {
  mockPlatform("MacIntel", false);
  const onActivate = vi.fn();
  const onHover = vi.fn();
  const handler = createTerminalOsc8LinkHandler({ onActivate, onHover });
  const uri = "https://example.com/authorize";
  const range = { start: { x: 1, y: 1 }, end: { x: 1, y: 1 } };

  handler.hover?.(new MouseEvent("mousemove"), uri, range);
  handler.activate(new MouseEvent("click"), uri, range);
  expect(onActivate).not.toHaveBeenCalled();
  handler.activate(new MouseEvent("click", { metaKey: true }), uri, range);
  handler.leave?.(new MouseEvent("mouseleave"), uri, range);

  expect(onActivate).toHaveBeenCalledExactlyOnceWith({ source: "osc8", uri });
  expect(onHover).toHaveBeenNthCalledWith(1, { source: "osc8", uri });
  expect(onHover).toHaveBeenNthCalledWith(2, null);
});
