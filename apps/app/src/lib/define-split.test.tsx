// @vitest-environment jsdom
import { StrictMode, useEffect } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  defineSplit,
  scheduleSplitPreloads,
  SplitPreviewProvider,
} from "./define-split";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
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

it("holds a cached feature in preview loading and error without importing, then releases to the real component", async () => {
  const load = vi.fn(async () => () => <p>Actual feature</p>);
  const Split = defineSplit({
    id: "preview",
    load,
    loading: () => <p>Preview loading</p>,
    preload: "render",
  });
  const retry = vi.fn();
  const view = render(
    <SplitPreviewProvider id="preview" state="loading" onRetry={retry}>
      <Split />
    </SplitPreviewProvider>,
  );
  expect(screen.getByText("Preview loading")).toBeTruthy();
  await act(async () => {});
  expect(load).not.toHaveBeenCalled();
  view.rerender(
    <SplitPreviewProvider id="preview" state="error" onRetry={retry}>
      <Split />
    </SplitPreviewProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledOnce();
  view.rerender(<Split />);
  expect(await screen.findByText("Actual feature")).toBeTruthy();
  view.rerender(
    <SplitPreviewProvider id="preview" state="loading" onRetry={retry}>
      <Split />
    </SplitPreviewProvider>,
  );
  expect(screen.getByText("Preview loading")).toBeTruthy();
  expect(load).toHaveBeenCalledOnce();
});

it("deduplicates startup preloads in StrictMode and cancels idle work when the page unmounts", async () => {
  vi.useFakeTimers();
  const startupLoad = vi.fn(async () => () => null);
  const idleLoad = vi.fn(async () => () => null);
  const renderLoad = vi.fn(async () => () => null);
  const startup = defineSplit({
    id: "startup",
    load: startupLoad,
    loading: () => null,
    preload: "startup",
  });
  const idle = defineSplit({
    id: "idle",
    load: idleLoad,
    loading: () => null,
    preload: "idle",
  });
  const demand = defineSplit({
    id: "demand",
    load: renderLoad,
    loading: () => null,
    preload: "render",
  });
  function Page() {
    useEffect(() => scheduleSplitPreloads([startup, idle, demand]), []);
    return null;
  }
  const view = render(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
  await act(async () => {});
  expect(startupLoad).toHaveBeenCalledOnce();
  expect(idleLoad).not.toHaveBeenCalled();
  view.unmount();
  await act(async () => vi.runAllTimersAsync());
  expect(idleLoad).not.toHaveBeenCalled();
  render(<Page />);
  await act(async () => vi.runAllTimersAsync());
  expect(idleLoad).toHaveBeenCalledOnce();
  expect(renderLoad).not.toHaveBeenCalled();
});
