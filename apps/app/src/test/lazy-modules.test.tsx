// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { lazy, Suspense, type ComponentType } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { settleLazyModules } from "./lazy-modules";

afterEach(cleanup);

function trackedImport<T>(value: T, specifier: string): Promise<T> {
  return globalThis.__bbTrackLazyImport(Promise.resolve(value), specifier);
}

function lazyGreeting(text: string) {
  const View = lazy(() =>
    trackedImport({ default: () => <p>{text}</p> }, "./Greeting"),
  );
  return function LazyGreeting() {
    return (
      <Suspense fallback={<p>Loading greeting</p>}>
        <View />
      </Suspense>
    );
  };
}

it("holds a lazy import until the test settles it", async () => {
  const loaded = vi.fn();
  void trackedImport("module", "./Module").then(loaded);

  await vi.waitFor(() => Promise.resolve());
  expect(loaded).not.toHaveBeenCalled();

  await settleLazyModules();
  expect(loaded).toHaveBeenCalledWith("module");
});

it("commits lazy content for synchronous assertions only after settling", async () => {
  const Greeting = lazyGreeting("Hello");
  render(<Greeting />);
  expect(screen.getByText("Loading greeting")).toBeTruthy();

  await settleLazyModules();
  expect(screen.getByText("Hello")).toBeTruthy();
});

it("lets Testing Library waits find lazy content without a module-specific wait", async () => {
  const Greeting = lazyGreeting("Found");
  render(<Greeting />);

  expect(await screen.findByText("Found")).toBeTruthy();
});

it("loads imports an awaited operation starts after settling began", async () => {
  const operation = (async () => {
    await Promise.resolve();
    const value = await trackedImport("module", "./Operation");
    return `${value} ready`;
  })();

  await expect(settleLazyModules(operation)).resolves.toBe("module ready");
});

it("lets findBy wait for an import that starts a microtask after render and outlasts its deadline", async () => {
  const View = lazy(() =>
    Promise.resolve().then(() =>
      globalThis.__bbTrackLazyImport(
        new Promise<{ default: ComponentType }>((resolve) =>
          setTimeout(() => resolve({ default: () => <p>Slow</p> }), 1_500),
        ),
        "./Slow",
      ),
    ),
  );
  render(
    <Suspense fallback={<p>Loading slow</p>}>
      <View />
    </Suspense>,
  );

  expect(await screen.findByText("Slow")).toBeTruthy();
});
