// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BottomAnchoredScrollBody } from "./bottom-anchored-scroll-body";

const frameCallbacks = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let footerHeight = 200;
let paddingAtDefaultAction: string | null = null;

function capturePaddingAtDefaultAction() {
  paddingAtDefaultAction =
    document.querySelector<HTMLElement>("[data-page-scroll-viewport]")?.style
      .scrollPaddingBottom ?? null;
}

function runAnimationFrames() {
  const callbacks = [...frameCallbacks.values()];
  frameCallbacks.clear();
  for (const callback of callbacks) callback(performance.now());
}

function renderBody(footer: ReactNode) {
  return render(
    <BottomAnchoredScrollBody footer={footer} maxWidthClassName="max-w-none">
      <p tabIndex={-1}>Transcript</p>
      <div contentEditable suppressContentEditableWarning>
        Inline edit
      </div>
    </BottomAnchoredScrollBody>,
  );
}

function getScrollArea(container: HTMLElement) {
  const scrollArea = container.querySelector<HTMLElement>(
    "[data-page-scroll-viewport]",
  );
  if (!scrollArea) throw new Error("Missing scroll viewport");
  return scrollArea;
}

beforeEach(() => {
  footerHeight = 200;
  paddingAtDefaultAction = null;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return new DOMRect(
        0,
        0,
        600,
        this.hasAttribute("data-scroll-footer") ? footerHeight : 700,
      );
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    frameCallbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frameCallbacks.delete(id);
  });
  window.addEventListener("keydown", capturePaddingAtDefaultAction);
});

afterEach(() => {
  window.removeEventListener("keydown", capturePaddingAtDefaultAction);
  cleanup();
  frameCallbacks.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("excludes the current sticky footer from the browser's page step for paging keys outside the composer", () => {
  const view = renderBody(<textarea aria-label="Composer" />);
  const scrollArea = getScrollArea(view.container);
  const transcript = view.getByText("Transcript");

  for (const key of ["PageDown", "PageUp", " "]) {
    fireEvent.keyDown(transcript, { key });
    expect(paddingAtDefaultAction).toBe("200px");
    act(runAnimationFrames);
    expect(scrollArea.style.scrollPaddingBottom).toBe("");
  }

  footerHeight = 320;
  fireEvent.keyDown(document.body, { key: "PageDown" });
  expect(paddingAtDefaultAction).toBe("320px");
  act(runAnimationFrames);

  view.rerender(
    <BottomAnchoredScrollBody footer={null} maxWidthClassName="max-w-none">
      <p tabIndex={-1}>Transcript</p>
    </BottomAnchoredScrollBody>,
  );
  fireEvent.keyDown(transcript, { key: "PageDown" });
  expect(paddingAtDefaultAction).toBe("");
});

it("never reserves the footer at rest or for keys typed into editors, so focus and caret reveal cannot scroll the transcript", () => {
  const view = renderBody(<textarea aria-label="Composer" />);
  const scrollArea = getScrollArea(view.container);
  expect(scrollArea.style.scrollPaddingBottom).toBe("");

  for (const target of [
    view.getByLabelText("Composer"),
    view.getByText("Inline edit"),
  ]) {
    for (const key of ["PageDown", " ", "a"]) {
      fireEvent.keyDown(target, { key });
      expect(paddingAtDefaultAction).toBe("");
    }
  }
});
