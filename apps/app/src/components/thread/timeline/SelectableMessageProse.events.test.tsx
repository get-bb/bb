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
  vi.spyOn(window, "getSelection").mockReturnValue(
    makeWindowSelection(args),
  );
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

describe("SelectableMessageProse", () => {
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
