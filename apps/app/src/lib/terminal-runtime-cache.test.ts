import { afterEach, expect, it, vi } from "vitest";
import {
  evictTerminalRuntime,
  MAX_PARKED_TERMINAL_RUNTIMES,
  parkTerminalRuntime,
  takeParkedTerminalRuntime,
} from "./terminal-runtime-cache";

function makeRuntime() {
  return { dispose: vi.fn() };
}

afterEach(() => {
  for (let index = 0; index <= MAX_PARKED_TERMINAL_RUNTIMES; index += 1) {
    evictTerminalRuntime(`term_${index}`);
  }
  evictTerminalRuntime("term_a");
});

it("takes a parked runtime once without disposing it", () => {
  const runtime = makeRuntime();
  parkTerminalRuntime("term_a", runtime);
  expect(takeParkedTerminalRuntime("term_a")).toBe(runtime);
  expect(takeParkedTerminalRuntime("term_a")).toBeNull();
  expect(runtime.dispose).not.toHaveBeenCalled();
});

it("disposes the previous runtime parked under the same id", () => {
  const first = makeRuntime();
  const second = makeRuntime();
  parkTerminalRuntime("term_a", first);
  parkTerminalRuntime("term_a", second);
  expect(first.dispose).toHaveBeenCalledTimes(1);
  expect(second.dispose).not.toHaveBeenCalled();
  expect(takeParkedTerminalRuntime("term_a")).toBe(second);
});

it("disposes the least recently parked runtime beyond the cap", () => {
  const runtimes = Array.from(
    { length: MAX_PARKED_TERMINAL_RUNTIMES + 1 },
    makeRuntime,
  );
  runtimes.forEach((runtime, index) => {
    parkTerminalRuntime(`term_${index}`, runtime);
  });
  expect(runtimes[0]?.dispose).toHaveBeenCalledTimes(1);
  expect(takeParkedTerminalRuntime("term_0")).toBeNull();
  for (const runtime of runtimes.slice(1)) {
    expect(runtime.dispose).not.toHaveBeenCalled();
  }
  expect(
    takeParkedTerminalRuntime(`term_${MAX_PARKED_TERMINAL_RUNTIMES}`),
  ).toBe(runtimes[MAX_PARKED_TERMINAL_RUNTIMES]);
});

it("disposes and removes an evicted runtime", () => {
  const runtime = makeRuntime();
  parkTerminalRuntime("term_a", runtime);
  evictTerminalRuntime("term_a");
  expect(runtime.dispose).toHaveBeenCalledTimes(1);
  expect(takeParkedTerminalRuntime("term_a")).toBeNull();
  evictTerminalRuntime("term_a");
  expect(runtime.dispose).toHaveBeenCalledTimes(1);
});
