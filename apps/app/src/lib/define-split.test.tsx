// @vitest-environment jsdom
import { useLayoutEffect } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defineSplit, useSplitPreload } from "./define-split";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shares a pending intent preload with rendering, preserves props, and stays mounted across parent renders", async () => {
  let finish: (
    value: React.ComponentType<{ label: string }>,
  ) => void = () => {};
  const load = vi.fn(
    () =>
      new Promise<React.ComponentType<{ label: string }>>((resolve) => {
        finish = resolve;
      }),
  );
  const Split = defineSplit({
    id: "editor",
    load,
    loading: ({ label }) => <p>Loading {label}</p>,
    preload: "intent",
  });
  const view = render(<button {...Split.intentProps}>Open</button>);
  expect(load).not.toHaveBeenCalled();
  fireEvent.focus(screen.getByRole("button"));
  fireEvent.pointerEnter(screen.getByRole("button"));
  await act(async () => {});
  view.rerender(<Split label="document" />);
  expect(screen.getByText("Loading document")).toBeTruthy();
  expect(load).toHaveBeenCalledOnce();
  await act(async () =>
    finish(({ label }) => <input aria-label={label} defaultValue="draft" />),
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "unsaved" },
  });
  view.rerender(<Split label="renamed" />);
  expect(screen.getByRole("textbox", { name: "renamed" })).toHaveProperty(
    "value",
    "unsaved",
  );
});

it("keeps load failure local and retries a failed import instead of caching the rejection forever", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const load = vi.fn<() => Promise<React.ComponentType>>();
  load.mockRejectedValueOnce(new Error("offline"));
  load.mockResolvedValueOnce(() => <p>Editor ready</p>);
  const Split = defineSplit({
    id: "retry",
    load,
    loading: () => <p>Loading</p>,
    preload: "render",
  });
  render(
    <>
      <p>Shell stays</p>
      <Split />
    </>,
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText("Shell stays")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Editor ready")).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(2);
});

it("recovers from a rejected speculative preload when the feature is opened", async () => {
  const load = vi.fn<() => Promise<React.ComponentType>>();
  load.mockRejectedValueOnce(new Error("offline"));
  load.mockResolvedValueOnce(() => <p>Ready after preload failure</p>);
  const Split = defineSplit({
    id: "preload-retry",
    load,
    loading: () => null,
    preload: "intent",
  });
  await Split.preload();
  render(<Split />);
  expect(await screen.findByText("Ready after preload failure")).toBeTruthy();
});

it.each(["preload", "previous mount"])(
  "does not commit a loading fallback after %s resolves the component",
  async (warmup) => {
    const fallbackCommitted = vi.fn();
    function Loading() {
      useLayoutEffect(() => {
        fallbackCommitted();
      }, []);
      return <p>Loading cached feature</p>;
    }
    const Split = defineSplit({
      id: "cached-mount",
      load: async () => () => <input aria-label="Cached editor" />,
      loading: Loading,
      preload: "render",
    });
    if (warmup === "preload") {
      await Split.preload();
    } else {
      const first = render(<Split />);
      await screen.findByRole("textbox", { name: "Cached editor" });
      first.unmount();
      fallbackCommitted.mockClear();
    }
    const second = render(<Split />);
    expect(fallbackCommitted).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Cached editor" })).toBeTruthy();
    second.unmount();
  },
);

it.each([
  new TypeError(
    "Failed to fetch dynamically imported module: /assets/editor.js",
  ),
  new TypeError("error loading dynamically imported module: /assets/editor.js"),
  new TypeError("Importing a module script failed."),
])(
  "shares bounded automatic download retries across preload and render: %s",
  async (error) => {
    vi.useFakeTimers();
    const load = vi
      .fn<() => Promise<React.ComponentType>>()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue(() => <p>Recovered editor</p>);
    const Split = defineSplit({
      id: "automatic-retry",
      load,
      loading: () => <p>Loading editor</p>,
      preload: "intent",
    });
    const warm = Split.preload();
    render(<Split />);
    await act(async () => {});
    expect(load).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(499));
    expect(load).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Loading editor")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    await warm;
    expect(load).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Recovered editor")).toBeTruthy();
  },
);

it("stops automatic retries after three attempts and permits a new manual attempt", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const load = vi
    .fn<() => Promise<React.ComponentType>>()
    .mockRejectedValue(
      new TypeError("Failed to fetch dynamically imported module: /editor.js"),
    );
  const Split = defineSplit({
    id: "exhausted-retry",
    load,
    loading: () => <p>Loading editor</p>,
    preload: "render",
  });
  render(<Split />);
  await act(async () => vi.runAllTimersAsync());
  expect(load).toHaveBeenCalledTimes(3);
  expect(screen.getByRole("alert")).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(load).toHaveBeenCalledTimes(3);
  load.mockResolvedValue(() => <p>Recovered editor</p>);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await act(async () => vi.runAllTimersAsync());
  expect(screen.getByText("Recovered editor")).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(4);
});

it.each([
  new SyntaxError("Unexpected token in feature module"),
  new Error("Unable to preload CSS for /assets/editor.css"),
])(
  "does not automatically retry non-JavaScript-download failures: %s",
  async (error) => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const load = vi
      .fn<() => Promise<React.ComponentType>>()
      .mockRejectedValue(error);
    const Split = defineSplit({
      id: "non-download-failure",
      load,
      loading: () => null,
      preload: "render",
    });
    render(<Split />);
    await act(async () => vi.runAllTimersAsync());
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(load).toHaveBeenCalledOnce();
  },
);

it.each([true, false])(
  "warms at idle after paint and cancels on unmount (idle API: %s)",
  async (hasIdleCallback) => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "requestIdleCallback",
      hasIdleCallback
        ? (callback: () => void) => window.setTimeout(callback, 1000)
        : undefined,
    );
    vi.stubGlobal(
      "cancelIdleCallback",
      hasIdleCallback ? window.clearTimeout : undefined,
    );
    const load = vi.fn(async () => () => <p>Warm feature</p>);
    const Split = defineSplit({
      id: "idle",
      load,
      loading: () => null,
      preload: "idle",
    });
    function Page() {
      useSplitPreload(Split);
      return <p>Page stays usable</p>;
    }
    const first = render(<Page />);
    await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(load).not.toHaveBeenCalled();
    first.unmount();
    await act(async () => vi.runAllTimersAsync());
    expect(load).not.toHaveBeenCalled();
    const second = render(<Page />);
    await act(async () => vi.runAllTimersAsync());
    expect(load).toHaveBeenCalledOnce();
    expect(screen.queryByText("Warm feature")).toBeNull();
    second.rerender(<Split />);
    expect(screen.getByText("Warm feature")).toBeTruthy();
    expect(load).toHaveBeenCalledOnce();
  },
);
