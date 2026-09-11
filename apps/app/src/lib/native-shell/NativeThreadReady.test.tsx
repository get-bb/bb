// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeThreadReady } from "./NativeThreadReady";

const mocks = vi.hoisted(() => ({ post: vi.fn(), available: true }));
vi.mock("./native-shell", () => ({
  getNativeShell: () => mocks.available ? { post: mocks.post } : null,
}));

describe("NativeThreadReady", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.available = true;
    mocks.post.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function mount() {
    return render(
      <MemoryRouter initialEntries={["/projects/proj_1/threads/thr_1"]}>
        <NativeThreadReady threadId="thr_1" />
      </MemoryRouter>,
    );
  }

  it("reports the destination only after its content has had a paint opportunity", () => {
    mount();
    act(() => vi.advanceTimersToNextFrame());
    expect(mocks.post).not.toHaveBeenCalled();
    act(() => vi.advanceTimersToNextFrame());
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith({
      type: "thread-ready",
      threadId: "thr_1",
      path: "/projects/proj_1/threads/thr_1",
    });
  });

  it("does not report a page that unmounts before painting", () => {
    const view = mount();
    act(() => vi.advanceTimersToNextFrame());
    view.unmount();
    act(() => vi.advanceTimersToNextFrame());
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("does not require a native bridge in the web app", () => {
    mocks.available = false;
    mount();
    act(() => vi.advanceTimersByTime(100));
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
