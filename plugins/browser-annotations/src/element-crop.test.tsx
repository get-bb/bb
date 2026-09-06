// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cropBrowserElementScreenshot } from "./element-crop";
import {
  FALLBACK_BROWSER_ELEMENT_PICKER_THEME,
  readBrowserElementPickerTheme,
} from "./element-picker-theme";
import { redactBrowserElementAnnotation } from "./element-capture";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function decodeImageStub(): void {
  vi.stubGlobal(
    "Image",
    class {
      naturalHeight = 900;
      naturalWidth = 1440;
      src = "";
      async decode(): Promise<void> {}
    },
  );
}

describe("element crop + picker theme", () => {
  it("reads the picker theme from document CSS variables with a fallback", () => {
    document.documentElement.style.setProperty("--ring", "rgb(10, 20, 30)");
    expect(readBrowserElementPickerTheme()).toEqual({
      fillColor: "color-mix(in oklab, rgb(10, 20, 30) 14%, transparent)",
      outlineColor: "rgb(10, 20, 30)",
    });
    document.documentElement.style.removeProperty("--ring");
    document.documentElement.style.removeProperty("--foreground");
    const fallback = readBrowserElementPickerTheme();
    expect(fallback.outlineColor.length).toBeGreaterThan(0);
    expect(FALLBACK_BROWSER_ELEMENT_PICKER_THEME.outlineColor).toBe("#3b82f6");
  });

  it("crops an element screenshot to its rect at <=640px", async () => {
    decodeImageStub();
    const drawImage = vi.fn();
    const toDataURL = vi.fn(() => "data:image/jpeg;base64,cropped");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
      toDataURL,
    );
    const annotation = redactBrowserElementAnnotation({
      accessibility: {
        ariaLabel: null,
        ariaLabelledBy: null,
        description: null,
        name: "Card",
        role: "button",
      },
      ancestorPath: ["main"],
      capturedAt: "2026-01-01T00:00:00.000Z",
      devicePixelRatio: 1,
      dom: {
        attributes: { role: "button" },
        classes: [],
        id: "card",
        selector: "#card",
        tag: "button",
      },
      editable: false,
      fullDomPath: "main > button#card",
      html: "<button>Card</button>",
      nearbyElements: [],
      nearbyText: [],
      reactComponents: null,
      rect: { height: 200, width: 400, x: 100, y: 50 },
      rectPage: { height: 200, width: 400, x: 100, y: 250 },
      scroll: { x: 0, y: 200 },
      selectedText: null,
      sourceFile: null,
      styles: {
        backgroundColor: "rgb(255, 255, 255)",
        border: "",
        borderRadius: "",
        color: "rgb(0, 0, 0)",
        display: "block",
        fontFamily: "",
        fontSize: "14px",
        fontWeight: "400",
        height: "",
        lineHeight: "",
        margin: "",
        opacity: "1",
        padding: "",
        position: "static",
        textAlign: "",
        width: "",
        zIndex: "auto",
      },
      text: "Card",
      title: "Page",
      url: "https://example.test/page",
      viewport: { height: 900, width: 1440 },
    })!;
    const result = await cropBrowserElementScreenshot({
      annotation,
      dataUrl: "data:image/jpeg;base64,page",
    });
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.82);
    expect(result).toBe("data:image/jpeg;base64,cropped");
  });
});
