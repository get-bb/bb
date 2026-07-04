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

  detach = attachTerminalTouchScroll(container);
  return { screen, viewport };
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
  it("scrolls the viewport as the finger drags, in the natural direction", () => {
    const { screen, viewport } = mountTerminal({ scrollTop: 500 });

    screen.dispatchEvent(touchEvent("touchstart", 100));
    // Drag down 30px reveals earlier scrollback: scrollTop decreases.
    const moveDown = touchEvent("touchmove", 130);
    screen.dispatchEvent(moveDown);
    expect(viewport.scrollTop).toBe(470);
    expect(moveDown.defaultPrevented).toBe(true);

    // Drag back up 10px scrolls toward the bottom again.
    const moveUp = touchEvent("touchmove", 120);
    screen.dispatchEvent(moveUp);
    expect(viewport.scrollTop).toBe(480);
    expect(moveUp.defaultPrevented).toBe(true);
  });

  it("leaves taps alone: a sub-threshold drag does not scroll or preventDefault", () => {
    const { screen, viewport } = mountTerminal({ scrollTop: 500 });

    screen.dispatchEvent(touchEvent("touchstart", 100));
    const tinyMove = touchEvent("touchmove", 102);
    screen.dispatchEvent(tinyMove);

    expect(viewport.scrollTop).toBe(500);
    expect(tinyMove.defaultPrevented).toBe(false);
  });

  it("does not engage when there is nothing to scroll", () => {
    const { screen, viewport } = mountTerminal({
      scrollTop: 0,
      scrollHeight: 200,
      clientHeight: 200,
    });

    screen.dispatchEvent(touchEvent("touchstart", 100));
    const move = touchEvent("touchmove", 160);
    screen.dispatchEvent(move);

    expect(viewport.scrollTop).toBe(0);
    expect(move.defaultPrevented).toBe(false);
  });

  it("ignores multi-touch gestures", () => {
    const { screen, viewport } = mountTerminal({ scrollTop: 500 });

    screen.dispatchEvent(touchEvent("touchstart", 100));
    const pinch = multiTouchEvent("touchmove", [130, 260]);
    screen.dispatchEvent(pinch);

    expect(viewport.scrollTop).toBe(500);
    expect(pinch.defaultPrevented).toBe(false);
  });

  it("stops scrolling after the gesture ends", () => {
    const { screen, viewport } = mountTerminal({ scrollTop: 500 });

    screen.dispatchEvent(touchEvent("touchstart", 100));
    screen.dispatchEvent(touchEvent("touchmove", 130));
    expect(viewport.scrollTop).toBe(470);

    screen.dispatchEvent(touchEvent("touchend", null));
    const strayMove = touchEvent("touchmove", 300);
    screen.dispatchEvent(strayMove);
    expect(viewport.scrollTop).toBe(470);
  });

  it("detaches its listeners", () => {
    const { screen, viewport } = mountTerminal({ scrollTop: 500 });

    detach?.();
    detach = null;

    screen.dispatchEvent(touchEvent("touchstart", 100));
    screen.dispatchEvent(touchEvent("touchmove", 130));
    expect(viewport.scrollTop).toBe(500);
  });
});
