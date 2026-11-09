import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFeaturedPluginsExperiment,
  FEATURED_PLUGINS_ASSIGNMENT_FILE_NAME,
  type FeaturedPluginsAssignment,
} from "../../src/services/system/featured-plugins-experiment.js";
import {
  createNoopTelemetryService,
  type TelemetryService,
} from "../../src/services/system/telemetry.js";

function createTestLogger() {
  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

function createTelemetry(enabled = true) {
  const capture = vi.fn<TelemetryService["capture"]>();
  const setSharedProperty = vi.fn<TelemetryService["setSharedProperty"]>();
  const telemetry: TelemetryService = {
    capture,
    isEnabled: () => enabled,
    setEnabled: () => {},
    featureFlagIdentity: () => ({ apiKey: "phc_test", distinctId: "install" }),
    setSharedProperty,
  };
  return { capture, setSharedProperty, telemetry };
}

interface FlagStub {
  enabled?: boolean;
  variant: string | null;
  payload?: unknown;
}

function flagsResponse(flag?: FlagStub): Response {
  return new Response(
    JSON.stringify({
      flags:
        flag === undefined
          ? {}
          : {
              "onboarding-featured-plugins": {
                key: "onboarding-featured-plugins",
                enabled: flag.enabled ?? true,
                variant: flag.variant,
                metadata: {
                  id: 2,
                  version: 1,
                  ...(flag.payload === undefined
                    ? {}
                    : { payload: flag.payload }),
                },
              },
            },
      errorsWhileComputingFlags: false,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const TEST_LIST = JSON.stringify({
  plugins: ["browser-automation", "memory", "push-notifications", "inline-vis"],
});

const DEFAULT: FeaturedPluginsAssignment = {
  variant: "control",
  source: "default",
  plugins: null,
};

describe("featured plugins experiment", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-featured-plugins-test-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function create(args: {
    fetch: typeof globalThis.fetch;
    telemetry: TelemetryService;
    flagTimeoutMs?: number;
  }) {
    return createFeaturedPluginsExperiment({
      dataDir,
      fetch: args.fetch,
      flagTimeoutMs: args.flagTimeoutMs ?? 1_000,
      logger: createTestLogger(),
      telemetry: args.telemetry,
    });
  }

  function respondWith(flag?: FlagStub) {
    return vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => flagsResponse(flag));
  }

  it("returns control without fetching when telemetry is unavailable or off", async () => {
    for (const telemetry of [
      createNoopTelemetryService(),
      createTelemetry(false).telemetry,
    ]) {
      const fetch = vi.fn<typeof globalThis.fetch>();
      const experiment = await create({ fetch, telemetry });
      await expect(experiment.resolve()).resolves.toEqual(DEFAULT);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("reads the list from the new variant's payload once", async () => {
    const fetch = respondWith({ variant: "new", payload: TEST_LIST });
    const { telemetry, setSharedProperty } = createTelemetry();
    const experiment = await create({ fetch, telemetry });

    const [first, second] = await Promise.all([
      experiment.resolve(),
      experiment.resolve(),
    ]);

    expect(first).toEqual({
      variant: "new",
      source: "flag",
      plugins: [
        "browser-automation",
        "memory",
        "push-notifications",
        "inline-vis",
      ],
    });
    expect(second).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(setSharedProperty).toHaveBeenCalledExactlyOnceWith(
      "$feature/onboarding-featured-plugins",
      "new",
    );
  });

  it("ignores a control payload and treats a new variant without a valid payload as the default", async () => {
    const control = await create({
      fetch: respondWith({ variant: "control", payload: TEST_LIST }),
      telemetry: createTelemetry().telemetry,
    });
    await expect(control.resolve()).resolves.toEqual({
      variant: "control",
      source: "flag",
      plugins: null,
    });

    const invalid: FlagStub[] = [
      { variant: "new", payload: "not json" },
      { variant: "new", payload: JSON.stringify({ plugins: "memory" }) },
      { variant: "new", payload: JSON.stringify({ plugins: [] }) },
      { variant: "new", payload: JSON.stringify({ plugins: ["Bad Id"] }) },
      { variant: "new" },
    ];
    for (const flag of invalid) {
      const { telemetry, capture } = createTelemetry();
      const experiment = await create({ fetch: respondWith(flag), telemetry });
      await expect(experiment.resolve()).resolves.toEqual(DEFAULT);
      await experiment.recordExposure("first_run");
      expect(capture.mock.calls.map(([event]) => event.name)).toEqual([
        "onboarding_featured_plugins_exposed",
      ]);
      await rm(join(dataDir, FEATURED_PLUGINS_ASSIGNMENT_FILE_NAME));
    }
  });

  it("accepts a payload object", async () => {
    const experiment = await create({
      fetch: respondWith({ variant: "new", payload: { plugins: ["memory"] } }),
      telemetry: createTelemetry().telemetry,
    });

    await expect(experiment.resolve()).resolves.toEqual({
      variant: "new",
      source: "flag",
      plugins: ["memory"],
    });
  });

  it("falls back to control for missing, disabled or unknown flags and failed requests", async () => {
    const responses: Array<() => Promise<Response>> = [
      async () => flagsResponse(),
      async () => flagsResponse({ enabled: false, variant: null }),
      async () => flagsResponse({ variant: "list-b", payload: TEST_LIST }),
      async () => new Response("not json", { status: 200 }),
      async () => new Response("{}", { status: 401 }),
      async () => {
        throw new TypeError("network down");
      },
    ];
    for (const respond of responses) {
      const experiment = await create({
        fetch: vi.fn<typeof globalThis.fetch>(respond),
        telemetry: createTelemetry().telemetry,
      });
      await expect(experiment.resolve()).resolves.toEqual(DEFAULT);
    }
  });

  it("persists the assignment on exposure and reuses it after a restart", async () => {
    const first = createTelemetry();
    const experiment = await create({
      fetch: respondWith({ variant: "new", payload: TEST_LIST }),
      telemetry: first.telemetry,
    });

    await experiment.recordExposure("first_run");

    expect(first.capture.mock.calls.map(([event]) => event)).toEqual([
      {
        name: "$feature_flag_called",
        properties: {
          $feature_flag: "onboarding-featured-plugins",
          $feature_flag_response: "new",
        },
      },
      {
        name: "onboarding_featured_plugins_exposed",
        properties: {
          entry: "first_run",
          featured_plugins_variant: "new",
          featured_plugins_source: "flag",
          $set: { featured_plugins_variant: "new" },
        },
      },
    ]);
    const saved = await experiment.resolve();
    expect(
      JSON.parse(
        await readFile(
          join(dataDir, FEATURED_PLUGINS_ASSIGNMENT_FILE_NAME),
          "utf8",
        ),
      ),
    ).toEqual(saved);

    const restartedFetch = vi.fn<typeof globalThis.fetch>();
    const restarted = createTelemetry();
    const afterRestart = await create({
      fetch: restartedFetch,
      telemetry: restarted.telemetry,
    });
    expect(restarted.setSharedProperty).toHaveBeenCalledWith(
      "$feature/onboarding-featured-plugins",
      "new",
    );
    await expect(afterRestart.resolve()).resolves.toEqual(saved);
    expect(restartedFetch).not.toHaveBeenCalled();
  });

  it("does not send a flag exposure for the default assignment", async () => {
    const { telemetry, capture } = createTelemetry();
    const experiment = await create({
      fetch: vi.fn<typeof globalThis.fetch>(async () => {
        throw new TypeError("offline");
      }),
      telemetry,
    });

    await experiment.recordExposure("replay");

    expect(capture).toHaveBeenCalledExactlyOnceWith({
      name: "onboarding_featured_plugins_exposed",
      properties: {
        entry: "replay",
        featured_plugins_variant: "control",
        featured_plugins_source: "default",
        $set: { featured_plugins_variant: "control" },
      },
    });
  });
});
