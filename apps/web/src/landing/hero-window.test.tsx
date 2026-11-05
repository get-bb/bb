// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chunk = vi.hoisted(() => ({
  ready: Promise.resolve(),
  release: () => {},
}));

function delayChunk() {
  chunk.ready = new Promise((resolve) => {
    chunk.release = resolve;
  });
}

async function loadHeroWindow() {
  vi.resetModules();
  vi.doMock("./hero-window-stage", async (importOriginal) => {
    await chunk.ready;
    return importOriginal();
  });
  return (await import("./hero-window")).HeroWindow;
}

async function serverHtml(): Promise<string> {
  const HeroWindow = await loadHeroWindow();
  const { prerender } = await import("react-dom/static");
  const { prelude } = await prerender(
    <HeroWindow ref={null} active={false} />,
    { progressiveChunkSize: Number.POSITIVE_INFINITY },
  );
  return new Response(prelude).text();
}

const FIRST_SCENE = "Sentry errors";

describe("hero window first frame", () => {
  beforeEach(() => {
    chunk.ready = Promise.resolve();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      })),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    chunk.release();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("keeps the server frame while the chunk loads", async () => {
    const html = await serverHtml();
    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });
    delayChunk();
    const HeroWindow = await loadHeroWindow();
    const { hydrateRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <HeroWindow ref={null} active={false} />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    await act(async () => {
      root.render(<HeroWindow ref={null} active />);
    });
    const win = container.querySelector(".rhb-win");
    expect(win?.querySelector(".rhb-stage")).not.toBeNull();
    expect(win?.textContent).toContain(FIRST_SCENE);
    expect(container.querySelector(".rhb")?.className).toContain("is-paused");

    await act(async () => {
      chunk.release();
      await import("./hero-window-stage");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector(".rhb")?.className).not.toContain(
      "is-paused",
    );
    expect(errors).toEqual([]);
    expect(container.querySelector(".rhb-stage")?.className).toContain(
      "rhb-scene-sentry",
    );
    await act(async () => root.unmount());
  });

  it.each(["control", "test"])(
    "leaves the %s arm's exposure to the hero test, which counts it when the hero renders",
    async (arm) => {
      delayChunk();
      vi.resetModules();
      vi.doMock("./hero-window-stage", async (importOriginal) => {
        await chunk.ready;
        return importOriginal();
      });
      const exposeExperiment = vi.fn();
      vi.doMock("./analytics", async (importOriginal) => ({
        ...(await importOriginal<typeof import("./analytics")>()),
        exposeExperiment,
      }));
      const observed: IntersectionObserverCallback[] = [];
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          constructor(callback: IntersectionObserverCallback) {
            observed.push(callback);
          }
          observe() {}
          disconnect() {}
        },
      );
      const { HeroWindowSlot } = await import("./hero-window");
      const { ExperimentsProvider } = await import("../experiments/context");
      const { createRoot } = await import("react-dom/client");
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(
          <ExperimentsProvider
            value={{
              distinctID: "id",
              featureFlags: { "homepage-hero": arm },
              preview: false,
            }}
          >
            <HeroWindowSlot control={(ref) => <section ref={ref} />} />
          </ExperimentsProvider>,
        );
      });
      expect(exposeExperiment).not.toHaveBeenCalled();
      await act(async () => {
        for (const callback of observed) {
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        }
      });
      expect(container.querySelector(".rhb-stage")).toBeNull();
      expect(exposeExperiment).not.toHaveBeenCalled();
      await act(async () => root.unmount());
    },
  );
});
