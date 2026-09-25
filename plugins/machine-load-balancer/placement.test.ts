import { makeHostResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import type { Machine, MachineProvider } from "./contract.js";
import {
  decidePlacement,
  FRESHNESS_BOUND_MS,
  hostAvailability,
  isStale,
  loadReading,
  machineProviders,
  nextPick,
  rankMachines,
  type Measurement,
  type SourceObservation,
} from "./placement.js";

const NOW = 1_000_000;

const codexReady: MachineProvider = {
  providerId: "codex",
  displayName: "Codex",
  readiness: { kind: "ready" },
};

function machine(
  hostId: string,
  overrides: Partial<Machine> = {},
): Machine {
  return {
    hostId,
    name: hostId,
    isServer: false,
    availability: { kind: "available" },
    capacity: { kind: "unavailable", reason: "not measured in this test" },
    load: { kind: "unavailable", reason: "no load" },
    providers: { kind: "reported", providers: [codexReady] },
    runningThreads: [],
    ...overrides,
  };
}

function loaded(
  hostId: string,
  oneMinuteLoad: number,
  availableParallelism: number,
  overrides: Partial<Machine> & { requestedAt?: number } = {},
): Machine {
  const { requestedAt = NOW - 1_000, ...rest } = overrides;
  return machine(hostId, {
    load: { kind: "fresh", oneMinuteLoad, availableParallelism, requestedAt },
    ...rest,
  });
}

function providerState(
  status:
    | "ready"
    | "not_installed"
    | "unsupported_version"
    | "unauthenticated"
    | "expired"
    | "unknown",
  statusMessage: string | null = null,
) {
  return {
    providerId: "pi",
    displayName: "Pi",
    status,
    statusMessage,
    accountEmail: null,
    planLabel: null,
    installedVersion: null,
    minimumSupportedVersion: null,
    canInstall: false,
    canUpdate: false,
    loginCommand: null,
  };
}

function request(
  sources: Record<string, SourceObservation>,
  providerId = "codex",
) {
  return {
    projectName: "App",
    providerId,
    sources: new Map(Object.entries(sources)),
  };
}

const everywhere = (...hostIds: string[]) =>
  Object.fromEntries(hostIds.map((id) => [id, { kind: "available" } as const]));

describe("rankMachines", () => {
  it("orders by load per processor, then server, then host id, with unmeasured and unavailable machines last", () => {
    const ranked = rankMachines(
      [
        machine("offline", {
          availability: {
            kind: "unavailable",
            code: "disconnected",
            reason: "Machine is disconnected.",
          },
        }),
        machine("unmeasured"),
        loaded("stale", 0, 8, { requestedAt: NOW - FRESHNESS_BOUND_MS - 1 }),
        loaded("small", 2, 2),
        loaded("b", 1, 4),
        loaded("server", 2, 8, { isServer: true }),
        loaded("a", 1, 4),
        loaded("large", 4, 16),
      ],
      NOW,
    );
    expect(ranked.map((entry) => entry.hostId)).toEqual([
      "server",
      "a",
      "b",
      "large",
      "small",
      "stale",
      "unmeasured",
      "offline",
    ]);
  });
});

describe("nextPick", () => {
  it("is the least-loaded machine with a fresh reading and a ready provider", () => {
    const signedOut = loaded("idle", 0, 8, {
      providers: {
        kind: "reported",
        providers: machineProviders([providerState("unauthenticated")]),
      },
    });
    expect(nextPick([signedOut, loaded("busy", 6, 8)], NOW)).toBe("busy");
    expect(nextPick([signedOut, machine("unmeasured")], NOW)).toBeNull();
  });
});

describe("isStale", () => {
  it("marks an observation stale only after the placement freshness window", () => {
    expect(isStale(NOW - FRESHNESS_BOUND_MS, NOW)).toBe(false);
    expect(isStale(NOW - FRESHNESS_BOUND_MS - 1, NOW)).toBe(true);
  });
});

describe("machineProviders", () => {
  it.each([
    ["not_installed", "provider-cli-missing", "not installed", "Provider CLI is not installed."],
    ["unsupported_version", "provider-cli-unsupported", "unsupported version", "Provider CLI version is not supported."],
    ["unauthenticated", "provider-not-signed-in", "not signed in", "Provider is not signed in."],
    ["expired", "provider-sign-in-expired", "sign-in expired", "Provider sign-in has expired."],
    ["unknown", "provider-readiness-unknown", "readiness unknown", "Provider readiness is unknown."],
  ] as const)("labels %s with a code, short label, and reason", (status, code, label, reason) => {
    expect(machineProviders([providerState(status)])).toEqual([
      {
        providerId: "pi",
        displayName: "Pi",
        readiness: { kind: "not-ready", code, label, reason },
      },
    ]);
  });

  it("prefers the provider's own status message as the reason", () => {
    expect(
      machineProviders([providerState("unauthenticated", "Run pi login.")])[0]
        ?.readiness,
    ).toMatchObject({ label: "not signed in", reason: "Run pi login." });
    expect(machineProviders([providerState("ready")])[0]?.readiness).toEqual({
      kind: "ready",
    });
  });
});

describe("decidePlacement", () => {
  it("chooses the least-loaded eligible machine and names it in the reason", () => {
    const placement = decidePlacement(
      [loaded("small", 2, 2), loaded("large", 4, 16)],
      request(everywhere("small", "large")),
      NOW,
    );
    expect(placement).toMatchObject({
      kind: "chosen",
      machine: { hostId: "large", loadPerProcessor: 0.25 },
      reason: "large has the lowest load per processor (0.25).",
      skipped: [],
    });
  });

  it("skips machines without a source, with a failed source check, or with a not-ready provider", () => {
    const placement = decidePlacement(
      [
        loaded("no-source", 0, 8),
        loaded("probe-failed", 0, 8),
        loaded("signed-out", 0, 8, {
          providers: {
            kind: "reported",
            providers: [
              {
                providerId: "codex",
                displayName: "Codex",
                readiness: {
                  kind: "not-ready",
                  code: "provider-not-signed-in",
                  label: "not signed in",
                  reason: "Provider is not signed in.",
                },
              },
            ],
          },
        }),
        loaded("no-codex", 0, 8, {
          providers: { kind: "reported", providers: [] },
        }),
        loaded("unknown", 0, 8, {
          providers: { kind: "unavailable", reason: "timeout" },
        }),
        loaded("busy", 7, 8),
      ],
      request({
        "probe-failed": { kind: "failed", reason: "Source check failed: EACCES" },
        ...everywhere("signed-out", "no-codex", "unknown", "busy"),
      }),
      NOW,
    );
    expect(placement.kind).toBe("chosen");
    expect(placement.kind !== "not-requested" && placement.skipped).toEqual([
      {
        hostId: "no-codex",
        name: "no-codex",
        code: "provider-not-offered",
        label: "codex not offered",
        reason: "Provider is not offered on this machine.",
      },
      {
        hostId: "no-source",
        name: "no-source",
        code: "no-project-source",
        label: "no source for App",
        reason: "App has no source on this machine.",
      },
      {
        hostId: "probe-failed",
        name: "probe-failed",
        code: "project-source-unavailable",
        label: "source check failed",
        reason: "Source check failed: EACCES",
      },
      {
        hostId: "signed-out",
        name: "signed-out",
        code: "provider-not-signed-in",
        label: "Codex not signed in",
        reason: "Provider is not signed in.",
      },
      {
        hostId: "unknown",
        name: "unknown",
        code: "provider-readiness-unknown",
        label: "codex readiness unknown",
        reason: "timeout",
      },
    ]);
  });

  it("never places on stale, future, or unmeasured readings, however idle", () => {
    const placement = decidePlacement(
      [
        loaded("stale", 0, 8, { requestedAt: NOW - FRESHNESS_BOUND_MS - 1 }),
        loaded("future", 0, 8, { requestedAt: NOW + 1 }),
        machine("windows"),
      ],
      request(everywhere("stale", "future", "windows")),
      NOW,
    );
    expect(placement).toMatchObject({
      kind: "stay-on-server",
      skipped: [
        { hostId: "future", code: "load-unavailable" },
        { hostId: "stale", code: "load-unavailable" },
        { hostId: "windows", code: "load-unavailable", reason: "no load" },
      ],
    });
  });

  it("ignores unavailable machines without listing them as skipped", () => {
    expect(
      decidePlacement(
        [
          machine("offline", {
            availability: {
              kind: "unavailable",
              code: "disconnected",
              reason: "Machine is disconnected.",
            },
          }),
        ],
        request(everywhere("offline")),
        NOW,
      ),
    ).toEqual({
      kind: "stay-on-server",
      reason:
        "No connected machine is ready for this project and provider with a fresh load reading.",
      skipped: [],
    });
  });
});

describe("loadReading", () => {
  const measured: Measurement = {
    kind: "measured",
    requestedAt: NOW,
    measurement: {
      capacity: { availableParallelism: 8, totalMemoryBytes: 16 * 1024 ** 3 },
      oneMinuteLoad: { kind: "measured", value: 2 },
    },
  };

  it("reports fresh readings, unsupported load, and failed measurement", () => {
    expect(loadReading(measured)).toEqual({
      kind: "fresh",
      oneMinuteLoad: 2,
      availableParallelism: 8,
      requestedAt: NOW,
    });
    expect(
      loadReading({
        ...measured,
        measurement: {
          ...measured.measurement,
          oneMinuteLoad: { kind: "unsupported" },
        },
      }),
    ).toEqual({
      kind: "unavailable",
      reason: "This machine's operating system does not report load.",
    });
    expect(loadReading({ kind: "failed", reason: "worker crashed" })).toEqual({
      kind: "unavailable",
      reason: "worker crashed",
    });
  });
});

describe("hostAvailability", () => {
  it("names ephemeral, disconnected, protocol-mismatched, and inactive machines", () => {
    expect(
      hostAvailability(makeHostResponse({ type: "ephemeral" })),
    ).toMatchObject({ kind: "unavailable", code: "ephemeral-host" });
    expect(
      hostAvailability(makeHostResponse({ status: "disconnected" })),
    ).toMatchObject({ kind: "unavailable", code: "disconnected" });
    expect(
      hostAvailability(
        makeHostResponse({
          status: "disconnected",
          lastRejectedProtocolVersion: 3,
        }),
      ),
    ).toMatchObject({ kind: "unavailable", code: "protocol-mismatch" });
    const suspended = makeHostResponse().lifecycle;
    expect(
      hostAvailability(
        makeHostResponse({ lifecycle: { ...suspended, phase: "suspended" } }),
      ),
    ).toEqual({
      kind: "unavailable",
      code: "lifecycle-unavailable",
      reason: "Machine is suspended.",
    });
    expect(hostAvailability(makeHostResponse())).toEqual({
      kind: "available",
    });
  });
});
