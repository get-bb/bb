import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetupGuideVariant } from "@bb/server-contract";
import {
  createSetupGuideExperiment,
  SETUP_GUIDE_ASSIGNMENT_FILE_NAME,
  type SetupGuideAssignments,
} from "../../src/services/system/setup-guide-experiment.js";
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

function flagsResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface FlagStub {
  enabled?: boolean;
  variant: string | null;
  payload?: string;
}

function flagEntry(key: string, flag: FlagStub) {
  return {
    key,
    enabled: flag.enabled ?? true,
    variant: flag.variant,
    metadata: {
      id: 1,
      version: 2,
      ...(flag.payload === undefined ? {} : { payload: flag.payload }),
    },
  };
}

function flagBody(args: { guide?: FlagStub; plugins?: FlagStub }) {
  return {
    flags: {
      ...(args.guide === undefined
        ? {}
        : {
            "setup-guide-redesign": flagEntry(
              "setup-guide-redesign",
              args.guide,
            ),
          }),
      ...(args.plugins === undefined
        ? {}
        : {
            "onboarding-featured-plugins": flagEntry(
              "onboarding-featured-plugins",
              args.plugins,
            ),
          }),
    },
    errorsWhileComputingFlags: false,
  };
}

const DEFAULTS: SetupGuideAssignments = {
  guide: { variant: "control", source: "default" },
  plugins: {
    variant: "control",
    source: "default",
    featuredPluginEntryIds: null,
  },
};

const PLUGIN_LIST = JSON.stringify({ plugins: ["memory", "inline-vis"] });

