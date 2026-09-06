import { describe, expect, it } from "vitest";
import {
  BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
  BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_INPUT_BYTES,
  BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_RESULT_BYTES,
  BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_SOURCE_BYTES,
  bbDesktopBrowserAttachRequestSchema,
  bbDesktopBrowserCaptureChunkReadSchema,
  bbDesktopBrowserPageCaptureRequestSchema,
  bbDesktopBrowserPageCaptureResultSchema,
  bbDesktopBrowserPageScriptCancelRequestSchema,
  bbDesktopBrowserPageScriptRequestSchema,
  bbDesktopBrowserPageScriptResultSchema,
  bbDesktopBrowserPointerInputRequestSchema,
  bbDesktopBrowserSetViewportProfileRequestSchema,
  bbDesktopBrowserClearViewportProfileRequestSchema,
  bbDesktopBrowserSetBoundsRequestSchema,
  bbDesktopBrowserStateSchema,
  clampBbDesktopBrowserViewBounds,
  type BbDesktopBrowserViewBounds,
  type BbDesktopBrowserViewportBounds,
} from "../src/index.js";

interface BrowserBoundsClampTestCase {
  bounds: BbDesktopBrowserViewBounds;
  expected: BbDesktopBrowserViewBounds;
  label: string;
  viewport: BbDesktopBrowserViewportBounds;
}

const browserBoundsClampTestCases: BrowserBoundsClampTestCase[] = [
  {
    label: "anchors the left edge and trims overflow at the right and bottom",
    bounds: { x: 180, y: 48, width: 400, height: 420 },
    viewport: { width: 500, height: 360 },
    expected: { x: 180, y: 48, width: 320, height: 312 },
  },
  {
    label: "clamps negative origins to the host content edge",
    bounds: { x: -24, y: -10, width: 200, height: 120 },
    viewport: { width: 500, height: 360 },
    expected: { x: 0, y: 0, width: 176, height: 110 },
  },
  {
    label: "collapses bounds that start outside the host content area",
    bounds: { x: 640, y: 400, width: 120, height: 90 },
    viewport: { width: 500, height: 360 },
    expected: { x: 500, y: 360, width: 0, height: 0 },
  },
  {
    label: "leaves bounds that already fit the viewport untouched",
    bounds: { x: 100, y: 50, width: 300, height: 250 },
    viewport: { width: 500, height: 360 },
    expected: { x: 100, y: 50, width: 300, height: 250 },
  },
];

describe("desktop browser bounds containment", () => {
  it.each(browserBoundsClampTestCases)("$label", (testCase) => {
    expect(
      clampBbDesktopBrowserViewBounds({
        bounds: testCase.bounds,
        viewport: testCase.viewport,
      }),
    ).toEqual(testCase.expected);
  });
});

describe("desktop browser IPC schemas", () => {
  it("accepts a well-formed attach request and rejects bad shapes", () => {
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false,
      }).success,
    ).toBe(true);

    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false,
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserSetBoundsRequestSchema.safeParse({
        tabId: "browser:abc",
        bounds: { x: 0, y: 0, width: -1, height: 600 },
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("accepts a well-formed state push and rejects non-integer bounds", () => {
    expect(
      bbDesktopBrowserStateSchema.safeParse({
        tabId: "browser:abc",
        url: "https://example.com",
        title: "Example",
        isLoading: false,
        canGoBack: true,
        canGoForward: false,
        errorText: null,
      }).success,
    ).toBe(true);

    expect(
      bbDesktopBrowserSetBoundsRequestSchema.safeParse({
        tabId: "browser:abc",
        bounds: { x: 0.5, y: 0, width: 800, height: 600 },
      }).success,
    ).toBe(false);
  });

  it("rejects oversized URLs beyond the length cap", () => {
    const longUrl = `https://example.com/${"a".repeat(
      BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
    )}`;
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: longUrl,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: true,
      }).success,
    ).toBe(false);
  });
});

