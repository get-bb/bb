import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetupGuideVariant } from "@bb/server-contract";
import {
  createSetupGuideExperiment,
  SETUP_GUIDE_ASSIGNMENT_FILE_NAME,
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

function flagBody(args: {
  enabled?: boolean;
  variant: string | null;
  payload?: string;
}) {
  return {
    flags: {
      "setup-guide-redesign": {
        key: "setup-guide-redesign",
        enabled: args.enabled ?? true,
        variant: args.variant,
        metadata: {
          id: 1,
          version: 2,
          ...(args.payload === undefined ? {} : { payload: args.payload }),
        },
      },
    },
    errorsWhileComputingFlags: false,
  };
}

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

  it("uses the override without consulting telemetry or the flag", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const experiment = await create({
      fetch,
      override: "new",
      telemetry: createNoopTelemetryService(),
    });

    await expect(experiment.resolve()).resolves.toEqual({
      variant: "new",
      featuredPluginEntryIds: null,
      source: "override",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns control without fetching when telemetry is unavailable or off", async () => {
    for (const telemetry of [
      createNoopTelemetryService(),
      createTelemetry(false).telemetry,
    ]) {
      const fetch = vi.fn<typeof globalThis.fetch>();
      const experiment = await create({ fetch, telemetry });
      await expect(experiment.resolve()).resolves.toEqual({
        variant: "control",
        featuredPluginEntryIds: null,
        source: "default",
      });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("evaluates the flag once and parses the new variant's payload", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      flagsResponse(
        flagBody({
          variant: "new",
          payload: JSON.stringify({ plugins: ["memory", "inline-vis"] }),
        }),
      ),
    );
    const { telemetry, setSharedProperty } = createTelemetry();
    const experiment = await create({ fetch, telemetry });

    const [first, second] = await Promise.all([
      experiment.resolve(),
      experiment.resolve(),
    ]);

    expect(first).toEqual({
      variant: "new",
      featuredPluginEntryIds: ["memory", "inline-vis"],
      source: "flag",
    });
    expect(second).toBe(first);
    await experiment.resolve();
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
  });

  it("keeps the new variant but drops an invalid payload", async () => {
    for (const payload of [
      "not json",
      JSON.stringify({ plugins: "memory" }),
      JSON.stringify({ plugins: [] }),
      JSON.stringify({ plugins: ["Bad Id"] }),
    ]) {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          flagsResponse(flagBody({ variant: "new", payload })),
        );
      const experiment = await create({
        fetch,
        telemetry: createTelemetry().telemetry,
      });
      await expect(experiment.resolve()).resolves.toEqual({
        variant: "new",
        featuredPluginEntryIds: null,
        source: "flag",
      });
    }
  });

  it("returns control for the control variant without a payload", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      flagsResponse(
        flagBody({
          variant: "control",
          payload: JSON.stringify({ plugins: ["memory"] }),
        }),
      ),
    );
    const experiment = await create({
      fetch,
      telemetry: createTelemetry().telemetry,
    });

    await expect(experiment.resolve()).resolves.toEqual({
      variant: "control",
      featuredPluginEntryIds: null,
      source: "flag",
    });
  });

  it("falls back to control for missing, disabled, or unknown flags and failed requests", async () => {
    const responses: Array<() => Promise<Response>> = [
      async () => flagsResponse({ flags: {}, errorsWhileComputingFlags: true }),
      async () => flagsResponse(flagBody({ enabled: false, variant: null })),
      async () => flagsResponse(flagBody({ variant: "redesign-b" })),
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
      await expect(experiment.resolve()).resolves.toEqual({
        variant: "control",
        featuredPluginEntryIds: null,
        source: "default",
      });
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

    await expect(experiment.resolve()).resolves.toEqual({
      variant: "control",
      featuredPluginEntryIds: null,
      source: "default",
    });
  });

  it("persists the assignment on exposure and reuses it after a restart", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(flagsResponse(flagBody({ variant: "new" })));
    const first = createTelemetry();
    const experiment = await create({ fetch, telemetry: first.telemetry });

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
          name: "onboarding_exposed",
          properties: {
            entry: "first_run",
            setup_guide_variant: "new",
            setup_guide_source: "flag",
            $set: { setup_guide_variant: "new" },
          },
        },
      ],
    ]);
    expect(
      JSON.parse(
        await readFile(join(dataDir, SETUP_GUIDE_ASSIGNMENT_FILE_NAME), "utf8"),
      ),
    ).toEqual({
      variant: "new",
      featuredPluginEntryIds: null,
      source: "flag",
    });

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
    await expect(afterRestart.resolve()).resolves.toEqual({
      variant: "new",
      featuredPluginEntryIds: null,
      source: "flag",
    });
    expect(restartedFetch).not.toHaveBeenCalled();
  });

  it("does not send a flag exposure for a default assignment", async () => {
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
        $set: { setup_guide_variant: "control" },
      },
    });
  });

  it("ignores an unreadable persisted assignment", async () => {
    await writeFile(
      join(dataDir, SETUP_GUIDE_ASSIGNMENT_FILE_NAME),
      '{"variant":"other"}',
    );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(flagsResponse(flagBody({ variant: "control" })));
    const experiment = await create({
      fetch,
      telemetry: createTelemetry().telemetry,
    });

    await expect(experiment.resolve()).resolves.toMatchObject({
      variant: "control",
      source: "flag",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("adds the variant only to setup-guide events", async () => {
    const experiment = await create({
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(flagsResponse(flagBody({ variant: "new" }))),
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
      },
    });
    const releaseNotes = {
      name: "release_notes_opened",
      properties: { release_version: "0.47.0", view: "web" },
    } as const;
    await expect(experiment.annotate(releaseNotes)).resolves.toBe(releaseNotes);
  });
});
