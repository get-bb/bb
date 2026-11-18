// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { lazy, Suspense, type ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineSplit } from "@/lib/define-split";
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

const CachedSplit = defineSplit<{ label: string }>({
  id: "lazy-modules-test-cached",
  load: () =>
    trackedImport(({ label }: { label: string }) => <p>{label}</p>, "./Cached"),
  loading: () => <p>Loading cached</p>,
  tier: "intent",
});

const PreparedSplit = defineSplit<{ label: string }>({
  id: "lazy-modules-test-prepared",
  load: () =>
    trackedImport(
      ({ label }: { label: string }) => <p>{label}</p>,
      "./Prepared",
    ),
  loading: () => <p>Loading prepared</p>,
  tier: "intent",
});

const CachedLazy = lazy(() =>
  trackedImport({ default: () => <p>Lazy ready</p> }, "./CachedLazy"),
);

await PreparedSplit.preload();

describe("modules loaded before the current test", { shuffle: false }, () => {
  it("loads a split and a lazy component in one test", async () => {
    render(<CachedSplit label="First" />);
    render(
      <Suspense fallback={<p>Loading lazy</p>}>
        <CachedLazy />
      </Suspense>,
    );
    expect(await screen.findByText("First")).toBeTruthy();
    expect(await screen.findByText("Lazy ready")).toBeTruthy();
    render(<CachedSplit label="Same test" />);
    expect(screen.getByText("Same test")).toBeTruthy();
  });

  it("holds an already-loaded split and lazy component until this test settles", async () => {
    render(<CachedSplit label="Second" />);
    render(
      <Suspense fallback={<p>Loading lazy</p>}>
        <CachedLazy />
      </Suspense>,
    );
    expect(screen.getByText("Loading cached")).toBeTruthy();
    expect(screen.getByText("Loading lazy")).toBeTruthy();

    await settleLazyModules();
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.getByText("Lazy ready")).toBeTruthy();
  });

  it("renders a split the file preloaded during collection immediately", () => {
    render(<PreparedSplit label="Prepared" />);
    expect(screen.getByText("Prepared")).toBeTruthy();
  });
});
