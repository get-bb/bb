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
}

function flagBody(guide?: FlagStub) {
  return {
    flags:
      guide === undefined
        ? {}
        : {
            "setup-guide-redesign": {
              key: "setup-guide-redesign",
              enabled: guide.enabled ?? true,
              variant: guide.variant,
              metadata: { id: 1, version: 2 },
            },
          },
    errorsWhileComputingFlags: false,
  };
}

const DEFAULTS: SetupGuideAssignments = {
  guide: { variant: "control", source: "default" },
};

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

  it("uses the override without evaluating the flag", async () => {
    for (const telemetry of [
      createTelemetry().telemetry,
      createNoopTelemetryService(),
    ]) {
      const fetch = respondWith(flagBody({ variant: "control" }));
      const experiment = await create({ fetch, override: "new", telemetry });

      await expect(experiment.resolve()).resolves.toEqual({
        guide: { variant: "new", source: "override" },
      });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("returns control without fetching when telemetry is unavailable or off", async () => {
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

  it("evaluates the flag once and tags later events with its variant", async () => {
    const fetch = respondWith(flagBody({ variant: "new" }));
    const { telemetry, setSharedProperty } = createTelemetry();
    const experiment = await create({ fetch, telemetry });

    const [first, second] = await Promise.all([
      experiment.resolve(),
      experiment.resolve(),
    ]);

    expect(first).toEqual({ guide: { variant: "new", source: "flag" } });
    expect(second).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://us.i.posthog.com/flags?v=2");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      api_key: "phc_test",
      distinct_id: "install",
    });
    expect(setSharedProperty).toHaveBeenCalledExactlyOnceWith(
      "$feature/setup-guide-redesign",
      "new",
    );
  });

  it("falls back to control for unknown variants and failed requests", async () => {
    const responses: Array<() => Promise<Response>> = [
      async () => flagsResponse({ flags: {}, errorsWhileComputingFlags: true }),
      async () => flagsResponse(flagBody({ variant: "redesign-b" })),
      async () => flagsResponse(flagBody({ enabled: false, variant: null })),
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

  it("persists the assignment on exposure and reuses it after a restart", async () => {
    const first = createTelemetry();
    const experiment = await create({
      fetch: respondWith(flagBody({ variant: "new" })),
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
    const saved = { guide: { variant: "new", source: "flag" } };
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
    await expect(afterRestart.resolve()).resolves.toEqual(saved);
    expect(restartedFetch).not.toHaveBeenCalled();
  });

  it("does not save an override", async () => {
    const experiment = await create({
      fetch: respondWith(flagBody({ variant: "control" })),
      override: "new",
      telemetry: createTelemetry().telemetry,
    });

    await experiment.recordExposure("first_run");

    await expect(
      readFile(join(dataDir, SETUP_GUIDE_ASSIGNMENT_FILE_NAME), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
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
    const fetch = respondWith(flagBody({ variant: "control" }));
    const experiment = await create({
      fetch,
      telemetry: createTelemetry().telemetry,
    });

    await expect(experiment.resolve()).resolves.toEqual({
      guide: { variant: "control", source: "flag" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("adds the variant only to setup-guide events", async () => {
    const experiment = await create({
      fetch: respondWith(flagBody({ variant: "new" })),
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
