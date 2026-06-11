type ElementOverflowMetricName =
  | "clientHeight"
  | "scrollHeight"
  | "clientWidth"
  | "scrollWidth";

interface ElementOverflowMetricDescriptors {
  clientHeight: PropertyDescriptor | undefined;
  scrollHeight: PropertyDescriptor | undefined;
  clientWidth: PropertyDescriptor | undefined;
  scrollWidth: PropertyDescriptor | undefined;
}

export interface ElementOverflowMetrics {
  clientHeight: number;
  scrollHeight: number;
  clientWidth: number;
  scrollWidth: number;
}

function restoreElementOverflowMetric(
  name: ElementOverflowMetricName,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(HTMLElement.prototype, name, descriptor);
    return;
  }
  delete HTMLElement.prototype[name];
}

/**
 * Installs HTMLElement layout metric getters that match real browser behavior
 * for the overflow hook: connected elements report the provided dimensions,
 * detached elements report 0 across the board. Real browsers report 0 for
 * detached nodes; matching that lets tests exercise the detach-mid-life path
 * the hook explicitly guards against.
 */
export function installElementOverflowMetrics(
  metrics: ElementOverflowMetrics,
): ElementOverflowMetricDescriptors {
  const descriptors: ElementOverflowMetricDescriptors = {
    clientHeight: Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    ),
    scrollHeight: Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    ),
    clientWidth: Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    ),
    scrollWidth: Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollWidth",
    ),
  };

  const define = (name: ElementOverflowMetricName, value: number) => {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.isConnected ? value : 0;
      },
    });
  };

  define("clientHeight", metrics.clientHeight);
  define("scrollHeight", metrics.scrollHeight);
  define("clientWidth", metrics.clientWidth);
  define("scrollWidth", metrics.scrollWidth);

  return descriptors;
}

export function restoreElementOverflowMetrics({
  clientHeight,
  scrollHeight,
  clientWidth,
  scrollWidth,
}: ElementOverflowMetricDescriptors): void {
  restoreElementOverflowMetric("clientHeight", clientHeight);
  restoreElementOverflowMetric("scrollHeight", scrollHeight);
  restoreElementOverflowMetric("clientWidth", clientWidth);
  restoreElementOverflowMetric("scrollWidth", scrollWidth);
}

export interface DriveableResizeObserverHandle {
  /** Fire every captured ResizeObserver callback. */
  triggerAll(): void;
  /** Restore the previous global ResizeObserver. */
  restore(): void;
}

/**
 * Replaces the global no-op ResizeObserver polyfill with one we can drive from
 * the test: every constructor captures its callback, and `triggerAll()` fires
 * them. Lets us simulate "the browser noticed the observed element resized"
 * without depending on a real jsdom ResizeObserver implementation.
 */
export function installDriveableResizeObserver(): DriveableResizeObserverHandle {
  const callbacks: Array<ResizeObserverCallback> = [];
  const previous = window.ResizeObserver;
  class DriveableResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      callbacks.push(callback);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {
      const index = callbacks.indexOf(this.callback);
      if (index >= 0) callbacks.splice(index, 1);
    }
  }
  window.ResizeObserver =
    DriveableResizeObserver as unknown as typeof ResizeObserver;
  return {
    triggerAll(): void {
      for (const callback of callbacks) {
        callback([], {} as ResizeObserver);
      }
    },
    restore(): void {
      window.ResizeObserver = previous;
    },
  };
}
