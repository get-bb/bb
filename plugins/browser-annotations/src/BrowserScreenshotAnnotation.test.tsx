// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { BrowserScreenshotAnnotation } from "./BrowserScreenshotAnnotation";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLCanvasElement.prototype, "setPointerCapture");
  Reflect.deleteProperty(HTMLCanvasElement.prototype, "hasPointerCapture");
  Reflect.deleteProperty(HTMLCanvasElement.prototype, "releasePointerCapture");
});

function stubResizeObserver(): void {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect() {}
      observe() {}
    },
  );
}

function stubImageRect(
  image: HTMLElement,
  naturalWidth: number,
  naturalHeight: number,
  displayedWidth: number,
  displayedHeight: number,
): void {
  Object.defineProperty(image, "naturalWidth", { value: naturalWidth });
  Object.defineProperty(image, "naturalHeight", { value: naturalHeight });
  image.getBoundingClientRect = () =>
    ({
      bottom: displayedHeight,
      height: displayedHeight,
      left: 0,
      right: displayedWidth,
      top: 0,
      width: displayedWidth,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  fireEvent.load(image);
}

function stubCanvasRect(
  canvas: HTMLElement,
  width: number,
  height: number,
): void {
  canvas.getBoundingClientRect = () =>
    ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

function installPointerCaptureFakes(): void {
  Object.defineProperty(HTMLCanvasElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => true,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
}

describe("BrowserScreenshotAnnotation", () => {
  it("labels every toolbar button with a tooltip", async () => {
    stubResizeObserver();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(
      <TooltipProvider delayDuration={0}>
        <BrowserScreenshotAnnotation
          screenshotUrl="data:image/png;base64,AA=="
          onClose={() => {}}
        />
      </TooltipProvider>,
    );

    const buttonNames = [
      "Pen",
      "Highlighter",
      "Arrow",
      "Rectangle",
      "Ellipse",
      "Text",
      "Red ink",
      "Orange ink",
      "Yellow ink",
      "Green ink",
      "Blue ink",
      "Dark ink",
      "White ink",
      "Undo",
      "Redo",
      "Clear all",
      "Copy PNG",
      "Save PNG",
    ];
    for (const name of buttonNames) {
      expect(
        screen
          .getByRole("button", { name })
          .parentElement?.hasAttribute("data-state"),
      ).toBe(true);
    }
  });

  it("stores strokes in original-image coordinates across display sizes", async () => {
    stubResizeObserver();
    installPointerCaptureFakes();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      ellipse: vi.fn(),
      lineCap: "round",
      lineJoin: "round",
      lineTo: vi.fn(),
      lineWidth: 1,
      moveTo: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
      strokeStyle: "",
    } as unknown as CanvasRenderingContext2D);
    const onEditorStateChange = vi.fn();
    render(
      <BrowserScreenshotAnnotation
        screenshotUrl="data:image/png;base64,AA=="
        onClose={() => {}}
        onEditorStateChange={onEditorStateChange}
      />,
    );
    const image = screen.getByAltText("Captured browser page");
    const canvas = screen.getByLabelText("Drawing canvas") as HTMLCanvasElement;
    stubImageRect(image, 776, 400, 388, 200);
    stubCanvasRect(canvas, 388, 200);

    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 194,
      clientY: 100,
      pointerId: 1,
    });
    fireEvent.pointerMove(canvas, { clientX: 388, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    const committed = onEditorStateChange.mock.lastCall?.[0];
    expect(committed.shapes).toHaveLength(1);
    const points = committed.shapes[0].points;
    expect(points[0]).toEqual({ x: 388, y: 200 });
    expect(points[1]).toEqual({ x: 776, y: 400 });

    expect(committed.shapes[0].width).toBe(8);
    expect(committed.past).toHaveLength(1);
    expect(committed.redo).toEqual([]);
  });

  it("keeps image-space geometry and line widths while the display scales", async () => {
    const drawImage = vi.fn();
    const strokeRect = vi.fn();
    const contextState: Record<string, number> = { lineWidth: 1 };
    const setWidth = (value: number) => {
      contextState.lineWidth = value;
    };
    const getLineWidth = () => contextState.lineWidth;
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({
        beginPath: vi.fn(),
        clearRect: vi.fn(),
        drawImage,
        ellipse: vi.fn(),
        fillStyle: "",
        fillText: vi.fn(),
        font: "",
        lineCap: "round",
        lineJoin: "round",
        set lineWidth(value: number) {
          setWidth(value);
        },
        get lineWidth() {
          return getLineWidth();
        },
        moveTo: vi.fn(),
        setTransform: vi.fn(),
        stroke: vi.fn(),
        strokeRect,
        strokeStyle: "",
        textBaseline: "top",
      } as unknown as CanvasRenderingContext2D);
    stubResizeObserver();
    render(
      <BrowserScreenshotAnnotation
        screenshotUrl="data:image/png;base64,AA=="
        onClose={() => {}}
        initialEditorState={{
          image: { id: "image", width: 200, height: 100 },
          pendingText: null,
          color: "#3b82f6",
          fontSize: 24,
          past: [],
          redo: [],
          shapes: [
            {
              color: "#3b82f6",
              from: { x: 10, y: 10 },
              id: "rect-1",
              kind: "rect",
              to: { x: 50, y: 40 },
              width: 8,
            },
          ],
          tool: "rect",
          width: 8,
        }}
      />,
    );
    const image = screen.getByAltText("Captured browser page");
    const canvas = screen.getByLabelText("Drawing canvas") as HTMLCanvasElement;
    stubImageRect(image, 200, 100, 100, 50);
    stubCanvasRect(canvas, 100, 50);
    await waitFor(() => {
      expect(strokeRect).toHaveBeenCalledWith(5, 5, 20, 15);
      expect(contextState.lineWidth).toBe(4);
    });
    getContext.mockRestore();
  });

  it("emits committed edits and tool settings through the editor snapshot", async () => {
    stubResizeObserver();
    installPointerCaptureFakes();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      lineCap: "round",
      lineJoin: "round",
      lineTo: vi.fn(),
      lineWidth: 1,
      moveTo: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
    } as unknown as CanvasRenderingContext2D);
    const onEditorStateChange = vi.fn();
    render(
      <BrowserScreenshotAnnotation
        screenshotUrl="data:image/png;base64,AA=="
        onClose={() => {}}
        onEditorStateChange={onEditorStateChange}
      />,
    );
    const image = screen.getByAltText("Captured browser page");
    const canvas = screen.getByLabelText("Drawing canvas") as HTMLCanvasElement;
    stubImageRect(image, 100, 60, 100, 60);
    stubCanvasRect(canvas, 100, 60);

    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerId: 1,
    });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    expect(onEditorStateChange).toHaveBeenCalled();
    const committed = onEditorStateChange.mock.lastCall?.[0];
    expect(committed.shapes).toHaveLength(1);
    expect(committed.shapes[0]).toMatchObject({ kind: "pen" });
    expect(committed.past).toHaveLength(1);
    expect(committed.redo).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Arrow" }));
    const afterTool = onEditorStateChange.mock.lastCall?.[0];
    expect(afterTool.tool).toBe("arrow");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    const afterUndo = onEditorStateChange.mock.lastCall?.[0];
    expect(afterUndo.shapes).toEqual([]);
    expect(afterUndo.redo).toHaveLength(1);
    expect(afterUndo.redo[0]).toHaveLength(1);
  });

  it("stores stroke widths and font sizes in original-image coordinates at creation", async () => {
    stubResizeObserver();
    installPointerCaptureFakes();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fillText: vi.fn(),
      font: "",
      lineCap: "round",
      lineJoin: "round",
      lineTo: vi.fn(),
      lineWidth: 1,
      moveTo: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      textBaseline: "top",
    } as unknown as CanvasRenderingContext2D);
    const onEditorStateChange = vi.fn();
    const { rerender } = render(
      <BrowserScreenshotAnnotation
        screenshotUrl="data:image/png;base64,AA=="
        onClose={() => {}}
        onEditorStateChange={onEditorStateChange}
      />,
    );
    const image = screen.getByAltText("Captured browser page");
    const canvas = screen.getByLabelText("Drawing canvas") as HTMLCanvasElement;
    stubImageRect(image, 776, 400, 388, 200);
    stubCanvasRect(canvas, 388, 200);

    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 97,
      clientY: 50,
      pointerId: 1,
    });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    const pen = onEditorStateChange.mock.lastCall?.[0];
    // The default width is 4 CSS px; at a 0.5 display scale the stored natural
    // width must be 8 so a later full-size redraw renders 8px (the same CSS 4px).
    expect(pen.shapes[0].width).toBe(8);

    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    const sizeSelect = screen.getByLabelText("Text size") as HTMLSelectElement;
    fireEvent.change(sizeSelect, { target: { value: "24" } });
    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 97,
      clientY: 50,
      pointerId: 2,
    });
    const input = screen.getByLabelText("Annotation text") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "note" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const textShape = onEditorStateChange.mock.lastCall?.[0].shapes.find(
      (shape: { kind: string }) => shape.kind === "text",
    );
    expect(textShape.fontSize).toBe(48);
    // Remount with the snapshot keeps natural geometry (no re-scaling).
    rerender(
      <BrowserScreenshotAnnotation
        screenshotUrl="data:image/png;base64,AA=="
        onClose={() => {}}
        onEditorStateChange={onEditorStateChange}
        initialEditorState={onEditorStateChange.mock.lastCall?.[0]}
      />,
    );
    const afterRemount = onEditorStateChange.mock.lastCall?.[0];
    expect(
      afterRemount.shapes.find((s: { kind: string }) => s.kind === "text")
        .fontSize,
    ).toBe(48);
  });

  it("keeps image-space coordinates stable across a display resize", async () => {
    stubResizeObserver();
    installPointerCaptureFakes();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      lineCap: "round",
      lineJoin: "round",
      lineTo: vi.fn(),
      lineWidth: 1,
      moveTo: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
    } as unknown as CanvasRenderingContext2D);
    const onEditorStateChange = vi.fn();
    const { rerender } = render(
      <BrowserScreenshotAnnotation
        screenshotUrl="data:image/png;base64,AA=="
        onClose={() => {}}
        onEditorStateChange={onEditorStateChange}
      />,
    );
    const image = screen.getByAltText("Captured browser page");
    const canvas = screen.getByLabelText("Drawing canvas") as HTMLCanvasElement;
    stubImageRect(image, 776, 400, 776, 400);
    stubCanvasRect(canvas, 776, 400);

    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 388,
      clientY: 200,
      pointerId: 1,
    });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    const first = onEditorStateChange.mock.lastCall?.[0];
    expect(first.shapes[0].points[0]).toEqual({ x: 388, y: 200 });

    stubImageRect(image, 776, 400, 476, 245);
    stubCanvasRect(canvas, 476, 245);
    rerender(
      <BrowserScreenshotAnnotation
        screenshotUrl="data:image/png;base64,AA=="
        onClose={() => {}}
        onEditorStateChange={onEditorStateChange}
        initialEditorState={first}
      />,
    );
    const canvasAfter = screen.getByLabelText(
      "Drawing canvas",
    ) as HTMLCanvasElement;
    fireEvent.pointerDown(canvasAfter, {
      button: 0,
      clientX: 238,
      clientY: 122.5,
      pointerId: 2,
    });
    fireEvent.pointerUp(canvasAfter, { pointerId: 2 });
    const after = onEditorStateChange.mock.lastCall?.[0];
    expect(after.shapes).toHaveLength(2);
    expect(after.shapes[0].points[0]).toEqual({ x: 388, y: 200 });
    expect(after.shapes[1].points[0]).toEqual({ x: 388, y: 200 });
  });
  it("preserves pending text and its source geometry through remount and resize", () => {
    stubResizeObserver();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const onEditorStateChange = vi.fn();
    const first = render(
      <BrowserScreenshotAnnotation
        screenshotUrl="data:image/png;base64,AA=="
        onClose={() => {}}
        onEditorStateChange={onEditorStateChange}
      />,
    );
    stubImageRect(
      screen.getByAltText("Captured browser page"),
      1440,
      900,
      360,
      225,
    );
    const canvas = screen.getByLabelText("Drawing canvas");
    stubCanvasRect(canvas, 360, 225);
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    fireEvent.change(screen.getByLabelText("Text size"), {
      target: { value: "24" },
    });
    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 90,
      clientY: 30,
      pointerId: 1,
    });
    fireEvent.change(screen.getByLabelText("Annotation text"), {
      target: { value: "Unfinished note" },
    });
    const snapshot = onEditorStateChange.mock.lastCall?.[0];
    expect(snapshot.pendingText).toMatchObject({
      at: { x: 360, y: 120 },
      fontSize: 96,
      text: "Unfinished note",
    });
    first.unmount();
    render(
      <BrowserScreenshotAnnotation
        screenshotUrl="data:image/png;base64,AA=="
        onClose={() => {}}
        initialEditorState={snapshot}
        onEditorStateChange={onEditorStateChange}
      />,
    );
    stubImageRect(
      screen.getByAltText("Captured browser page"),
      1440,
      900,
      720,
      450,
    );
    stubCanvasRect(screen.getByLabelText("Drawing canvas"), 720, 450);
    const text = screen.getByLabelText("Annotation text");
    expect(text).toHaveProperty("value", "Unfinished note");
    fireEvent.keyDown(text, { key: "Enter" });
    expect(onEditorStateChange.mock.lastCall?.[0].shapes.at(-1)).toMatchObject({
      kind: "text",
      at: { x: 360, y: 120 },
      fontSize: 96,
      text: "Unfinished note",
    });
  });
});
