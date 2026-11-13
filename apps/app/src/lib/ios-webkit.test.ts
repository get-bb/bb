// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isIOSWebKit, preventIOSFocusZoom } from "./ios-webkit";

describe("isIOSWebKit", () => {
  it("recognizes iPhones and iPads using desktop-class browsing", () => {
    expect(
      isIOSWebKit({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      isIOSWebKit({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it("rejects Android and desktop browsers", () => {
    expect(
      isIOSWebKit({
        userAgent:
          "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
    ).toBe(false);
    expect(
      isIOSWebKit({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
  });
});

describe("preventIOSFocusZoom", () => {
  const IPHONE = {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    platform: "iPhone",
    maxTouchPoints: 5,
  };
  const ANDROID = {
    userAgent:
      "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36",
    platform: "Linux armv8l",
    maxTouchPoints: 5,
  };
  const CONTENT = "width=device-width, initial-scale=1.0, viewport-fit=cover";

  function documentWithViewport(content: string): Document {
    const doc = document.implementation.createHTMLDocument();
    const meta = doc.createElement("meta");
    meta.name = "viewport";
    meta.content = content;
    doc.head.append(meta);
    return doc;
  }

  function viewportContent(doc: Document) {
    return doc.querySelector<HTMLMetaElement>('meta[name="viewport"]')
      ?.content;
  }

  it("caps the scale on iOS so focusing a field does not zoom", () => {
    const doc = documentWithViewport(CONTENT);
    preventIOSFocusZoom(doc, IPHONE);
    expect(viewportContent(doc)).toBe(`${CONTENT}, maximum-scale=1`);
    preventIOSFocusZoom(doc, IPHONE);
    expect(viewportContent(doc)).toBe(`${CONTENT}, maximum-scale=1`);
  });

  it("leaves other platforms zoomable", () => {
    const doc = documentWithViewport(CONTENT);
    preventIOSFocusZoom(doc, ANDROID);
    expect(viewportContent(doc)).toBe(CONTENT);
  });
});
