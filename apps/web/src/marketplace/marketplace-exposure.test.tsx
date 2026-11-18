// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EXPERIMENT_KEYS, EXPERIMENT_VARIANTS } from "../experiments/flags";
import { MARKETPLACE_V2_FIXTURE } from "./marketplace-v2.fixture.js";

const posthog = vi.hoisted(() => {
  let loadedFlags: Record<string, string> = {};
  return {
    init: vi.fn(
      (
        _key: string,
        options: { bootstrap?: { featureFlags: Record<string, string> } },
      ) => {
        loadedFlags = { ...options.bootstrap?.featureFlags };
      },
    ),
    register: vi.fn(),
    capture: vi.fn(),
    getFeatureFlag: vi.fn((key: string) => loadedFlags[key]),
    get_distinct_id: vi.fn(() => "client-id"),
    get_session_id: vi.fn(() => "client-session"),
  };
});

vi.mock("posthog-js", () => ({ default: posthog }));

const PROBE_KEY = EXPERIMENT_KEYS[0]!;
const ASSIGNED = Object.fromEntries(
  EXPERIMENT_KEYS.map((key) => [key, EXPERIMENT_VARIANTS[key][0]]),
);

async function renderMarketplace(page: "index" | "detail") {
  const [{ createRoot }, context, experiments, marketplace] = await Promise.all(
    [
      import("react-dom/client"),
      import("../experiments/context"),
      import("../experiments/use-experiment"),
      import("./public-marketplace.js"),
    ],
  );
  function Probe({ children }: { children: ReactNode }) {
    experiments.useExperimentExposure(PROBE_KEY, "all");
    return children;
  }
  const entry = MARKETPLACE_V2_FIXTURE.plugins[0]!;
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <context.ExperimentsProvider
        value={{
          distinctID: "server-id",
          featureFlags: ASSIGNED,
          preview: false,
        }}
      >
        <Probe>
          {page === "index" ? (
            <marketplace.PublicMarketplacePage
              manifest={MARKETPLACE_V2_FIXTURE}
              stats={null}
              state={{}}
              onStateChange={() => {}}
            />
          ) : (
            <marketplace.PublicMarketplaceDetailPage
              manifest={MARKETPLACE_V2_FIXTURE}
              entry={entry}
              stats={null}
            />
          )}
        </Probe>
      </context.ExperimentsProvider>,
    );
  });
}

describe("marketplace experiment exposure", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
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
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const mock of Object.values(posthog)) {
      mock.mockClear();
    }
    document.body.replaceChildren();
  });

  it.each(["index", "detail"] as const)(
    "records each exposure once with the server-rendered variant on a direct %s visit",
    async (page) => {
      await renderMarketplace(page);
      await vi.waitFor(() => expect(posthog.init).toHaveBeenCalled());
      expect(posthog.init.mock.calls[0]?.[1].bootstrap).toEqual({
        distinctID: "server-id",
        isIdentifiedID: false,
        featureFlags: ASSIGNED,
      });
      const calls = posthog.capture.mock.calls
        .filter(([event]) => event === "$feature_flag_called")
        .map(([, properties]) => properties);
      const exposed = calls.map((properties) => properties.$feature_flag);
      expect(exposed).toContain(PROBE_KEY);
      expect(new Set(exposed).size).toBe(exposed.length);
      expect(calls.map((properties) => properties.$feature_flag_response)).toEqual(
        exposed.map((key) => ASSIGNED[key]),
      );
    },
  );
});
