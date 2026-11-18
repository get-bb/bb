// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExperimentsProvider } from "../experiments/context";
import type { ExperimentBootstrap } from "../experiments/flags";
import { exposeExperiment } from "./analytics";
import { SiteNav } from "./site-chrome";

vi.mock("./analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./analytics")>()),
  exposeExperiment: vi.fn(),
}));

function renderNav(bootstrap: ExperimentBootstrap) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(
      <ExperimentsProvider value={bootstrap}>
        <SiteNav current="changelog" />
      </ExperimentsProvider>,
    );
  });
}

describe("nav experiment exposure", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it.each(["test", "control"])(
    "fires from the nav on a non-home page for %s",
    (variant) => {
      renderNav({
        distinctID: "id",
        featureFlags: { "homepage-download-path": variant },
        preview: false,
      });
      expect(exposeExperiment).toHaveBeenCalledWith(
        "homepage-download-path",
        variant,
        "desktop",
      );
    },
  );

  it.each([
    [
      "an unassigned visitor",
      { distinctID: "id", featureFlags: {}, preview: false },
    ],
    [
      "a preview",
      {
        distinctID: "id",
        featureFlags: { "homepage-download-path": "test" },
        preview: true,
      },
    ],
    [
      "an unknown variant",
      {
        distinctID: "id",
        featureFlags: { "homepage-download-path": "holdout-12" },
        preview: false,
      },
    ],
  ])("stays silent for %s", (_name, bootstrap) => {
    renderNav(bootstrap);
    expect(exposeExperiment).not.toHaveBeenCalled();
  });
});
