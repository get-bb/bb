// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MULTI_CLICK_SELECTION_REPORT_DELAY_MS,
  SelectableMessageProse,
} from "./SelectableMessageProse.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeWindowSelection({
  commonAncestorContainer,
  focusNode,
  intersectsNode,
  node,
  text,
}: {
  commonAncestorContainer?: Node;
  focusNode?: Node;
  intersectsNode?: (node: Node) => boolean;
  node: Node;
  text: string;
}): Selection {
  const rect = new DOMRect(10, 20, 30, 8);
  const range = {
    commonAncestorContainer: commonAncestorContainer ?? node,
    getBoundingClientRect: () => rect,
    getClientRects: () => ({
      length: 1,
      item: (index: number) => (index === 0 ? rect : null),
    }),
    intersectsNode: intersectsNode ?? (() => true),
  } as unknown as Range;
  return {
    anchorNode: node,
    commonAncestorContainer: commonAncestorContainer ?? node,
    focusNode: focusNode ?? node,
    getRangeAt: () => range,
    isCollapsed: false,
    rangeCount: 1,
    toString: () => text,
  } as unknown as Selection;
}

function mockWindowSelection(args: Parameters<typeof makeWindowSelection>[0]) {
  vi.spyOn(window, "getSelection").mockReturnValue(makeWindowSelection(args));
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

const SHARED_DOCUMENT_EVENT_TYPES = [
  "pointerdown",
  "pointerup",
  "pointercancel",
  "mouseup",
  "selectionchange",
  "keyup",
];

function countSharedListenerCalls(spy: {
  mock: { calls: readonly unknown[][] };
}): number {
  return spy.mock.calls.filter(
    ([type]) =>
      typeof type === "string" && SHARED_DOCUMENT_EVENT_TYPES.includes(type),
  ).length;
}

describe("SelectableMessageProse", () => {
  it("shares one set of document listeners across many mounted messages", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const { rerender, unmount } = render(
      <SelectableMessageProse>First answer</SelectableMessageProse>,
    );
    const addsAfterFirstMount = countSharedListenerCalls(addSpy);

    // Per-tap handler work is O(document listeners): additional messages must
    // reuse the shared registry instead of registering their own handlers.
    rerender(
      <>
        <SelectableMessageProse>First answer</SelectableMessageProse>
        <SelectableMessageProse>Second answer</SelectableMessageProse>
        <SelectableMessageProse>Third answer</SelectableMessageProse>
      </>,
    );
    expect(countSharedListenerCalls(addSpy)).toBe(addsAfterFirstMount);

    // Unmounting the last message must detach the shared listeners.
    unmount();
    expect(countSharedListenerCalls(removeSpy)).toBeGreaterThanOrEqual(
      SHARED_DOCUMENT_EVENT_TYPES.length,
    );
  });

  it("moves the reported selection between messages and clears the previous one", async () => {
    const onSelectFirst = vi.fn();
    const onSelectSecond = vi.fn();
    const { getByText } = render(
      <>
        <SelectableMessageProse onSelect={onSelectFirst}>
          First selectable answer
        </SelectableMessageProse>
        <SelectableMessageProse onSelect={onSelectSecond}>
          Second selectable answer
        </SelectableMessageProse>
      </>,
    );
    const firstTextNode = getByText("First selectable answer").firstChild;
    const secondTextNode = getByText("Second selectable answer").firstChild;
    expect(firstTextNode).not.toBeNull();
    expect(secondTextNode).not.toBeNull();

    mockWindowSelection({ node: firstTextNode!, text: "First selectable" });
    fireEvent.pointerDown(document);
    fireEvent.pointerUp(document);
    await waitFor(() =>
      expect(onSelectFirst).toHaveBeenCalledWith(
        expect.objectContaining({ text: "First selectable" }),
      ),
    );
    expect(onSelectSecond).not.toHaveBeenCalled();

    mockWindowSelection({ node: secondTextNode!, text: "Second selectable" });
    fireEvent.pointerDown(document);
    fireEvent.pointerUp(document);
    await waitFor(() =>
      expect(onSelectSecond).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Second selectable" }),
      ),
    );
    // The first message must clear its stale selection exactly once.
    await waitFor(() => expect(onSelectFirst).toHaveBeenLastCalledWith(null));
  });

  it("keeps selectable prose available to the compact sidebar swipe gesture", () => {
    const { getByText } = render(
      <SelectableMessageProse>Selectable answer text</SelectableMessageProse>,
    );

    expect(
      getByText("Selectable answer text").closest(".select-text"),
    ).not.toBeNull();
    expect(
      getByText("Selectable answer text").closest(
        "[data-sidebar-swipe-selectable]",
      ),
    ).not.toBeNull();
    expect(
      getByText("Selectable answer text").closest("[data-no-sidebar-swipe]"),
    ).toBeNull();
  });

  it("reports a selection only after pointer release", async () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <SelectableMessageProse onSelect={onSelect}>
        Selectable answer text
      </SelectableMessageProse>,
    );
    const textNode = getByText("Selectable answer text").firstChild;
    expect(textNode).not.toBeNull();
    mockWindowSelection({
      node: textNode!,
      text: "answer text",
    });

    fireEvent.pointerDown(document);
    fireEvent(document, new Event("selectionchange"));
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.pointerUp(document);
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ text: "answer text" }),
      ),
    );
  });

  it("reports a touch long-press selection before pointer release", async () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <SelectableMessageProse onSelect={onSelect}>
        Long press selectable answer text
      </SelectableMessageProse>,
    );
    const target = getByText("Long press selectable answer text");
    const textNode = target.firstChild;
    expect(textNode).not.toBeNull();
    mockWindowSelection({
      node: textNode!,
      text: "selectable",
    });

    fireEvent.pointerDown(target, { pointerType: "touch" });
    fireEvent(document, new Event("selectionchange"));

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ text: "selectable" }),
      ),
    );
  });

  it("includes the pointer release point and side when a pointer selection starts in the message", async () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <SelectableMessageProse onSelect={onSelect}>
        Selectable answer text
      </SelectableMessageProse>,
    );
    const target = getByText("Selectable answer text");
    const textNode = target.firstChild;
    expect(textNode).not.toBeNull();
    mockWindowSelection({
      node: textNode!,
      text: "answer text",
    });

    fireEvent.pointerDown(target, { clientX: 12, clientY: 24 });
    fireEvent.pointerUp(document, { clientX: 42, clientY: 84 });

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          anchorPoint: { x: 42, y: 84 },
          anchorSide: "bottom",
          text: "answer text",
        }),
      ),
    );
  });

  it("reports a selection that updates after pointer release", async () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <SelectableMessageProse onSelect={onSelect}>
        Double click selectable answer text
      </SelectableMessageProse>,
    );
    const textNode = getByText(
      "Double click selectable answer text",
    ).firstChild;
    expect(textNode).not.toBeNull();

    fireEvent.pointerDown(document);
    fireEvent.pointerUp(document);
    await waitForAnimationFrame();
    expect(onSelect).not.toHaveBeenCalled();

    mockWindowSelection({
      node: textNode!,
      text: "selectable",
    });
    fireEvent(document, new Event("selectionchange"));

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ text: "selectable" }),
      ),
    );
  });

  it("reports double-click selections from the message click target", async () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { getByText } = render(
      <SelectableMessageProse onSelect={onSelect}>
        Double click target paragraph text
      </SelectableMessageProse>,
    );
    const target = getByText("Double click target paragraph text");
    const textNode = target.firstChild;
    expect(textNode).not.toBeNull();

    mockWindowSelection({
      node: textNode!,
      text: "Double click target paragraph text",
    });
    fireEvent.doubleClick(target, { detail: 2 });

    await vi.advanceTimersByTimeAsync(
      MULTI_CLICK_SELECTION_REPORT_DELAY_MS - 1,
    );
    expect(onSelect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Double click target paragraph text",
      }),
    );
  });

  it("reports triple-click selections from the message click target", async () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <SelectableMessageProse onSelect={onSelect}>
        Triple click selectable paragraph text
      </SelectableMessageProse>,
    );
    const target = getByText("Triple click selectable paragraph text");
    const textNode = target.firstChild;
    expect(textNode).not.toBeNull();

    mockWindowSelection({
      node: textNode!,
      text: "Triple click selectable paragraph text",
    });
    fireEvent.click(target, { detail: 3 });

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Triple click selectable paragraph text",
        }),
      ),
    );
  });

  it("cancels a delayed double-click report when a third click completes", async () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { getByText } = render(
      <SelectableMessageProse onSelect={onSelect}>
        Triple click replaces word selection
      </SelectableMessageProse>,
    );
    const target = getByText("Triple click replaces word selection");
    const textNode = target.firstChild;
    expect(textNode).not.toBeNull();

    let currentSelection = makeWindowSelection({
      node: textNode!,
      text: "Triple",
    });
    vi.spyOn(window, "getSelection").mockImplementation(() => currentSelection);

    fireEvent.doubleClick(target, { detail: 2 });
    await vi.advanceTimersByTimeAsync(
      MULTI_CLICK_SELECTION_REPORT_DELAY_MS - 1,
    );
    expect(onSelect).not.toHaveBeenCalled();

    currentSelection = makeWindowSelection({
      node: textNode!,
      text: "Triple click replaces word selection",
    });
    fireEvent.click(target, { detail: 3 });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Triple click replaces word selection",
      }),
    );

    await vi.advanceTimersByTimeAsync(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("accepts triple-click selections that spill only whitespace past the message", async () => {
    const onSelect = vi.fn();
    const { container, getByTestId, getByText } = render(
      <div>
        <SelectableMessageProse onSelect={onSelect}>
          <p>Boundary paragraph in agent message.</p>
        </SelectableMessageProse>
        <div data-testid="message-actions">Actions</div>
      </div>,
    );
    const target = getByText("Boundary paragraph in agent message.");
    const textNode = target.firstChild;
    const messageNode = container.firstChild;
    const outsideNode = getByTestId("message-actions");
    expect(textNode).not.toBeNull();
    expect(messageNode).not.toBeNull();

    mockWindowSelection({
      commonAncestorContainer: messageNode!,
      focusNode: outsideNode,
      intersectsNode: (node) => node.contains(textNode!),
      node: textNode!,
      text: "Boundary paragraph in agent message.\n\n",
    });
    fireEvent.click(target, { detail: 3 });

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Boundary paragraph in agent message.",
        }),
      ),
    );
  });
});