describe("setup guide experiment", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-setup-guide-test-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function create(args: {
    fetch: typeof globalThis.fetch;
    telemetry: TelemetryService;
    override?: SetupGuideVariant;
    flagTimeoutMs?: number;
  }) {
    return createSetupGuideExperiment({
      dataDir,
      fetch: args.fetch,
      flagTimeoutMs: args.flagTimeoutMs ?? 1_000,
      logger: createTestLogger(),
      override: args.override ?? null,
      telemetry: args.telemetry,
    });
  }

  function respondWith(body: unknown) {
    return vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(flagsResponse(body));
  }

  it("forces only the guide with the override and still evaluates the plugin flag", async () => {
    const fetch = respondWith(
      flagBody({
        guide: { variant: "control" },
        plugins: { variant: "new", payload: PLUGIN_LIST },
      }),
    );
    const experiment = await create({
      fetch,
      override: "new",
      telemetry: createTelemetry().telemetry,
    });

    await expect(experiment.resolve()).resolves.toEqual({
      guide: { variant: "new", source: "override" },
      plugins: {
        variant: "new",
        source: "flag",
        featuredPluginEntryIds: ["memory", "inline-vis"],
      },
    });
  });

  it("forces the guide without telemetry and leaves the plugin flag on control", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const experiment = await create({
      fetch,
      override: "new",
      telemetry: createNoopTelemetryService(),
    });

    await expect(experiment.resolve()).resolves.toEqual({
      ...DEFAULTS,
      guide: { variant: "new", source: "override" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns control for both flags without fetching when telemetry is unavailable or off", async () => {
    for (const telemetry of [
      createNoopTelemetryService(),
      createTelemetry(false).telemetry,
    ]) {
      const fetch = vi.fn<typeof globalThis.fetch>();
      const experiment = await create({ fetch, telemetry });
      await expect(experiment.resolve()).resolves.toEqual(DEFAULTS);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("evaluates both flags in one request and reads the plugin list from the plugin flag", async () => {
    const fetch = respondWith(
      flagBody({
        guide: {
          variant: "new",
          payload: JSON.stringify({ plugins: ["tasks"] }),
        },
        plugins: { variant: "new", payload: PLUGIN_LIST },
      }),
    );
    const { telemetry, setSharedProperty } = createTelemetry();
    const experiment = await create({ fetch, telemetry });

    const [first, second] = await Promise.all([
      experiment.resolve(),
      experiment.resolve(),
    ]);

    expect(first).toEqual({
      guide: { variant: "new", source: "flag" },
      plugins: {
        variant: "new",
        source: "flag",
        featuredPluginEntryIds: ["memory", "inline-vis"],
      },
    });
    expect(second).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://us.i.posthog.com/flags?v=2");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      api_key: "phc_test",
      distinct_id: "install",
    });
    expect(setSharedProperty).toHaveBeenCalledWith(
      "$feature/setup-guide-redesign",
      "new",
    );
    expect(setSharedProperty).toHaveBeenCalledWith(
      "$feature/onboarding-featured-plugins",
      "new",
    );
  });

  it("falls back each flag to control on its own", async () => {
    const onlyPlugins = await create({
      fetch: respondWith(
        flagBody({ plugins: { variant: "new", payload: PLUGIN_LIST } }),
      ),
      telemetry: createTelemetry().telemetry,
    });
    await expect(onlyPlugins.resolve()).resolves.toEqual({
      guide: DEFAULTS.guide,
      plugins: {
        variant: "new",
        source: "flag",
        featuredPluginEntryIds: ["memory", "inline-vis"],
      },
    });

    const onlyGuide = await create({
      fetch: respondWith(
        flagBody({
          guide: { variant: "new" },
          plugins: { enabled: false, variant: null },
        }),
      ),
      telemetry: createTelemetry().telemetry,
    });
    await expect(onlyGuide.resolve()).resolves.toEqual({
      guide: { variant: "new", source: "flag" },
      plugins: DEFAULTS.plugins,
    });
  });

  it("keeps the plugin variant but drops an invalid or control payload", async () => {
    const cases: FlagStub[] = [
      { variant: "new", payload: "not json" },
      { variant: "new", payload: JSON.stringify({ plugins: "memory" }) },
      { variant: "new", payload: JSON.stringify({ plugins: [] }) },
      { variant: "new", payload: JSON.stringify({ plugins: ["Bad Id"] }) },
      { variant: "control", payload: PLUGIN_LIST },
    ];
    for (const plugins of cases) {
      const experiment = await create({
        fetch: respondWith(flagBody({ plugins })),
        telemetry: createTelemetry().telemetry,
      });
      await expect(experiment.resolve()).resolves.toEqual({
        guide: DEFAULTS.guide,
        plugins: {
          variant: plugins.variant,
          source: "flag",
          featuredPluginEntryIds: null,
        },
      });
    }
  });

  it("falls back to control for unknown variants and failed requests", async () => {
    const responses: Array<() => Promise<Response>> = [
      async () => flagsResponse({ flags: {}, errorsWhileComputingFlags: true }),
      async () =>
        flagsResponse(
          flagBody({
            guide: { variant: "redesign-b" },
            plugins: { variant: "list-b" },
          }),
        ),
      async () => flagsResponse({ unexpected: true }),
      async () => flagsResponse({ error: "bad key" }, 401),
      async () => new Response("not json", { status: 200 }),
      async () => {
        throw new TypeError("network down");
      },
    ];
    for (const respond of responses) {
      const experiment = await create({
        fetch: vi.fn<typeof globalThis.fetch>(respond),
        telemetry: createTelemetry().telemetry,
      });
      await expect(experiment.resolve()).resolves.toEqual(DEFAULTS);
    }
  });

  it("falls back to control when the flag request times out", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const experiment = await create({
      fetch,
      flagTimeoutMs: 10,
      telemetry: createTelemetry().telemetry,
    });

    await expect(experiment.resolve()).resolves.toEqual(DEFAULTS);
  });

  it("persists both assignments on exposure and reuses them after a restart", async () => {
    const first = createTelemetry();
    const experiment = await create({
      fetch: respondWith(
        flagBody({
          guide: { variant: "new" },
          plugins: { variant: "new", payload: PLUGIN_LIST },
        }),
      ),
      telemetry: first.telemetry,
    });

    await experiment.recordExposure("first_run");

    expect(first.capture.mock.calls).toEqual([
      [
        {
          name: "$feature_flag_called",
          properties: {
            $feature_flag: "setup-guide-redesign",
            $feature_flag_response: "new",
          },
        },
      ],
      [
        {
          name: "$feature_flag_called",
          properties: {
            $feature_flag: "onboarding-featured-plugins",
            $feature_flag_response: "new",
          },
        },
      ],
      [
        {
          name: "onboarding_exposed",
          properties: {
            entry: "first_run",
            setup_guide_variant: "new",
            setup_guide_source: "flag",
            featured_plugins_variant: "new",
            featured_plugins_source: "flag",
            $set: {
              setup_guide_variant: "new",
              featured_plugins_variant: "new",
            },
          },
        },
      ],
    ]);
    const saved = {
      guide: { variant: "new", source: "flag" },
      plugins: {
        variant: "new",
        source: "flag",
        featuredPluginEntryIds: ["memory", "inline-vis"],
      },
    };
    expect(
      JSON.parse(
        await readFile(join(dataDir, SETUP_GUIDE_ASSIGNMENT_FILE_NAME), "utf8"),
      ),
    ).toEqual(saved);

    const restartedFetch = vi.fn<typeof globalThis.fetch>();
    const restarted = createTelemetry();
    const afterRestart = await create({
      fetch: restartedFetch,
      telemetry: restarted.telemetry,
    });
    expect(restarted.setSharedProperty).toHaveBeenCalledWith(
      "$feature/setup-guide-redesign",
      "new",
    );
    expect(restarted.setSharedProperty).toHaveBeenCalledWith(
      "$feature/onboarding-featured-plugins",
      "new",
    );
    await expect(afterRestart.resolve()).resolves.toEqual(saved);
    expect(restartedFetch).not.toHaveBeenCalled();
  });

  it("keeps the guide override out of the saved file", async () => {
    const experiment = await create({
      fetch: respondWith(flagBody({ plugins: { variant: "control" } })),
      override: "new",
      telemetry: createTelemetry().telemetry,
    });

    await experiment.recordExposure("first_run");

    expect(
      JSON.parse(
        await readFile(join(dataDir, SETUP_GUIDE_ASSIGNMENT_FILE_NAME), "utf8"),
      ),
    ).toEqual({
      guide: null,
      plugins: {
        variant: "control",
        source: "flag",
        featuredPluginEntryIds: null,
      },
    });
  });

  it("reads a file saved by the single-flag shape as the guide assignment", async () => {
    await writeFile(
      join(dataDir, SETUP_GUIDE_ASSIGNMENT_FILE_NAME),
      JSON.stringify({
        variant: "new",
        featuredPluginEntryIds: ["memory"],
        source: "flag",
      }),
    );
    const fetch = vi.fn<typeof globalThis.fetch>();
    const experiment = await create({
      fetch,
      telemetry: createTelemetry().telemetry,
    });

    await expect(experiment.resolve()).resolves.toEqual({
      guide: { variant: "new", source: "flag" },
      plugins: {
        variant: "control",
        source: "default",
        featuredPluginEntryIds: ["memory"],
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not send flag exposures for default assignments", async () => {
    const { telemetry, capture } = createTelemetry();
    const experiment = await create({
      fetch: vi.fn<typeof globalThis.fetch>(async () => {
        throw new TypeError("offline");
      }),
      telemetry,
    });

    await experiment.recordExposure("replay");

    expect(capture).toHaveBeenCalledExactlyOnceWith({
      name: "onboarding_exposed",
      properties: {
        entry: "replay",
        setup_guide_variant: "control",
        setup_guide_source: "default",
        featured_plugins_variant: "control",
        featured_plugins_source: "default",
        $set: {
          setup_guide_variant: "control",
          featured_plugins_variant: "control",
        },
      },
    });
  });

  it("ignores an unreadable persisted assignment", async () => {
    await writeFile(
      join(dataDir, SETUP_GUIDE_ASSIGNMENT_FILE_NAME),
      '{"variant":"other"}',
    );
    const fetch = respondWith(flagBody({ guide: { variant: "control" } }));
    const experiment = await create({
      fetch,
      telemetry: createTelemetry().telemetry,
    });

    await expect(experiment.resolve()).resolves.toEqual({
      guide: { variant: "control", source: "flag" },
      plugins: DEFAULTS.plugins,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("adds both variants only to setup-guide events", async () => {
    const experiment = await create({
      fetch: respondWith(
        flagBody({
          guide: { variant: "new" },
          plugins: { variant: "control" },
        }),
      ),
      telemetry: createTelemetry().telemetry,
    });

    await expect(
      experiment.annotate({
        name: "onboarding_step_reached",
        properties: { step: "plugins", entry: "first_run" },
      }),
    ).resolves.toEqual({
      name: "onboarding_step_reached",
      properties: {
        step: "plugins",
        entry: "first_run",
        setup_guide_variant: "new",
        featured_plugins_variant: "control",
      },
    });
    const releaseNotes = {
      name: "release_notes_opened",
      properties: { release_version: "0.47.0", view: "web" },
    } as const;
    await expect(experiment.annotate(releaseNotes)).resolves.toBe(releaseNotes);
  });
});
