// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExperimentBootstrap } from "./flags";

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  getFeatureFlag: vi.fn(),
  get_distinct_id: vi.fn(() => "client-id"),
  get_session_id: vi.fn(() => "client-session"),
}));

vi.mock("posthog-js", () => ({ default: posthog }));

const SERVER_ID = "0199f0a1-2b3c-7d4e-8f90-a1b2c3d4e5f6";

async function loadModules() {
  const [router, client, server, experiments, analytics] = await Promise.all([
    import("@tanstack/react-router"),
    import("react-dom/client"),
    import("react-dom/server"),
    import("./use-experiment"),
    import("../landing/analytics"),
  ]);
  return { router, client, server, experiments, analytics };
}

type Modules = Awaited<ReturnType<typeof loadModules>>;

function createProbeRouter(
  modules: Modules,
  serverExperiments: ExperimentBootstrap | null,
  seen = true,
) {
  const { router, experiments, analytics } = modules;
  function Probe() {
    const variant = experiments.useExperiment("homepage-qa-check");
    experiments.useExperimentExposure("homepage-qa-check", "desktop", seen);
    analytics.useInitAnalytics(experiments.useExperimentBootstrap());
    return (
      <main data-qa-check={variant === "test" ? variant : undefined}>
        {variant}
      </main>
    );
  }
  const rootRoute = router.createRootRoute({
    beforeLoad: experiments.experimentsBeforeLoad,
    component: Probe,
  });
  const instance = router.createRouter({
    routeTree: rootRoute,
    history: router.createMemoryHistory({ initialEntries: ["/"] }),
  });
  if (serverExperiments !== null) {
    instance.update({
      additionalContext: { serverContext: { experiments: serverExperiments } },
    });
  }
  return instance;
}

async function serverRender(
  modules: Modules,
  experiments: ExperimentBootstrap,
): Promise<string> {
  const instance = createProbeRouter(modules, experiments);
  await instance.load();
  return modules.server.renderToString(
    <modules.router.RouterProvider router={instance} />,
  );
}

async function hydratePage(
  modules: Modules,
  experiments: ExperimentBootstrap | null,
  html: string,
  seen = true,
) {
  const errors: unknown[] = [];
  vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args);
  });
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const instance = createProbeRouter(modules, experiments, seen);
  await instance.load();
  await act(async () => {
    modules.client.hydrateRoot(
      container,
      <modules.router.RouterProvider router={instance} />,
      { onRecoverableError: (error) => errors.push(error) },
    );
  });
  return { container, errors };
}

function bootstrap(
  featureFlags: Record<string, string>,
  preview = false,
): ExperimentBootstrap {
  return { distinctID: SERVER_ID, featureFlags, preview };
}

function matchTouch(touch: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: touch })),
  );
}

