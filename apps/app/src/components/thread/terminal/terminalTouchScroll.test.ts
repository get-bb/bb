// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { attachTerminalTouchScroll } from "./terminalTouchScroll";

interface ViewportMetrics {
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
}

let detach: (() => void) | null = null;

afterEach(() => {
  detach?.();
  detach = null;
  document.body.innerHTML = "";
});

function mountTerminal(metrics: ViewportMetrics = {}) {
  const {
    scrollTop: initialScrollTop = 500,
    scrollHeight = 1000,
    clientHeight = 200,
  } = metrics;

  const container = document.createElement("div");
  const viewport = document.createElement("div");
  viewport.className = "xterm-viewport";
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  container.append(viewport, screen);
  document.body.appendChild(container);

  let scrollTop = initialScrollTop;
  Object.defineProperty(viewport, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  Object.defineProperty(viewport, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(viewport, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });

  const wheelDeltas: number[] = [];
  detach = attachTerminalTouchScroll(container, {
    dispatchWheel: (deltaY) => wheelDeltas.push(deltaY),
  });
  return { screen, viewport, wheelDeltas };
}

function touchEvent(type: string, clientY: number | null): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: clientY === null ? [] : [{ clientY }],
  });
  return event;
}

function multiTouchEvent(type: string, clientYs: number[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: clientYs.map((clientY) => ({ clientY })),
  });
  return event;
}

describe("attachTerminalTouchScroll", () => {
  it("dispatches wheel deltas as the finger drags, in the natural direction", () => {
    const { screen, wheelDeltas } = mountTerminal({ scrollTop: 500 });

    screen.dispatchEvent(touchEvent("touchstart", 100));
    // Drag down reveals earlier scrollback: negative wheel delta.
    const moveDown = touchEvent("touchmove", 130);
    screen.dispatchEvent(moveDown);
    expect(wheelDeltas).toEqual([-75]);
    expect(moveDown.defaultPrevented).toBe(true);

    // Drag back up scrolls toward the bottom again.
    const moveUp = touchEvent("touchmove", 120);
    screen.dispatchEvent(moveUp);
    expect(wheelDeltas).toEqual([-75, 25]);
    expect(moveUp.defaultPrevented).toBe(true);
  });

  it("leaves taps alone: a sub-threshold drag does not scroll or preventDefault", () => {
    const { screen, wheelDeltas } = mountTerminal({ scrollTop: 500 });

    screen.dispatchEvent(touchEvent("touchstart", 100));
    const tinyMove = touchEvent("touchmove", 102);
    screen.dispatchEvent(tinyMove);

    expect(wheelDeltas).toEqual([]);
    expect(tinyMove.defaultPrevented).toBe(false);
  });

  it("dispatches wheel events even when DOM viewport overflow is unavailable", () => {
    const { screen, wheelDeltas } = mountTerminal({
      clientHeight: 200,
      scrollHeight: 200,
    });

    screen.dispatchEvent(touchEvent("touchstart", 100));
    const move = touchEvent("touchmove", 130);
    screen.dispatchEvent(move);

    expect(wheelDeltas).toEqual([-75]);
    expect(move.defaultPrevented).toBe(true);
  });

  it("ignores multi-touch gestures", () => {
    const { screen, wheelDeltas } = mountTerminal({ scrollTop: 500 });

    screen.dispatchEvent(touchEvent("touchstart", 100));
    const pinch = multiTouchEvent("touchmove", [130, 260]);
    screen.dispatchEvent(pinch);

    expect(wheelDeltas).toEqual([]);
    expect(pinch.defaultPrevented).toBe(false);
  });

  it("stops scrolling after the gesture ends", () => {
    const { screen, wheelDeltas } = mountTerminal({ scrollTop: 500 });

    screen.dispatchEvent(touchEvent("touchstart", 100));
    screen.dispatchEvent(touchEvent("touchmove", 130));
    expect(wheelDeltas).toEqual([-75]);

    screen.dispatchEvent(touchEvent("touchend", null));
    const strayMove = touchEvent("touchmove", 300);
    screen.dispatchEvent(strayMove);
    expect(wheelDeltas).toEqual([-75]);
  });

  it("detaches its listeners", () => {
    const { screen, wheelDeltas } = mountTerminal({ scrollTop: 500 });

    detach?.();
    detach = null;

    screen.dispatchEvent(touchEvent("touchstart", 100));
    screen.dispatchEvent(touchEvent("touchmove", 130));
    expect(wheelDeltas).toEqual([]);
  });
});
