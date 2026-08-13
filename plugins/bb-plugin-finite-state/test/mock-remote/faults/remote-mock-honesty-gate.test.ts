import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { AssuranceStudioClient } from "../../../lib/remote/assurance-studio/client.js";
import { responseError } from "../../../lib/remote/errors.js";
import { PlatformClient } from "../../../lib/remote/platform/client.js";
import { RemoteLimiter, type Scheduler } from "../../../lib/remote/rate-limit.js";
import { RemoteError } from "../../../lib/remote/types.js";
import { registerMockAssuranceStudio } from "../assurance-studio/register.js";
import type { AssuranceStudioState } from "../assurance-studio/state.js";
import { registerMockForgeCompute } from "../forge-compute/register.js";
import { registerMockPlatformFirmware, MOCK_PLATFORM_ADMIN_PERMISSION } from "../platform/firmware.js";
import { registerPlatformHandlers } from "../platform/register.js";
import { createMockPlatformState, type MockPlatformState } from "../platform/state.js";
import { createMockRemote, type MockRemoteHarness } from "../server.js";
import { createFaultController, type FaultControllerRuntime } from "./controller.js";
import { forgeFault, transportResetFetch, withFaultMiddleware } from "./middleware.js";
import {
  AS_COMPONENT_UPDATE_ROUTE,
  FORGE_CREATE_ROUTE,
  FORGE_PREPARE_ROUTE,
  PLATFORM_BULK_VEX_ROUTE,
  PLATFORM_FIRMWARE_BYTES_ROUTE,
  PLATFORM_FIRMWARE_RANGE_ROUTE,
  type ScenarioSpec,
} from "./scenarios.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures", import.meta.url));
const platformToken = "fault-platform-token";
const assuranceStudioKey = "fault-as-key";
const harnesses: MockRemoteHarness[] = [];

interface Setup {
  controller: FaultControllerRuntime;
  harness: MockRemoteHarness;
  platformState: MockPlatformState;
  assuranceStudioState: AssuranceStudioState;
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

function setup(specs: ScenarioSpec[]): Setup {
  const controller = createFaultController();
  for (const spec of specs) controller.install(spec);
  const platformState = createMockPlatformState(fixtureRoot);
  let assuranceStudioState: AssuranceStudioState | null = null;
  const harness = createMockRemote({
    platformToken,
    assuranceStudioKey,
    fixtureRoot,
    register(service, registry) {
      const faulted = withFaultMiddleware(service, registry, controller);
      if (service === "platform") {
        registerPlatformHandlers(faulted, platformState);
        registerMockPlatformFirmware(faulted, fixtureRoot);
      } else {
        assuranceStudioState = registerMockAssuranceStudio(faulted, fixtureRoot);
      }
    },
  });
  harnesses.push(harness);
  if (assuranceStudioState === null) throw new Error("Assurance Studio state was not registered");
  return { controller, harness, platformState, assuranceStudioState };
}

function scenarioFetch(
  fetch: typeof globalThis.fetch,
  scenario: string,
  requestId = "fault-request",
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set("X-FS-Mock-Scenario", scenario);
    headers.set("X-Request-ID", requestId);
    return fetch(new Request(request, { headers }));
  };
}

function authenticatedFetch(harness: MockRemoteHarness, service: "platform" | "assurance-studio") {
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (service === "platform") headers.set("X-Authorization", platformToken);
    else headers.set("X-API-Key", assuranceStudioKey);
    const base = service === "platform" ? "http://platform.mock" : "http://as.mock";
    return harness[service === "platform" ? "platform" : "assuranceStudio"].fetch(`${base}${path}`, {
      ...init,
      headers,
    });
  };
}

