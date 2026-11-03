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
    <HeroWindow ref={null} inView={false} onFilled={() => {}} />,
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

  it("server-renders the first scene, paused, inside the window frame", async () => {
    const html = await serverHtml();
    expect(html).toContain('class="mockup-wrap rhb is-paused"');
    expect(html).toMatch(/class="rhb-stage rhb-scene-sentry[ "]/);
    expect(html).toContain(FIRST_SCENE);
  });

  it("keeps the server frame and reports content while the chunk loads", async () => {
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
    const onFilled = vi.fn();
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(
        container,
        <HeroWindow ref={null} inView={false} onFilled={onFilled} />,
        { onRecoverableError: (error) => errors.push(error) },
      );
    });
    expect(onFilled).toHaveBeenCalled();
    await act(async () => {
      root.render(<HeroWindow ref={null} inView onFilled={onFilled} />);
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

  it("reports content only once the stage mounts on a client render", async () => {
    delayChunk();
    const HeroWindow = await loadHeroWindow();
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onFilled = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(<HeroWindow ref={null} inView onFilled={onFilled} />);
    });
    expect(container.querySelector(".rhb-stage")).toBeNull();
    expect(onFilled).not.toHaveBeenCalled();
    await act(async () => {
      chunk.release();
      await import("./hero-window-stage");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onFilled).toHaveBeenCalled();
    expect(container.querySelector(".rhb-stage")).not.toBeNull();
    await act(async () => root.unmount());
  });
});
