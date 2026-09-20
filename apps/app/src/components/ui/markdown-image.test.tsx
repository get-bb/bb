// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render as renderView,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownImage } from "./markdown-image";
import type { ReactNode } from "react";
import type { ThreadImageMetadata } from "@bb/server-contract";
import {
  MarkdownImageMetadataContext,
  markdownImageSourceIdentity,
} from "./markdown-image-dimensions";

const metadata = new Map<string, ThreadImageMetadata>();
const readMarkdownImageDimensions = (source: string) => metadata.get(source);
const rememberMarkdownImageDimensions = (
  source: string,
  dimensions: { width: number; height: number },
  etag: string | null = null,
) => {
  metadata.set(source, { source, ...dimensions, etag });
};
const imageMetadata = {
  read: readMarkdownImageDimensions,
  remember: rememberMarkdownImageDimensions,
};
function render(children: ReactNode) {
  return renderView(
    <MarkdownImageMetadataContext.Provider value={imageMetadata}>
      {children}
    </MarkdownImageMetadataContext.Provider>,
  );
}

const source = "https://example.com/screenshot.png";

afterEach(() => {
  cleanup();
  metadata.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockVisibility() {
  let notify: IntersectionObserverCallback;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  return (target: Element, isIntersecting: boolean) =>
    act(() => {
      notify(
        [{ target, isIntersecting } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
}

function imageElement(element: HTMLElement): HTMLImageElement {
  if (!(element instanceof HTMLImageElement))
    throw new Error("Expected an image");
  return element;
}

function completeImage(image: HTMLImageElement, width: number, height: number) {
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  });
  fireEvent.load(image);
}

describe("MarkdownImage", () => {
  it("reserves learned geometry on remount before fetching or decoding", async () => {
    const visible = mockVisibility();
    const first = render(<MarkdownImage src={source} alt="Screenshot" />);
    const image = imageElement(first.getByAltText("Screenshot"));
    expect(image.hasAttribute("src")).toBe(false);
    visible(image, true);
    expect(image.src).toBe(source);
    completeImage(image, 780, 1688);
    await waitFor(() => expect(image.dataset.markdownImageState).toBe("ready"));
    first.unmount();
    const second = render(<MarkdownImage src={source} alt="Screenshot" />);
    const restored = imageElement(second.getByAltText("Screenshot"));
    expect(restored.hasAttribute("src")).toBe(false);
    expect(restored.style.aspectRatio).toBe("780 / 1688");
    expect(restored.style.height).toBe("auto");
    expect(restored.dataset.markdownImageState).toBe("loading");
  });

  it("keeps offscreen and hidden images unfetched and starts intersecting images at high priority", () => {
    const visible = mockVisibility();
    const { getByAltText } = render(
      <>
        <MarkdownImage src={source} alt="Visible" />
        <MarkdownImage src={`${source}?offscreen`} alt="Offscreen" />
        <div hidden>
          <MarkdownImage src={`${source}?hidden`} alt="Hidden" />
        </div>
      </>,
    );
    const image = imageElement(getByAltText("Visible"));
    const offscreen = imageElement(getByAltText("Offscreen"));
    const hidden = imageElement(getByAltText("Hidden"));
    visible(offscreen, false);
    visible(hidden, true);
    expect(offscreen.hasAttribute("src")).toBe(false);
    expect(hidden.hasAttribute("src")).toBe(false);
    visible(image, true);
    expect(image.getAttribute("loading")).toBe("eager");
    expect(image.getAttribute("fetchpriority")).toBe("high");
  });

  it("honors explicit dimensions and updates stale learned dimensions after loading changed pixels", async () => {
    rememberMarkdownImageDimensions(source, { width: 780, height: 1688 });
    const visible = mockVisibility();
    const { getByAltText } = render(
      <MarkdownImage src={source} width="320" height="200" alt="Sized" />,
    );
    const image = imageElement(getByAltText("Sized"));
    expect(image.style.aspectRatio).toBe("320 / 200");
    expect(image.getAttribute("width")).toBe("320");
    expect(image.getAttribute("height")).toBe("200");
    visible(image, true);
    completeImage(image, 900, 600);
    await waitFor(() =>
      expect(readMarkdownImageDimensions(source)).toEqual({
        source,
        width: 900,
        height: 600,
        etag: null,
      }),
    );
    expect(image.style.aspectRatio).toBe("320 / 200");
  });

  it("revalidates visible local files, releases decoded bytes, and never reuses pixels after a denied request", async () => {
    const visible = mockVisibility();
    const createObjectURL = vi.fn(() => "blob:local-image");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      },
    );
    const fetchImage = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        headers: new Headers({ etag: '"version-1"' }),
        blob: async () => new Blob(["image"]),
      });
    vi.stubGlobal("fetch", fetchImage);
    const local =
      "/api/v1/threads/thr_image/host-files/content?path=%2Fimage.png";
    const first = render(<MarkdownImage src={local} alt="Local" />);
    const image = imageElement(first.getByAltText("Local"));
    expect(fetchImage).not.toHaveBeenCalled();
    visible(image, true);
    await waitFor(() =>
      expect(image.getAttribute("src")).toBe("blob:local-image"),
    );
    expect(fetchImage).toHaveBeenCalledWith(
      local,
      expect.objectContaining({ cache: "no-cache" }),
    );
    completeImage(image, 640, 480);
    await waitFor(() => expect(image.dataset.markdownImageState).toBe("ready"));
    expect(readMarkdownImageDimensions(local)).toEqual({
      source: local,
      width: 640,
      height: 480,
      etag: '"version-1"',
    });
    first.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-image");
    fetchImage.mockResolvedValue({ ok: false });
    const second = render(<MarkdownImage src={local} alt="Denied" />);
    const denied = imageElement(second.getByAltText("Denied"));
    visible(denied, true);
    await waitFor(() =>
      expect(denied.dataset.markdownImageState).toBe("error"),
    );
    expect(denied.hasAttribute("src")).toBe(false);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("does not cache the fallback dimensions for picture sources", async () => {
    mockVisibility();
    rememberMarkdownImageDimensions(source, { width: 780, height: 1688 });
    const { getByAltText } = render(
      <picture>
        <source
          srcSet="https://example.com/dark.png"
          media="(prefers-color-scheme: dark)"
        />
        <MarkdownImage src={source} alt="Responsive" />
      </picture>,
    );
    const image = imageElement(getByAltText("Responsive"));
    expect(image.style.aspectRatio).toBe("");
    completeImage(image, 900, 600);
    await waitFor(() => expect(image.dataset.markdownImageState).toBe("ready"));
    expect(readMarkdownImageDimensions(source)).toEqual({
      source,
      width: 780,
      height: 1688,
      etag: null,
    });
  });

  it("falls back to alt text on errors and restores geometry on a later load", async () => {
    const visible = mockVisibility();
    rememberMarkdownImageDimensions(source, { width: 640, height: 480 });
    const { getByAltText } = render(
      <MarkdownImage src={source} alt="Retry screenshot" />,
    );
    const image = imageElement(getByAltText("Retry screenshot"));
    visible(image, true);
    fireEvent.error(image);
    expect(image.dataset.markdownImageState).toBe("error");
    expect(image.style.aspectRatio).toBe("");
    expect(image.style.width).toBe("");
    expect(image.className).not.toContain("text-transparent");
    completeImage(image, 640, 480);
    await waitFor(() => expect(image.dataset.markdownImageState).toBe("ready"));
    expect(image.style.aspectRatio).toBe("640 / 480");
  });
});

describe("Markdown image source identity", () => {
  it("normalizes same-origin paths across clients and preserves source versions", () => {
    const path =
      "/api/v1/threads/thr_image/host-files/content?path=%2Fimage.png&v=2";
    expect(
      markdownImageSourceIdentity(new URL(path, window.location.href).href),
    ).toBe(path);
    expect(markdownImageSourceIdentity(`${source}?v=1`)).toBe(`${source}?v=1`);
    expect(markdownImageSourceIdentity(`${source}?v=2`)).toBe(`${source}?v=2`);
    expect(markdownImageSourceIdentity("data:image/png;base64,abc")).toBeNull();
    expect(
      markdownImageSourceIdentity("blob:https://example.com/image"),
    ).toBeNull();
  });
});
