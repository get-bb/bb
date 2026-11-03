// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExperimentsProvider } from "../experiments/context";
import type { ExperimentBootstrap } from "../experiments/flags";
import { exposeExperiment } from "./analytics";
import { InstallOptions } from "./landing-visuals";

vi.mock("./analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./analytics")>()),
  exposeExperiment: vi.fn(),
}));

function renderBlock(bootstrap: ExperimentBootstrap) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(
      <ExperimentsProvider value={bootstrap}>
        <InstallOptions placement="closer" />
      </ExperimentsProvider>,
    );
  });
}

describe("homepage-download-area exposure", () => {
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

  it("stays silent for an unassigned visitor", () => {
    renderBlock({ distinctID: "id", featureFlags: {}, preview: false });
    expect(exposeExperiment).not.toHaveBeenCalled();
  });
});