describe("experimental desktop Browser-page runtime schemas", () => {
  it("binds page captures to an explicit navigation epoch", () => {
    expect(
      bbDesktopBrowserPageCaptureRequestSchema.parse({
        tabId: "browser:a",
        requestId: "capture-1",
        format: "png",
        quality: 85,
        expectedNavigationEpoch: 3,
      }),
    ).toEqual({
      tabId: "browser:a",
      requestId: "capture-1",
      format: "png",
      quality: 85,
      expectedNavigationEpoch: 3,
    });
    expect(
      bbDesktopBrowserPageCaptureResultSchema.parse({
        navigationEpoch: 3,
        captureId: "cap-9",
        format: "png",
        pixelSize: { width: 800, height: 600 },
        byteLength: 2,
      }),
    ).toMatchObject({ navigationEpoch: 3, captureId: "cap-9" });
    expect(
      bbDesktopBrowserCaptureChunkReadSchema.parse({
        captureId: "cap-9",
        tabId: "browser:a",
        offset: 0,
        length: 256,
      }),
    ).toEqual({ captureId: "cap-9", tabId: "browser:a", offset: 0, length: 256 });
  });

  it("accepts a strict JSON-only page-script request", () => {
    const request = {
      tabId: "browser:a",
      expectedNavigationEpoch: 3,
      requestId: "req_1",
      source: "({ input }) => ({ title: document.title, input })",
      input: { intent: "inspect" },
      timeoutMs: 10_000,
    };
    expect(bbDesktopBrowserPageScriptRequestSchema.parse(request)).toEqual(
      request,
    );
    expect(
      bbDesktopBrowserPageScriptRequestSchema.safeParse({
        ...request,
        identity: { threadId: "thr_1" },
      }).success,
    ).toBe(false);
  });

  it("enforces source and JSON input byte limits before IPC", () => {
    expect(
      bbDesktopBrowserPageScriptRequestSchema.safeParse({
        tabId: "browser:a",
        expectedNavigationEpoch: 3,
        requestId: "req_1",
        source: "x".repeat(BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_SOURCE_BYTES + 1),
        input: null,
        timeoutMs: 1_000,
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserPageScriptRequestSchema.safeParse({
        tabId: "browser:a",
        expectedNavigationEpoch: 3,
        requestId: "req_1",
        source: "() => null",
        input: "x".repeat(BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_INPUT_BYTES + 1),
        timeoutMs: 1_000,
      }).success,
    ).toBe(false);
  });

  it("bounds JSON results and scopes cancellation to one request", () => {
    const result = {
      requestId: "req_1",
      navigationEpoch: 3,
      value: { title: "Example" },
    };
    expect(bbDesktopBrowserPageScriptResultSchema.parse(result)).toEqual(
      result,
    );
    expect(
      bbDesktopBrowserPageScriptCancelRequestSchema.parse({
        tabId: "browser:a",
        requestId: "req_1",
      }),
    ).toEqual({ tabId: "browser:a", requestId: "req_1" });
    expect(
      bbDesktopBrowserPageScriptResultSchema.safeParse({
        ...result,
        value: "x".repeat(BB_DESKTOP_BROWSER_PAGE_SCRIPT_MAX_RESULT_BYTES + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects non-JSON inputs and non-finite numbers", () => {
    expect(
      bbDesktopBrowserPageScriptRequestSchema.safeParse({
        tabId: "browser:a",
        requestId: "req_1",
        source: "() => null",
        input: { invalid: undefined },
        timeoutMs: 1_000,
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserPageScriptRequestSchema.safeParse({
        tabId: "browser:a",
        requestId: "req_1",
        source: "() => null",
        input: Number.POSITIVE_INFINITY,
        timeoutMs: 1_000,
      }).success,
    ).toBe(false);
  });
});

describe("experimental native Browser input schemas", () => {
  it("accepts only bounded native pointer events at an exact page revision", () => {
    expect(
      bbDesktopBrowserPointerInputRequestSchema.parse({
        tabId: "browser:a",
        expectedNavigationEpoch: 3,
        requestId: "req-pointer",
        events: [
          { type: "mouseMove", x: 10, y: 20 },
          { type: "mouseDown", x: 10, y: 20, button: "middle", clickCount: 1 },
          { type: "mouseUp", x: 10, y: 20, button: "right", clickCount: 1 },
          { type: "mouseWheel", x: 10, y: 20, deltaX: 0, deltaY: -100 },
        ],
      }),
    ).toMatchObject({ expectedNavigationEpoch: 3 });
    expect(
      bbDesktopBrowserPointerInputRequestSchema.safeParse({
        tabId: "browser:a",
        expectedNavigationEpoch: 3,
        requestId: "req-pointer",
        events: [{ type: "mouseDown", x: -1, y: 0, button: "left", clickCount: 1 }],
      }).success,
    ).toBe(false);
  });

  it("accepts only declared temporary viewport profiles", () => {
    expect(
      bbDesktopBrowserSetViewportProfileRequestSchema.parse({
        tabId: "browser:a",
        expectedNavigationEpoch: 3,
        profile: "phone-390x844",
      }),
    ).toMatchObject({ profile: "phone-390x844" });
    expect(
      bbDesktopBrowserSetViewportProfileRequestSchema.safeParse({
        tabId: "browser:a",
        expectedNavigationEpoch: 3,
        profile: "phone-freeform",
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserClearViewportProfileRequestSchema.parse({
        tabId: "browser:a",
      }),
    ).toEqual({ tabId: "browser:a" });
  });
});
