// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExperimentsProvider } from "../experiments/context";
import type { ExperimentBootstrap } from "../experiments/flags";
import { GuidePage } from "../guides/guide-page";
import { GUIDES } from "../guides/guides";
import { exposeExperiment } from "./analytics";
import { InstallOptions } from "./landing-visuals";

vi.mock("./analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./analytics")>()),
  exposeExperiment: vi.fn(),
}));

const observed = new Map<Element, IntersectionObserverCallback>();

class FakeIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(el: Element) {
    observed.set(el, this.callback);
  }
  unobserve(el: Element) {
    observed.delete(el);
  }
  disconnect() {
    for (const [el, callback] of observed) {
      if (callback === this.callback) observed.delete(el);
    }
  }
}

function scrollIntoView(el: Element) {
  act(() => {
    observed.get(el)?.(
      [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

function renderInto(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

function renderBlock(bootstrap: ExperimentBootstrap) {
  const container = renderInto(
    <ExperimentsProvider value={bootstrap}>
      <InstallOptions placement="closer" />
    </ExperimentsProvider>,
  );
  scrollIntoView(container.querySelector(".install-options")!);
}

describe("homepage-download-area exposure", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      })),
    );
  });

  afterEach(() => {
    vi.mocked(exposeExperiment).mockClear();
    observed.clear();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it.each(["test", "control"])(
    "fires from the install block on any page for %s",
    (variant) => {
      renderBlock({
        distinctID: "id",
        featureFlags: { "homepage-download-area": variant },
        preview: false,
      });
      expect(exposeExperiment).toHaveBeenCalledWith(
        "homepage-download-area",
        "desktop",
      );
    },
  );

  it("waits for a guide's closer to scroll into view, then fires once", () => {
    const container = renderInto(
      <ExperimentsProvider
        value={{
          distinctID: "id",
          featureFlags: { "homepage-download-area": "test" },
          preview: false,
        }}
      >
        <GuidePage guide={GUIDES[0]!} />
      </ExperimentsProvider>,
    );
    const block = container.querySelector(".closer .install-options")!;
    expect(block).not.toBeNull();
    expect(exposeExperiment).not.toHaveBeenCalled();
    scrollIntoView(block);
    scrollIntoView(block);
    expect(exposeExperiment).toHaveBeenCalledTimes(1);
    expect(exposeExperiment).toHaveBeenCalledWith(
      "homepage-download-area",
      "desktop",
    );
  });
});
