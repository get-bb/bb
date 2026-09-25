import {
  createFakePluginHost,
  makeHostResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { machineLoadBalancerRpcContract } from "./contract.js";
import plugin from "./server.js";

const GIB = 1024 ** 3;

function providerState(
  providerId: string,
  displayName: string,
  status: "ready" | "unauthenticated",
) {
  return {
    providerId,
    displayName,
    status,
    statusMessage: null,
    accountEmail: null,
    planLabel: null,
    installedVersion: null,
    minimumSupportedVersion: null,
    canInstall: false,
    canUpdate: false,
    loginCommand: null,
  };
}

function running(
  id: string,
  hostId: string | null,
  overrides: { title?: string | null; status?: "starting" | "active"; model?: string | null } = {},
) {
  return {
    id,
    title: overrides.title ?? null,
    hostId,
    status: overrides.status ?? "active",
    providerId: "codex",
    model: overrides.model ?? null,
    runningSince: 1_000,
  };
}

async function setup(sourceProbe: "available" | "missing" | "failed" = "available") {
  const fake = createFakePluginHost({
    pluginId: "machine-load-balancer",
    experimental_hostEntry: true,
    sdk: {
      hosts: {
        list: async () => [
          makeHostResponse({ id: "server-host", name: "Server" }),
          makeHostResponse({ id: "worker", name: "Worker" }),
          makeHostResponse({ id: "laptop", name: "Laptop" }),
          makeHostResponse({ id: "broken", name: "Broken" }),
          makeHostResponse({
            id: "old",
            name: "Old",
            status: "disconnected",
            lastRejectedProtocolVersion: 2,
          }),
        ],
      },
      projects: {
        get: async ({ projectId }) => ({
          id: projectId,
          name: "App",
          sources: ["server-host", "worker", "laptop", "broken", "old"].map(
            (hostId) => ({ type: "local_path", hostId, path: "/src/app" }),
          ),
        }),
      },
      threads: {
        listRunning: async () => [
          running("thr_a", "worker", { title: "Build app", model: "gpt-5" }),
          running("thr_b", "worker", { status: "starting" }),
          running("thr_c", "old"),
          running("thr_pending", null, { status: "starting" }),
        ],
      },
      system: {
        config: async () => ({ primaryHostId: "server-host" }),
        providerStates: async (args) => ({
          providers: [
            providerState("codex", "Codex", args?.hostId === "laptop" ? "unauthenticated" : "ready"),
            providerState("pi", "Pi", "unauthenticated"),
          ],
        }),
      },
    },
    experimental_callHostRpc: ({ hostId, method }) => {
      if (method === "checkSource") {
        if (sourceProbe === "failed") throw new Error("source probe offline");
        return { kind: sourceProbe };
      }
      if (hostId === "broken") throw new Error("worker exited");
      return {
        capacity: {
          availableParallelism: hostId === "worker" ? 16 : 4,
          totalMemoryBytes: 32 * GIB,
        },
        oneMinuteLoad: {
          kind: "measured",
          value: hostId === "worker" ? 4 : 3,
        },
      };
    },
  });
  plugin(fake.bb);
  return fake;
}

async function inspect(
  harness: Awaited<ReturnType<typeof setup>>["harness"],
  input: unknown,
) {
  return machineLoadBalancerRpcContract.inspect.output.parse(
    await harness.behavior.callRpc("inspect", input),
  );
}

describe("machine inspection without filters", () => {
  it("returns every machine ranked with per-provider readiness and running threads, without probing sources", async () => {
    const { harness } = await setup();
    const overview = await inspect(harness, { kind: "all" });
    expect(overview.placement).toEqual({ kind: "not-requested" });
    expect(overview.nextPickHostId).toBe("worker");
    expect(overview.machines.map((machine) => machine.hostId)).toEqual([
      "worker",
      "server-host",
      "laptop",
      "broken",
      "old",
    ]);
    expect(overview).toMatchObject({
      pendingThreads: [{ id: "thr_pending", status: "starting", providerName: "Codex" }],
      machines: [
        {
          hostId: "worker",
          isServer: false,
          capacity: {
            kind: "known",
            capacity: { availableParallelism: 16, totalMemoryBytes: 32 * GIB },
          },
          load: { kind: "fresh", oneMinuteLoad: 4, availableParallelism: 16 },
          runningThreads: [
            {
              id: "thr_a",
              title: "Build app",
              status: "active",
              providerName: "Codex",
              model: "gpt-5",
              runningSince: 1_000,
            },
            { id: "thr_b", status: "starting" },
          ],
        },
        { hostId: "server-host", isServer: true },
        {
          hostId: "laptop",
          providers: {
            kind: "reported",
            providers: [
              {
                providerId: "codex",
                readiness: {
                  kind: "not-ready",
                  code: "provider-not-signed-in",
                  label: "not signed in",
                },
              },
              { providerId: "pi" },
            ],
          },
        },
        {
          hostId: "broken",
          availability: { kind: "available" },
          capacity: { kind: "unavailable" },
          load: { kind: "unavailable", reason: "Measurement failed: worker exited" },
        },
        {
          hostId: "old",
          availability: { kind: "unavailable", code: "protocol-mismatch" },
          providers: { kind: "unavailable" },
          runningThreads: [{ id: "thr_c" }],
        },
      ],
    });
    expect(
      harness.experimental_hostRpcCalls.map((call) => `${call.hostId}:${call.method}`).sort(),
    ).toEqual(["broken:measure", "laptop:measure", "server-host:measure", "worker:measure"]);
  });
});

describe("placement inspection", () => {
  it.each([
    ["missing", "no-project-source", "no source for App"],
    ["failed", "project-source-unavailable", "source check failed"],
  ] as const)("skips machines on a %s source observation", async (probe, code, label) => {
    const { harness } = await setup(probe);
    const overview = await inspect(harness, {
      kind: "placement",
      projectId: "prj_app",
      providerId: "codex",
    });
    expect(overview.placement).toMatchObject({
      kind: "stay-on-server",
      skipped: expect.arrayContaining([
        expect.objectContaining({ hostId: "worker", code, label }),
      ]),
    });
  });

  it("chooses the least-loaded ready machine over RPC and the placement hook", async () => {
    const { harness } = await setup();
    const overview = await inspect(harness, {
      kind: "placement",
      projectId: "prj_app",
      providerId: "codex",
    });
    expect(overview.placement).toMatchObject({
      kind: "chosen",
      machine: { hostId: "worker", name: "Worker" },
      reason: "Worker has the lowest load per processor (0.25).",
      skipped: [
        { hostId: "laptop", label: "Codex not signed in" },
        { hostId: "broken", label: "load unavailable" },
      ],
    });
    const place = harness.registrations.hooks["experimental_thread.place"];
    expect(place).not.toBeNull();
    const decision = await place!({
      projectId: "prj_app",
      providerId: "codex",
      signal: new AbortController().signal,
    });
    expect(decision).toMatchObject({
      kind: "choose",
      hostId: "worker",
      skipped: [
        { hostId: "laptop", reason: "Codex not signed in" },
        { hostId: "broken", reason: "load unavailable" },
      ],
    });
    expect(decision.kind === "choose" && Date.now() - decision.requestedAt).toBeLessThan(30_000);
    expect(
      await place!({
        projectId: "prj_app",
        providerId: "pi",
        signal: new AbortController().signal,
      }),
    ).toMatchObject({
      kind: "default",
      reason:
        "No connected machine is ready for this project and provider with a fresh load reading.",
      skipped: expect.any(Array),
    });
  });

  it("aborts an in-flight placement probe when the plugin unloads", async () => {
    let probeSignal: AbortSignal | undefined;
    const fake = createFakePluginHost({
      pluginId: "machine-load-balancer",
      experimental_hostEntry: true,
      sdk: {
        hosts: {
          list: async (args) => {
            const signal = args?.signal;
            probeSignal = signal;
            return new Promise((_, reject) => {
              signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
            });
          },
        },
        projects: {
          get: async ({ projectId }) => ({ id: projectId, kind: "standard", sources: [] }),
        },
        threads: { listRunning: async () => [] },
        system: {
          config: async () => ({ primaryHostId: "server-host" }),
          providerStates: async () => ({ providers: [] }),
        },
      },
    });
    plugin(fake.bb);
    const place = fake.harness.registrations.hooks["experimental_thread.place"];
    expect(place).not.toBeNull();
    const pending = place!({
      projectId: "prj_app",
      providerId: "codex",
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(probeSignal).toBeDefined());
    await fake.harness.lifecycle.dispose();
    expect(probeSignal?.aborted).toBe(true);
    await expect(pending).rejects.toBeDefined();
  });

  it("stops server measurement when an inspection request is cancelled", async () => {
    let probeSignal: AbortSignal | undefined;
    const fake = createFakePluginHost({
      pluginId: "machine-load-balancer",
      experimental_hostEntry: true,
      sdk: {
        hosts: { list: async () => [makeHostResponse({ id: "server-host", name: "Server" })] },
        projects: { get: async ({ projectId }) => ({ id: projectId, kind: "personal", sources: [] }) },
        threads: { listRunning: async () => [] },
        system: {
          config: async () => ({ primaryHostId: "server-host" }),
          providerStates: async () => ({ providers: [providerState("codex", "Codex", "ready")] }),
        },
      },
      experimental_callHostRpc: ({ method, signal }) => {
        expect(method).toBe("measure");
        probeSignal = signal;
        return new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });
    plugin(fake.bb);
    const request = new AbortController();
    const pending = fake.harness.behavior.callRpc("inspect", { kind: "all" }, { signal: request.signal });
    await vi.waitFor(() => expect(probeSignal).toBeDefined());
    request.abort();
    expect(probeSignal?.aborted).toBe(true);
    await expect(pending).rejects.toBeDefined();
    await fake.harness.lifecycle.dispose();
  });
});

describe("placement CLI", () => {
  it("shows every machine with no flags", async () => {
    const { harness } = await setup();
    const text = await harness.behavior.runCli(["inspect"]);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain(
      "Worker (next pick) [worker]: 16 CPU, 32 GB; load 0.25/CPU (1-min 4.00); Codex ready, Pi not signed in; running Build app [thr_a] (active, Codex gpt-5), thr_b [thr_b] (starting, Codex)",
    );
    expect(text.stdout).toContain("Server (server) [server-host]: 4 CPU, 32 GB");
    expect(text.stdout).toContain(
      "Old [old]: unavailable: Machine daemon speaks protocol 2, which this server rejected.",
    );
    expect(text.stdout).toContain("Pending placement: thr_pending [thr_pending] (starting, Codex)");
    expect(text.stdout).not.toContain("Placement:");
    expect(harness.experimental_hostRpcCalls.some((call) => call.method === "checkSource")).toBe(false);
  });

  it("adds the placement decision and skips when filtered by project and provider", async () => {
    const { harness } = await setup();
    const text = await harness.behavior.runCli([
      "inspect",
      "--project",
      "prj_app",
      "--provider",
      "codex",
    ]);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain(
      "Placement: Worker. Worker has the lowest load per processor (0.25).",
    );
    expect(text.stdout).toContain("Skipped Laptop: Codex not signed in");

    const json = await harness.behavior.runCli([
      "inspect",
      "--project",
      "prj_app",
      "--provider",
      "codex",
      "--json",
    ]);
    expect(JSON.parse(json.stdout).placement.machine.hostId).toBe("worker");
  });

  it("rejects a project filter without a provider", async () => {
    const { harness } = await setup();
    const result = await harness.behavior.runCli(["inspect", "--project", "prj_app"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/provider/u);
  });
});
