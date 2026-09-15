// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rasterizeTypstPages } from "./typst-raster";
import { TWO_PAGE_SVG } from "./typst-svg.fixture";

interface CanvasCall {
  drawImage: unknown[];
  fill: string;
  fillRect: number[];
}

interface RasterEnvironment {
  blobs: () => Blob[];
  calls: () => CanvasCall[];
  created: () => Map<string, Blob>;
  revoked: () => string[];
  setEncodeFails: (value: boolean) => void;
  setLoadImages: (value: boolean) => void;
  setMissingContext: (value: boolean) => void;
  setSilentImages: (value: boolean) => void;
}

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private currentSrc = "";

  set src(value: string) {
    this.currentSrc = value;
    queueMicrotask(() => {
      if (state.silentImages) return;
      if (state.loadImages) this.onload?.();
      else this.onerror?.();
    });
  }

  get src(): string {
    return this.currentSrc;
  }
}

interface RasterState {
  blobs: Blob[];
  created: Map<string, Blob>;
  encodeFails: boolean;
  loadImages: boolean;
  missingContext: boolean;
  revoked: string[];
  silentImages: boolean;
}

const canvasCalls = new Map<HTMLCanvasElement, CanvasCall>();
let state: RasterState;

function canvasCall(canvas: HTMLCanvasElement): CanvasCall {
  const existing = canvasCalls.get(canvas);
  if (existing !== undefined) return existing;
  const call: CanvasCall = { drawImage: [], fill: "", fillRect: [] };
  canvasCalls.set(canvas, call);
  return call;
}

function installEnvironment(): RasterEnvironment {
  canvasCalls.clear();
  state = {
    blobs: [],
    created: new Map(),
    encodeFails: false,
    loadImages: true,
    missingContext: false,
    revoked: [],
    silentImages: false,
  };

  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:page-${state.created.size}`;
    state.created.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    state.revoked.push(url);
  };
  vi.stubGlobal("Image", FakeImage);

  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value(this: HTMLCanvasElement, kind: string) {
      if (kind !== "2d" || state.missingContext) return null;
      const call = canvasCall(this);
      return {
        drawImage: (image: unknown, x: number, y: number, w: number, h: number) => {
          call.drawImage = [image, x, y, w, h];
        },
        fillRect: (x: number, y: number, w: number, h: number) => {
          call.fillRect = [x, y, w, h];
        },
        set fillStyle(value: string) {
          call.fill = value;
        },
      };
    },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
    configurable: true,
    value(
      this: HTMLCanvasElement,
      callback: (blob: Blob | null) => void,
      type?: string,
    ) {
      queueMicrotask(() => {
        if (state.encodeFails) {
          callback(null);
          return;
        }
        const blob = new Blob([`png:${type ?? ""}`], { type: type ?? "" });
        state.blobs.push(blob);
        callback(blob);
      });
    },
  });

  return {
    blobs: () => state.blobs,
    calls: () => [...canvasCalls.values()],
    created: () => state.created,
    revoked: () => state.revoked,
    setEncodeFails: (value) => {
      state.encodeFails = value;
    },
    setLoadImages: (value) => {
      state.loadImages = value;
    },
    setMissingContext: (value) => {
      state.missingContext = value;
    },
    setSilentImages: (value) => {
      state.silentImages = value;
    },
  };
}

let env: RasterEnvironment;

beforeEach(() => {
  env = installEnvironment();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("rasterizeTypstPages", () => {
  it("renders one double-scale png per page", async () => {
    const blobs = await rasterizeTypstPages(TWO_PAGE_SVG);

    expect(blobs).toHaveLength(2);
    expect(blobs[0]!.type).toBe("image/png");
    expect(env.blobs()).toHaveLength(2);
  });

  it("sizes the canvas and paints a white background before drawing", async () => {
    await rasterizeTypstPages(TWO_PAGE_SVG);

    const calls = env.calls();
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.fill).toBe("#ffffff");
      expect(call.fillRect).toEqual([0, 0, 400, 200]);
      expect(call.drawImage.slice(1)).toEqual([0, 0, 400, 200]);
      expect(call.drawImage[0]).toBeInstanceOf(FakeImage);
    }
  });

  it("drops the text-semantics layer that taints the canvas", async () => {
    const svg = TWO_PAGE_SVG.replace(
      '<g class="typst-group">',
      '<g class="typst-group"><foreignObject width="10" height="10"><div>text</div></foreignObject>',
    );

    await rasterizeTypstPages(svg);

    const blob = env.created().get("blob:page-0");
    expect(blob).toBeDefined();
    const content = await blob!.text();
    expect(content).not.toContain("foreignObject");
    expect(content).toContain("typst-page");
    expect(content).toContain('d="M0 0h10v10z"');
  });

  it("revokes every page url", async () => {
    await rasterizeTypstPages(TWO_PAGE_SVG);

    expect([...env.created().keys()]).toEqual(env.revoked());
  });

  it("fails when the page cannot be drawn", async () => {
    env.setLoadImages(false);

    await expect(rasterizeTypstPages(TWO_PAGE_SVG)).rejects.toThrow(
      /could not draw the Typst page/,
    );
  });

  it("times out when the page never finishes drawing", async () => {
    env.setSilentImages(true);
    vi.useFakeTimers();
    try {
      const pending = rasterizeTypstPages(TWO_PAGE_SVG);
      const assertion = expect(pending).rejects.toThrow(/Timed out/);
      await vi.advanceTimersByTimeAsync(31_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails when the browser cannot encode the page", async () => {
    env.setEncodeFails(true);

    await expect(rasterizeTypstPages(TWO_PAGE_SVG)).rejects.toThrow(
      /could not encode the Typst page/,
    );
  });

  it("fails without a 2d context", async () => {
    env.setMissingContext(true);

    await expect(rasterizeTypstPages(TWO_PAGE_SVG)).rejects.toThrow(
      /2D canvas context/,
    );
  });
});
