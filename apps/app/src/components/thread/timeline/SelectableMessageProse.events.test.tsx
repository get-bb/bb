// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectableMessageProse } from "./SelectableMessageProse.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeWindowSelection({
  node,
  text,
}: {
  node: Node;
  text: string;
}): Selection {
  const rect = new DOMRect(10, 20, 30, 8);
  const range = {
    commonAncestorContainer: node,
    getBoundingClientRect: () => rect,
    getClientRects: () => ({
      length: 1,
      item: (index: number) => (index === 0 ? rect : null),
    }),
  } as unknown as Range;
  return {
    anchorNode: node,
    commonAncestorContainer: node,
    focusNode: node,
    getRangeAt: () => range,
    isCollapsed: false,
    rangeCount: 1,
    toString: () => text,
  } as unknown as Selection;
}

function mockWindowSelection({ node, text }: { node: Node; text: string }) {
  vi.spyOn(window, "getSelection").mockReturnValue(
    makeWindowSelection({ node, text }),
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

  it("reports triple-click selections that settle after pointer release", async () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <SelectableMessageProse onSelect={onSelect}>
        Triple click selectable paragraph text
      </SelectableMessageProse>,
    );
    const textNode = getByText(
      "Triple click selectable paragraph text",
    ).firstChild;
    expect(textNode).not.toBeNull();

    fireEvent.pointerDown(document);
    fireEvent(document, new Event("selectionchange"));
    fireEvent.pointerUp(document);
    expect(onSelect).not.toHaveBeenCalled();

    mockWindowSelection({
      node: textNode!,
      text: "Triple click selectable paragraph text",
    });
    fireEvent.click(document, { detail: 3 });

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Triple click selectable paragraph text",
        }),
      ),
    );
  });

  it("keeps checking triple-click selections that arrive after the first settled read", async () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <SelectableMessageProse onSelect={onSelect}>
        Late triple click selectable paragraph text
      </SelectableMessageProse>,
    );
    const textNode = getByText(
      "Late triple click selectable paragraph text",
    ).firstChild;
    expect(textNode).not.toBeNull();

    const selection = makeWindowSelection({
      node: textNode!,
      text: "Late triple click selectable paragraph text",
    });
    let readCount = 0;
    vi.spyOn(window, "getSelection").mockImplementation(() => {
      readCount += 1;
      return readCount === 1 ? null : selection;
    });

    fireEvent.pointerDown(document);
    fireEvent.pointerUp(document);
    fireEvent.click(document, { detail: 3 });

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Late triple click selectable paragraph text",
        }),
      ),
    );
  });
});
