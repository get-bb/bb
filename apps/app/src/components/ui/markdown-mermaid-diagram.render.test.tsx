// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import type { RenderOptions, RenderResult } from "pele/lazy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownMermaidDiagram } from "./markdown-mermaid-diagram";
import {
  clearMermaidRenderCache,
  getMermaidRenderCacheSize,
  MERMAID_RENDER_CACHE_LIMIT,
  MERMAID_SOURCE_RENDER_DEBOUNCE_MS,
  readMermaidRenderCache,
  storeMermaidRenderCache,
} from "./markdown-mermaid-render-cache";

function peleResult(source: string): RenderResult {
  return {
    svg: `<svg data-source="${source}"></svg>`,
    width: 100,
    height: 100,
    links: [],
    type: "flowchart",
  };
}

const peleRender = vi.hoisted(() =>
  vi.fn(
    async (source: string, _options?: RenderOptions): Promise<RenderResult> =>
      peleResult(source),
  ),
);
vi.mock("./markdown-mermaid-loader.js", () => ({
  loadPele: async () => ({ renderAsync: peleRender }),
}));

type ObserverCallback = (
  entries: { isIntersecting: boolean; target: Element }[],
) => void;
const observers: {
  callback: ObserverCallback;
  targets: Set<Element>;
  disconnected: boolean;
}[] = [];
class FakeIntersectionObserver {
  private readonly record: (typeof observers)[number];
  constructor(callback: ObserverCallback) {
    this.record = { callback, targets: new Set(), disconnected: false };
    observers.push(this.record);
  }
  observe(target: Element) {
    this.record.targets.add(target);
  }
  unobserve(target: Element) {
    this.record.targets.delete(target);
  }
  disconnect() {
    this.record.disconnected = true;
    this.record.targets.clear();
  }
  takeRecords() {
    return [];
  }
}