describe("server-rendered experiments", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    matchTouch(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const mock of Object.values(posthog)) {
      mock.mockClear();
    }
    history.replaceState(null, "", "/");
    document.body.replaceChildren();
  });

  it("hydrates the server arm and exposes it once after bb_internal", async () => {
    history.replaceState(null, "", "/?bb_internal=1");
    const modules = await loadModules();
    const experiments = bootstrap({ "homepage-qa-check": "test" });
    const html = await serverRender(modules, experiments);
    expect(html).toContain('<main data-qa-check="test">test</main>');
    const { container, errors } = await hydratePage(modules, experiments, html);
    expect(errors).toEqual([]);
    expect(container.innerHTML).toBe(html);
    await vi.waitFor(() => expect(posthog.getFeatureFlag).toHaveBeenCalled());
    expect(posthog.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        bootstrap: {
          distinctID: SERVER_ID,
          isIdentifiedID: false,
          featureFlags: { "homepage-qa-check": "test" },
        },
      }),
    );
    expect(posthog.register).toHaveBeenCalledWith({ internal_user: true });
    expect(posthog.register.mock.invocationCallOrder[0]).toBeLessThan(
      posthog.getFeatureFlag.mock.invocationCallOrder[0] ?? 0,
    );
    expect(posthog.getFeatureFlag.mock.calls).toEqual([["homepage-qa-check"]]);
  });

  it.each([
    ["control", "control"],
    ["holdout-7", "control"],
  ])("renders %s as %s and still exposes it", async (assigned, rendered) => {
    const modules = await loadModules();
    const experiments = bootstrap({ "homepage-qa-check": assigned });
    const html = await serverRender(modules, experiments);
    expect(html).toContain(`<main>${rendered}</main>`);
    const { errors } = await hydratePage(modules, experiments, html);
    expect(errors).toEqual([]);
    await vi.waitFor(() =>
      expect(posthog.getFeatureFlag.mock.calls).toEqual([
        ["homepage-qa-check"],
      ]),
    );
  });

  it("waits to expose until the exposure point is seen", async () => {
    const modules = await loadModules();
    const experiments = bootstrap({ "homepage-qa-check": "test" });
    const html = await serverRender(modules, experiments);
    const { errors } = await hydratePage(modules, experiments, html, false);
    expect(errors).toEqual([]);
    await vi.waitFor(() => expect(posthog.init).toHaveBeenCalled());
    expect(posthog.getFeatureFlag).not.toHaveBeenCalled();
  });

  it("renders control and exposes nothing without an active flag", async () => {
    const modules = await loadModules();
    const experiments = bootstrap({});
    const html = await serverRender(modules, experiments);
    expect(html).toContain("<main>control</main>");
    await hydratePage(modules, experiments, html);
    await vi.waitFor(() => expect(posthog.init).toHaveBeenCalled());
    expect(posthog.getFeatureFlag).not.toHaveBeenCalled();
  });

  it("renders a forced preview without exposure or bootstrapped flags", async () => {
    const modules = await loadModules();
    const experiments = bootstrap({ "homepage-qa-check": "test" }, true);
    const html = await serverRender(modules, experiments);
    expect(html).toContain('data-qa-check="test"');
    const { errors } = await hydratePage(modules, experiments, html);
    expect(errors).toEqual([]);
    await vi.waitFor(() => expect(posthog.init).toHaveBeenCalled());
    expect(posthog.init.mock.calls[0]?.[1].bootstrap.featureFlags).toEqual({});
    expect(posthog.getFeatureFlag).not.toHaveBeenCalled();
  });

  it("renders control without a server bootstrap", async () => {
    const modules = await loadModules();
    const html = await serverRender(modules, bootstrap({}));
    const { container } = await hydratePage(modules, null, html);
    expect(container.textContent).toBe("control");
    await vi.waitFor(() => expect(posthog.init).toHaveBeenCalled());
    expect(posthog.init.mock.calls[0]?.[1]).not.toHaveProperty("bootstrap");
    expect(posthog.getFeatureFlag).not.toHaveBeenCalled();
  });

  it.each([
    ["desktop", false, 1],
    ["desktop", true, 0],
    ["touch", true, 1],
    ["touch", false, 0],
    ["all", true, 1],
  ] as const)(
    "counts a %s-only exposure on touch=%s %i times",
    async (devices, touch, calls) => {
      matchTouch(touch);
      const { analytics } = await loadModules();
      analytics.exposeExperiment("homepage-qa-check", devices);
      analytics.exposeExperiment("homepage-qa-check", devices);
      analytics.initAnalytics(bootstrap({ "homepage-qa-check": "test" }));
      await vi.waitFor(() => expect(posthog.init).toHaveBeenCalled());
      expect(posthog.getFeatureFlag).toHaveBeenCalledTimes(calls);
    },
  );
});

describe("early download clicks", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const mock of Object.values(posthog)) {
      mock.mockClear();
    }
    sessionStorage.clear();
    document.body.replaceChildren();
  });

  it("carry the server-rendered ID until posthog-js loads", async () => {
    const { analytics } = await loadModules();
    const { carryUtmToDownloadLinks } = await import("../landing/download-utm");
    expect(analytics.readVisitIds()).toBeNull();
    analytics.initAnalytics(bootstrap({}));
    const stop = carryUtmToDownloadLinks(analytics.readVisitIds);
    const link = document.createElement("a");
    link.href = "/download/macos?placement=hero";
    link.addEventListener("click", (event) => event.preventDefault());
    document.body.appendChild(link);
    link.click();
    expect(new URL(link.href).searchParams.get("visitor_id")).toBe(SERVER_ID);
    expect(new URL(link.href).searchParams.has("session_id")).toBe(false);
    await vi.waitFor(() => expect(posthog.init).toHaveBeenCalled());
    link.click();
    expect(new URL(link.href).searchParams.get("visitor_id")).toBe("client-id");
    expect(new URL(link.href).searchParams.get("session_id")).toBe(
      "client-session",
    );
    stop();
  });
});
