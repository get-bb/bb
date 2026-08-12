// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useOverflowMeasurement } from "./conversation-message-overflow";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function OverflowProbe({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const measurement = useOverflowMeasurement({
    elementRef: ref,
    enabled: true,
    measurementKey: name,
  });
  return (
    <div ref={ref} data-testid={name} data-measurement={measurement} />
  );
}

describe("useOverflowMeasurement", () => {
  it("shares one observer and batches measurements for all rows", () => {
    let observerCallback: ResizeObserverCallback | null = null;
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    const constructorSpy = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          constructorSpy();
          observerCallback = callback;
        }
        observe = observe;
        unobserve = unobserve;
        disconnect = disconnect;
      },
    );

    render(
      <>
        <OverflowProbe name="first" />
        <OverflowProbe name="second" />
      </>,
    );

    const first = screen.getByTestId("first");
    const second = screen.getByTestId("second");
    Object.defineProperties(first, {
      scrollHeight: { configurable: true, value: 80 },
      clientHeight: { configurable: true, value: 20 },
      scrollWidth: { configurable: true, value: 20 },
      clientWidth: { configurable: true, value: 20 },
    });
    Object.defineProperties(second, {
      scrollHeight: { configurable: true, value: 20 },
      clientHeight: { configurable: true, value: 20 },
      scrollWidth: { configurable: true, value: 20 },
      clientWidth: { configurable: true, value: 20 },
    });

    act(() => {
      observerCallback?.(
        [
          { target: first } as unknown as ResizeObserverEntry,
          { target: second } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    });

    expect(constructorSpy).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledTimes(2);
    expect(first.dataset.measurement).toBe("overflowing");
    expect(second.dataset.measurement).toBe("fits");
  });
});
