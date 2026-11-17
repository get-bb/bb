import { act } from "@testing-library/react";
import { vi } from "vitest";

interface ObserverRecord {
  callback: ResizeObserverCallback;
  instance: ResizeObserver;
  targets: Set<Element>;
}

function entryFor(target: Element): ResizeObserverEntry {
  const rect = target.getBoundingClientRect();
  const size = { blockSize: rect.height, inlineSize: rect.width };
  return {
    target,
    contentRect: rect,
    borderBoxSize: [size],
    contentBoxSize: [size],
    devicePixelContentBoxSize: [size],
  };
}

export function stubResizeObserverDeliveries(): () => void {
  const observers = new Set<ObserverRecord>();
  class ResizeObserverStub {
    private readonly record: ObserverRecord;
    constructor(callback: ResizeObserverCallback) {
      this.record = {
        callback,
        instance: this as unknown as ResizeObserver,
        targets: new Set(),
      };
      observers.add(this.record);
    }
    observe(target: Element): void {
      this.record.targets.add(target);
    }
    unobserve(target: Element): void {
      this.record.targets.delete(target);
    }
    disconnect(): void {
      this.record.targets.clear();
      observers.delete(this.record);
    }
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  return () => {
    act(() => {
      for (const { callback, instance, targets } of [...observers]) {
        if (targets.size === 0) continue;
        callback(Array.from(targets, entryFor), instance);
      }
    });
  };
}