type ResizeCallback = (entries: { contentRect: { width: number } }[]) => void;
const resizeCallbacks: ResizeCallback[] = [];
class FakeResizeObserver {
  constructor(callback: ResizeCallback) {
    resizeCallbacks.push(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function resizeContainers(width: number) {
  for (const callback of resizeCallbacks) {
    callback([{ contentRect: { width } }]);
  }
}

function enterViewport(target: Element) {
  for (const observer of observers) {
    if (observer.targets.has(target)) {
      observer.callback([{ isIntersecting: true, target }]);
    }
  }
}

function diagramContainer(container: HTMLElement): Element {
  const element = container.firstElementChild;
  if (element === null) {
    throw new Error("diagram container did not render");
  }
  return element;
}

async function flushRenders() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  observers.length = 0;
  resizeCallbacks.length = 0;
  peleRender.mockClear();
  clearMermaidRenderCache();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("MarkdownMermaidDiagram render gating", () => {
  it("does not render until the diagram nears the viewport and shares one observer across diagrams", async () => {
    const first = render(<MarkdownMermaidDiagram source="graph TD; A-->B" />);
    const second = render(<MarkdownMermaidDiagram source="graph TD; C-->D" />);
    await flushRenders();
    expect(peleRender).not.toHaveBeenCalled();
    expect(observers.filter((observer) => !observer.disconnected)).toHaveLength(
      1,
    );

    act(() => {
      enterViewport(diagramContainer(first.container));
    });
    await flushRenders();
    expect(peleRender).toHaveBeenCalledTimes(1);
    expect(peleRender.mock.calls[0]?.[0]).toBe("graph TD; A-->B");
    expect(
      first.container.querySelector('svg[data-source="graph TD; A-->B"]'),
    ).not.toBeNull();
    expect(second.container.querySelector("svg[data-source]")).toBeNull();
  });

  it("debounces streaming source updates and keeps the previous diagram on screen meanwhile", async () => {
    const view = render(<MarkdownMermaidDiagram source="graph TD; A" />);
    act(() => {
      enterViewport(diagramContainer(view.container));
    });
    await flushRenders();
    expect(peleRender).toHaveBeenCalledTimes(1);

    view.rerender(<MarkdownMermaidDiagram source="graph TD; A-->" />);
    await flushRenders();
    await act(async () => {
      vi.advanceTimersByTime(MERMAID_SOURCE_RENDER_DEBOUNCE_MS - 50);
    });
    view.rerender(<MarkdownMermaidDiagram source="graph TD; A-->B" />);
    await flushRenders();
    await act(async () => {
      vi.advanceTimersByTime(MERMAID_SOURCE_RENDER_DEBOUNCE_MS - 50);
    });
    expect(peleRender).toHaveBeenCalledTimes(1);
    expect(
      view.container.querySelector('svg[data-source="graph TD; A"]'),
    ).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    await flushRenders();
    expect(peleRender).toHaveBeenCalledTimes(2);
    expect(peleRender.mock.calls[1]?.[0]).toBe("graph TD; A-->B");
    expect(
      view.container.querySelector('svg[data-source="graph TD; A-->B"]'),
    ).not.toBeNull();
  });

  it("keeps the last successful diagram when a streaming source update cannot render", async () => {
    const view = render(<MarkdownMermaidDiagram source="graph TD; A" />);
    act(() => {
      enterViewport(diagramContainer(view.container));
    });
    await flushRenders();
    const previousSvg = view.container.querySelector("svg[data-source]");
    expect(previousSvg).not.toBeNull();

    peleRender.mockRejectedValueOnce(new Error("Incomplete Mermaid input"));
    view.rerender(<MarkdownMermaidDiagram source="graph TD; A-->" />);
    await act(async () => {
      vi.advanceTimersByTime(MERMAID_SOURCE_RENDER_DEBOUNCE_MS);
    });
    await flushRenders();
    expect(peleRender).toHaveBeenCalledTimes(2);
    expect(view.container.querySelector("svg[data-source]")?.outerHTML).toBe(
      previousSvg?.outerHTML,
    );

    view.rerender(<MarkdownMermaidDiagram source="graph TD; A-->B" />);
    await act(async () => {
      vi.advanceTimersByTime(MERMAID_SOURCE_RENDER_DEBOUNCE_MS);
    });
    await flushRenders();
    expect(
      view.container.querySelector('svg[data-source="graph TD; A-->B"]'),
    ).not.toBeNull();
  });

  it("shows source when no diagram has rendered successfully and recovers on valid input", async () => {
    peleRender.mockRejectedValueOnce(new Error("Incomplete Mermaid input"));
    const view = render(<MarkdownMermaidDiagram source="graph TD; A[" />);
    act(() => {
      enterViewport(diagramContainer(view.container));
    });
    await flushRenders();
    expect(view.container.querySelector("code")?.textContent).toBe(
      "graph TD; A[",
    );
    expect(view.queryByText("Rendering diagram...")).toBeNull();

    view.rerender(<MarkdownMermaidDiagram source="graph TD; A[Start]" />);
    await act(async () => {
      vi.advanceTimersByTime(MERMAID_SOURCE_RENDER_DEBOUNCE_MS);
    });
    await flushRenders();
    expect(view.container.querySelector("svg[data-source]")).not.toBeNull();
    expect(view.container.querySelector("code")).toBeNull();
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a superseded render that later %ss",
    async (outcome) => {
      const view = render(<MarkdownMermaidDiagram source="graph TD; A" />);
      act(() => {
        enterViewport(diagramContainer(view.container));
      });
      await flushRenders();

      let finishRender: (() => void) | undefined;
      peleRender.mockImplementationOnce(
        (source) =>
          new Promise((resolve, reject) => {
            finishRender = () => {
              if (outcome === "reject") {
                reject(new Error("Superseded render"));
              } else {
                resolve(peleResult(source));
              }
            };
          }),
      );
      view.rerender(<MarkdownMermaidDiagram source="graph TD; A-->B" />);
      await act(async () => {
        vi.advanceTimersByTime(MERMAID_SOURCE_RENDER_DEBOUNCE_MS);
      });
      await flushRenders();
      view.rerender(<MarkdownMermaidDiagram source="graph TD; A-->B-->C" />);
      await act(async () => {
        vi.advanceTimersByTime(MERMAID_SOURCE_RENDER_DEBOUNCE_MS);
      });
      await flushRenders();
      const currentSvg = view.container.querySelector(
        'svg[data-source="graph TD; A-->B-->C"]',
      );
      expect(currentSvg).not.toBeNull();
      await act(async () => finishRender?.());
      await flushRenders();
      expect(view.container.querySelector("svg[data-source]")).toBe(currentSvg);
    },
  );

  it("serves a remounted diagram from the render cache without calling pele again", async () => {
    const view = render(<MarkdownMermaidDiagram source="graph TD; X-->Y" />);
    act(() => {
      enterViewport(diagramContainer(view.container));
    });
    await flushRenders();
    expect(peleRender).toHaveBeenCalledTimes(1);
    view.unmount();

    const remounted = render(
      <MarkdownMermaidDiagram source="graph TD; X-->Y" />,
    );
    expect(
      remounted.container.querySelector('svg[data-source="graph TD; X-->Y"]'),
    ).not.toBeNull();
    await flushRenders();
    expect(peleRender).toHaveBeenCalledTimes(1);
  });

  it("re-renders at the measured container width without a debounce and keeps the old diagram meanwhile", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const view = render(<MarkdownMermaidDiagram source="graph TD; A-->B" />);
    act(() => {
      enterViewport(diagramContainer(view.container));
    });
    await flushRenders();
    expect(peleRender).toHaveBeenCalledTimes(1);
    expect(peleRender.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        directionBreakpoint: 900,
        images: false,
        links: false,
      }),
    );
    expect(peleRender.mock.calls[0]?.[1]).not.toHaveProperty("maxWidth");
    const previousSvg = view.container.querySelector("svg[data-source]");

    let finishRender: (() => void) | undefined;
    peleRender.mockImplementationOnce(
      (source) =>
        new Promise((resolve) => {
          finishRender = () => resolve(peleResult(source));
        }),
    );
    act(() => {
      resizeContainers(680);
    });
    await flushRenders();
    expect(peleRender).toHaveBeenCalledTimes(2);
    expect(peleRender.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ maxWidth: 656 }),
    );
    expect(view.container.querySelector("svg[data-source]")).toBe(previousSvg);
    expect(view.queryByText("Rendering diagram...")).toBeNull();

    await act(async () => finishRender?.());
    await flushRenders();
    expect(readMermaidRenderCache("graph TD; A-->B")?.maxWidth).toBe(656);

    act(() => {
      resizeContainers(690);
    });
    await flushRenders();
    expect(peleRender).toHaveBeenCalledTimes(2);
  });
});

describe("mermaid render cache", () => {
  it("evicts the least recently used entry past the limit", () => {
    const diagram = { svg: "<svg></svg>", maxWidth: null };
    const keyFor = (index: number) => `graph ${index}`;
    for (let index = 0; index < MERMAID_RENDER_CACHE_LIMIT; index += 1) {
      storeMermaidRenderCache(keyFor(index), diagram);
    }
    expect(readMermaidRenderCache(keyFor(0))).toBe(diagram);
    storeMermaidRenderCache(keyFor(MERMAID_RENDER_CACHE_LIMIT), diagram);
    expect(getMermaidRenderCacheSize()).toBe(MERMAID_RENDER_CACHE_LIMIT);
    expect(readMermaidRenderCache(keyFor(0))).toBe(diagram);
    expect(readMermaidRenderCache(keyFor(1))).toBeNull();
  });
});