describe("remote-mock-honesty-gate", () => {
  it("returns the exact AS stale-TARA 409 before mutation", async () => {
    const result = setup([{
      name: "as-stale-tara-state",
      service: "assurance-studio",
      routeIds: [AS_COMPONENT_UPDATE_ROUTE],
    }]);
    const before = result.assuranceStudioState.snapshot();
    const fetch = authenticatedFetch(result.harness, "assurance-studio");
    const response = await fetch(
      "/api/projects/project-4a752600a07a/components/as-component-01",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-FS-Mock-Scenario": "as-stale-tara-state",
          "X-Request-ID": "stale-1",
        },
        body: JSON.stringify({ name: "must not persist", review_version: "9007199254740993" }),
      },
    );
    const frozen = readFileSync(new URL("../fixtures/faults/assurance-studio-stale-tara.json", import.meta.url), "utf8");
    expect(response.status).toBe(409);
    expect(await response.text()).toBe(frozen);
    expect(result.assuranceStudioState.snapshot()).toEqual(before);
    expect(result.controller.log()).toEqual([expect.objectContaining({
      service: "assurance-studio", requestId: "stale-1", effect: "stale-before-mutation",
    })]);
  });

  it("denies full and ranged firmware bytes while tree and metadata remain readable", async () => {
    const result = setup([{
      name: "platform-firmware-bytes-forbidden",
      service: "platform",
      routeIds: [PLATFORM_FIRMWARE_BYTES_ROUTE, PLATFORM_FIRMWARE_RANGE_ROUTE],
    }]);
    const fetch = authenticatedFetch(result.harness, "platform");
    const commonHeaders = {
      "X-Mock-Permissions": MOCK_PLATFORM_ADMIN_PERMISSION,
      "X-FS-Mock-Scenario": "platform-firmware-bytes-forbidden",
    };
    const tree = await fetch("/public/v0/projects/versions/pv-a481df87dadf/filesystem/tree?path=rootfs", {
      headers: commonHeaders,
    });
    const hash = "b16e06bd84484d737304616ed406cec442a7cd87af088f72f8580755e7585b5d";
    const metadata = await fetch(`/public/v0/projects/versions/pv-a481df87dadf/filesystem/overview?hash=${hash}`, {
      headers: commonHeaders,
    });
    expect(tree.status).toBe(200);
    expect(metadata.status).toBe(200);

    const asFetch = authenticatedFetch(result.harness, "assurance-studio");
    const asResponse = await asFetch(
      "/api/projects/project-4a752600a07a/components?page=1&limit=1",
      { headers: { "X-FS-Mock-Scenario": "platform-firmware-bytes-forbidden" } },
    );
    const asNormal = await asFetch(
      "/api/projects/project-4a752600a07a/components?page=1&limit=1",
    );
    expect(asResponse.status).toBe(200);
    expect(await asResponse.text()).toBe(await asNormal.text());

    const full = await fetch(`/public/v0/projects/versions/pv-a481df87dadf/filesystem/file?hash=${hash}`, {
      headers: commonHeaders,
    });
    const range = await fetch(
      `/public/v0/projects/versions/pv-a481df87dadf/filesystem/content?hash=${hash}&offset=0&maxBytes=16`,
      { headers: commonHeaders },
    );
    const frozen = readFileSync(
      new URL("../fixtures/faults/platform-firmware-forbidden.json", import.meta.url), "utf8",
    );
    expect(full.status).toBe(403);
    expect(await full.text()).toBe(frozen);
    expect(range.status).toBe(403);
    expect(await range.text()).toBe(frozen);
  });

  it("retries deterministic service-scoped 429s with an injected scheduler and exhausts independently", async () => {
    const route = "platform:GET:/public/v0/projects";
    const result = setup([
      {
        name: "rate-limit-then-success",
        service: "platform",
        routeIds: [route],
        times: 2,
        retryAfterSeconds: 3,
      },
      {
        name: "rate-limit-exhausted",
        service: "assurance-studio",
        routeIds: ["assurance-studio:GET:/api/projects/{projectId}/components"],
        times: 9,
        retryAfterSeconds: 4,
      },
    ]);
    const sleeps: number[] = [];
    const scheduler: Scheduler = {
      now: () => 0,
      sleep: async (ms) => { sleeps.push(ms); },
    };
    const limiter = new RemoteLimiter({
      concurrency: 1, maxAttempts: 3, maxBackoffMs: 60_000, scheduler, random: () => 0,
    });
    const platformFetch = authenticatedFetch(result.harness, "platform");
    const value = await limiter.run(async () => {
      const response = await platformFetch("/public/v0/projects", {
        headers: { "X-FS-Mock-Scenario": "rate-limit-then-success", "X-Request-ID": "platform-rate" },
      });
      if (!response.ok) throw await responseError("platform", response, scheduler.now());
      return response.status;
    }, undefined, "platform");
    expect(value).toBe(200);
    expect(sleeps).toEqual([3_000, 3_000]);

    const assuranceStudioFetch = authenticatedFetch(result.harness, "assurance-studio");
    await expect(limiter.run(async () => {
      const response = await assuranceStudioFetch(
        "/api/projects/project-4a752600a07a/components?page=1&limit=1",
        { headers: { "X-FS-Mock-Scenario": "rate-limit-exhausted", "X-Request-ID": "as-rate" } },
      );
      if (!response.ok) throw await responseError("assurance-studio", response, scheduler.now());
      return response;
    }, undefined, "assurance-studio")).rejects.toMatchObject({
      code: "REMOTE_RATE_LIMITED", status: 429, retryAfterMs: 4_000,
    });
    expect(result.controller.log().filter((entry) => entry.service === "platform")).toHaveLength(3);
    expect(result.controller.log().filter((entry) => entry.service === "assurance-studio")).toHaveLength(3);
    limiter.close();
  });

  it("normalizes malformed and negative Retry-After values to typed rate-limit errors", async () => {
    const malformed = await responseError("platform", new Response(null, {
      status: 429, headers: { "Retry-After": "not-a-delay" },
    }), 10_000);
    const negative = await responseError("assurance-studio", new Response(null, {
      status: 429, headers: { "Retry-After": "-1" },
    }), 10_000);
    expect(malformed).toBeInstanceOf(RemoteError);
    expect(malformed).toMatchObject({ code: "REMOTE_RATE_LIMITED", retryAfterMs: null });
    expect(negative).toBeInstanceOf(RemoteError);
    // Tripwire for mem_8fm66mk2pzm: V8 Date.parse currently turns "-1" into
    // a future date and production code sleeps this unbounded value. The
    // production owner must update this exact assertion with the parser fix.
    expect(negative).toMatchObject({ code: "REMOTE_RATE_LIMITED", retryAfterMs: 978_325_190_000 });
  });

  it("applies only successful VEX items and reports exact mixed counts", async () => {
    const base = createMockPlatformState(fixtureRoot);
    const findings = [...base.findings.values()].slice(10, 14);
    const failedId = String(findings[2]?.id);
    const result = setup([{
      name: "platform-vex-partial-failure",
      service: "platform",
      routeIds: [PLATFORM_BULK_VEX_ROUTE],
      findingIds: [failedId],
    }]);
    const client = new PlatformClient({
      baseUrl: "http://platform.mock",
      token: platformToken,
      fetch: scenarioFetch(result.harness.platform.fetch, "platform-vex-partial-failure", "partial-1"),
    });
    const projectVersionId = String(findings[0]?.projectVersionId);
    const ids = findings.map((finding) => String(finding.id));
    const before = ids.map((id) => result.platformState.vexTuple(projectVersionId, id));
    const response = await client.batchSetVexStatus({
      projectVersionId,
      findings: ids.map((findingId) => ({ findingId, status: "NOT_AFFECTED" })),
    });
    expect(response).toMatchObject({
      status: "partial_success", summary: { total: 4, succeeded: 3, failed: 1 },
    });
    expect(response.results.map((item) => item.success)).toEqual([true, true, false, true]);
    expect(ids.map((id) => result.platformState.vexTuple(projectVersionId, id)?.status)).toEqual([
      "NOT_AFFECTED", "NOT_AFFECTED", before[2]?.status, "NOT_AFFECTED",
    ]);
    client.close();
  });

  it("strips the reviewed AS unknown key so HTTP 200 does not prove persistence", async () => {
    const result = setup([{
      name: "as-key-strip",
      service: "assurance-studio",
      routeIds: [AS_COMPONENT_UPDATE_ROUTE],
      unknownKeys: ["unexpectedFixtureKey"],
    }]);
    const client = new AssuranceStudioClient({
      baseUrl: "http://as.mock",
      apiKey: assuranceStudioKey,
      fetch: scenarioFetch(result.harness.assuranceStudio.fetch, "as-key-strip", "strip-1"),
    });
    const updated = await client.updateEntity("component", {
      projectId: "project-4a752600a07a",
      id: "as-component-01",
      fields: {
        name: "persisted name",
        unexpectedFixtureKey: true,
        review_version: "9007199254740993",
      },
    });
    expect(updated.success).toBe(true);
    const readBack = await client.getEntity("component", {
      projectId: "project-4a752600a07a", id: "as-component-01",
    });
    expect(readBack.fields.name).toBe("persisted name");
    expect(readBack.fields.unexpectedFixtureKey).toBeUndefined();
    client.close();
  });

  it("preserves first N writes, converges one retry, and resets each distinct push id", async () => {
    const base = createMockPlatformState(fixtureRoot);
    const findings = [...base.findings.values()].slice(10, 14);
    const result = setup([{
      name: "mid-push-reset",
      service: "platform",
      routeIds: [PLATFORM_BULK_VEX_ROUTE],
      afterApplied: 2,
    }]);
    const faulted = scenarioFetch(result.harness.platform.fetch, "mid-push-reset", "push-1");
    const client = new PlatformClient({
      baseUrl: "http://platform.mock", token: platformToken, fetch: transportResetFetch(faulted),
    });
    const projectVersionId = String(findings[0]?.projectVersionId);
    const input = {
      projectVersionId,
      findings: findings.map((finding) => ({ findingId: String(finding.id), status: "RESOLVED" as const })),
    };
    const before = input.findings.map((finding) =>
      result.platformState.vexTuple(projectVersionId, finding.findingId)?.status,
    );
    await expect(client.batchSetVexStatus(input)).rejects.toMatchObject({ code: "REMOTE_WRITE_INDETERMINATE" });
    expect(input.findings.map((finding) =>
      result.platformState.vexTuple(projectVersionId, finding.findingId)?.status,
    )).toEqual(["RESOLVED", "RESOLVED", before[2], before[3]]);
    await expect(client.batchSetVexStatus(input)).resolves.toMatchObject({
      status: "success", summary: { total: 4, succeeded: 4, failed: 0 },
    });
    expect(input.findings.map((finding) =>
      result.platformState.vexTuple(projectVersionId, finding.findingId)?.status,
    )).toEqual(["RESOLVED", "RESOLVED", "RESOLVED", "RESOLVED"]);
    expect(result.controller.log().map((entry) => entry.effect)).toEqual([
      "transport-reset-after-2", "retry-converged",
    ]);

    const independentPush = new PlatformClient({
      baseUrl: "http://platform.mock",
      token: platformToken,
      fetch: transportResetFetch(scenarioFetch(
        result.harness.platform.fetch,
        "mid-push-reset",
        "push-2",
      )),
    });
    await expect(independentPush.batchSetVexStatus(input)).rejects.toMatchObject({
      code: "REMOTE_WRITE_INDETERMINATE",
    });
    expect(result.controller.log().map((entry) => entry.effect)).toEqual([
      "transport-reset-after-2", "retry-converged", "transport-reset-after-2",
    ]);
    independentPush.close();
    client.close();
  });

  it("makes in-process and socket-reset representations semantically equivalent", async () => {
    const result = setup([{
      name: "mid-push-reset", service: "platform", routeIds: [PLATFORM_BULK_VEX_ROUTE], afterApplied: 1,
    }]);
    const fetch = authenticatedFetch(result.harness, "platform");
    const finding = [...result.platformState.findings.values()][10];
    const response = await fetch(
      `/public/v0/findings/${String(finding?.projectVersionId)}/status/set/bulk`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json", "X-FS-Mock-Scenario": "mid-push-reset",
        },
        body: JSON.stringify({ findings: [{ findingId: finding?.id, status: "RESOLVED" }] }),
      },
    );
    expect(response.status).toBe(599);
    expect(response.headers.get("X-FS-Mock-Transport-Reset")).toBe("true");
    expect(result.platformState.vexTuple(String(finding?.projectVersionId), String(finding?.id))?.status).toBe("RESOLVED");
    // WP-14 owns literal socket destruction. The fetch adapter maps this sentinel to the
    // same post-apply TypeError a destroyed socket produces, without changing state semantics.
    await expect(transportResetFetch(async () => response)("http://mock.invalid")).rejects.toBeInstanceOf(TypeError);
  });

  it("isolates Forge absence and digest mismatch from healthy Platform and AS state", async () => {
    const result = setup([
      { name: "forge-compute-unavailable", service: "forge-compute", routeIds: [FORGE_CREATE_ROUTE] },
      { name: "forge-root-digest-mismatch", service: "forge-compute", routeIds: [FORGE_PREPARE_ROUTE] },
    ]);
    const platformBefore = result.platformState.snapshot();
    const assuranceStudioBefore = result.assuranceStudioState.snapshot();
    const compute = registerMockForgeCompute(fixtureRoot);
    expect(compute).not.toBeNull();
    expect(registerMockForgeCompute(fixtureRoot, { configured: false })).toBeNull();
    expect(forgeFault(result.controller, {
      scenario: "forge-compute-unavailable", requestId: "forge-1", routeId: FORGE_CREATE_ROUTE,
    })).toEqual({ unavailable: true });
    expect(forgeFault(result.controller, {
      scenario: "forge-root-digest-mismatch", requestId: "forge-2", routeId: FORGE_PREPARE_ROUTE,
    })).toEqual({ rootDigestMismatch: true });
    expect(result.platformState.snapshot()).toEqual(platformBefore);
    expect(result.assuranceStudioState.snapshot()).toEqual(assuranceStudioBefore);
    const platformFetch = authenticatedFetch(result.harness, "platform");
    const asFetch = authenticatedFetch(result.harness, "assurance-studio");
    expect((await platformFetch("/public/v0/projects")).status).toBe(200);
    expect((await asFetch("/api/projects/project-4a752600a07a/components?page=1&limit=1")).status).toBe(200);
  });

  it("reset clears service fault logs, counters, selections, and backing state", async () => {
    const result = setup([{
      name: "rate-limit-then-success",
      service: "platform",
      routeIds: ["platform:GET:/public/v0/projects"],
      times: 1,
    }]);
    const fetch = authenticatedFetch(result.harness, "platform");
    const faulted = await fetch("/public/v0/projects", {
      headers: { "X-FS-Mock-Scenario": "rate-limit-then-success" },
    });
    expect(faulted.status).toBe(429);
    expect(result.controller.log()).toHaveLength(1);
    const finding = [...result.platformState.findings.values()][10];
    finding!.vexStatus = "RESOLVED";
    await result.harness.reset("platform");
    expect(result.controller.log()).toEqual([]);
    expect(result.platformState.vexTuple(String(finding?.projectVersionId), String(finding?.id))?.status).toBeNull();
    const scenarioAfterReset = await fetch("/public/v0/projects", {
      headers: { "X-FS-Mock-Scenario": "rate-limit-then-success" },
    });
    expect(scenarioAfterReset.status).toBe(400);
  });
});
