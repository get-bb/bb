import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createFakePluginHost, makeThreadResponse } from "@bb/plugin-sdk/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPluginContext } from "../../lib/context.js";
import type { PluginContext } from "../../lib/context.js";
import { AssuranceStudioClient } from "../../lib/remote/assurance-studio/client.js";
import { PlatformClient } from "../../lib/remote/platform/client.js";
import type { RemoteServices } from "../../lib/remote/types.js";
import { ENTITIES } from "../../lib/sync/registry.js";
import { createMockRemote, type MockRemoteHarness } from "../../test/mock-remote/server.js";
import { registerPlatformHandlers } from "../../test/mock-remote/platform/register.js";
import { createMockPlatformState, type MockPlatformState } from "../../test/mock-remote/platform/state.js";
import { createSerializer } from "./serialize/serializer.js";
import {
  DuplicateAdapterError,
  registerAdapter,
  type EntityAdapter,
  type ServerEntity,
  type WorkingEntity,
} from "./engine/adapter.js";
import { pull } from "./engine/pull.js";
import { status } from "./engine/status.js";
import { registerSync } from "./register.js";

const FIXTURE_ROOT = resolve(import.meta.dirname, "../../test/mock-remote/fixtures");
const TOKEN = "wp17-register-token";
const host = createFakePluginHost({ pluginId: "finite-state-wp17-register" });
let mock: MockRemoteHarness;
let state: MockPlatformState;
let platform: PlatformClient;
let root: string;
let context: PluginContext;

const requirementKey = ENTITIES.requirement.key({ reqId: "REQ-SEAM" });
let remoteRequirements: ServerEntity[] = [{
  key: requirementKey,
  remoteId: "as-requirement-seam",
  payload: {
    id: "as-requirement-seam",
    projectId: "project-seam",
    kind: "requirement",
    fields: { reqId: "REQ-SEAM", title: "base" },
    humanEdited: null,
    reviewStatus: null,
    reviewVersion: null,
  },
}];
let workingRequirements: WorkingEntity[] = [{
  key: requirementKey,
  payload: { reqId: "REQ-SEAM", title: "base" },
  file: "product-security/requirements/REQ-SEAM.yaml",
}];

const foreignAdapter: EntityAdapter = {
  kind: "requirement",
  klass: "VERSIONED",
  serializer: createSerializer("requirement"),
  async *fetchRemote(_scope, progress) {
    progress({ page: 1, of: 1 });
    yield remoteRequirements;
  },
  async readWorking() { return workingRequirements; },
};

beforeAll(async () => {
  state = createMockPlatformState(FIXTURE_ROOT);
  mock = createMockRemote({
    platformToken: TOKEN,
    assuranceStudioKey: "unused",
    fixtureRoot: FIXTURE_ROOT,
    register(service, registry) {
      if (service === "platform") registerPlatformHandlers(registry, state);
    },
  });
  platform = new PlatformClient({
    baseUrl: "http://platform.mock",
    token: TOKEN,
    fetch: mock.platform.fetch,
  });
  const services: RemoteServices = {
    platform,
    assuranceStudio: new AssuranceStudioClient({
      baseUrl: "http://assurance-studio.mock",
      apiKey: "unused",
      fetch: mock.assuranceStudio.fetch,
    }),
    forgeCompute: null,
  };
  context = createPluginContext(host.bb);
  context.service<RemoteServices>("remote-services", () => services);
  context.service("firmware.cli", () => ({
    run: async (argv: string[]) => ({
      exitCode: 0,
      stdout: `${JSON.stringify({ namespace: "firmware", argv })}\n`,
      stderr: "",
    }),
  }));
  registerSync(host.bb, context);
  registerAdapter(foreignAdapter);
  root = await mkdtemp(join(tmpdir(), "fs-wp17-register-"));
  host.harness.sdk.stub("threads.get", async () => makeThreadResponse({
    id: "thread-sync-cli",
    projectId: "bb-project-sync",
    environmentId: "environment-sync-cli",
  }));
  host.harness.sdk.stub("environments.get", async () => ({
    id: "environment-sync-cli",
    projectId: "bb-project-sync",
    path: root,
  }));
});

afterAll(async () => {
  platform.close();
  await mock.close();
  await host.harness.lifecycle.dispose();
  await rm(root, { recursive: true, force: true });
});

function platformScope() {
  const project = [...state.projects.values()][0];
  const finding = [...state.findings.values()].find((row) => row["vexStatus"] !== null);
  if (typeof project?.["id"] !== "string" || typeof finding?.["projectVersionId"] !== "string") {
    throw new Error("fixture has no platform scope");
  }
  return { projectId: project["id"], projectVersionId: finding["projectVersionId"] };
}

describe("sync registration", () => {
  it("round-trips a foreign registry adapter registered entirely from test code", async () => {
    const deps = {
      db: context.db(),
      worktreeRoot: root,
      isFileClean: async () => true,
      createGenerationId: () => "generation-seam-proof",
      now: () => new Date("2026-08-12T20:00:00.000Z"),
    };
    await expect(pull(deps, { projectId: "project-seam", projectVersionId: "version-seam" }, ["requirement"]))
      .resolves.toMatchObject({ kinds: { requirement: { fetched: 1, baseRows: 1 } } });
    workingRequirements = [{ ...workingRequirements[0]!, payload: { reqId: "REQ-SEAM", title: "local edit" } }];
    await expect(status(deps, { projectId: "project-seam", projectVersionId: "version-seam" }, ["requirement"]))
      .resolves.toMatchObject({
        local: [{ kind: "requirement", key: requirementKey, fields: ["title"] }],
        upstream: [],
        conflicts: [],
      });
  });

  it("throws on duplicate kind registration", () => {
    expect(() => registerAdapter(foreignAdapter)).toThrow(DuplicateAdapterError);
  });

  it("serves frozen sync RPCs and fails push closed when human authorization is unavailable", async () => {
    const scope = platformScope();
    const pulled = await host.harness.behavior.callRpc("syncPull", {
      ...scope,
      kinds: ["requirement", "vexDecision"],
    });
    expect(pulled).toMatchObject({
      ...scope,
      generationId: expect.any(String),
      baseStateSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      kinds: {
        requirement: { fetched: 1, baseRows: 1 },
        vexDecision: { fetched: expect.any(Number), baseRows: expect.any(Number) },
      },
    });
    if (
      typeof pulled !== "object"
      || pulled === null
      || !("generationId" in pulled)
      || typeof pulled.generationId !== "string"
    ) {
      throw new Error("syncPull returned no generation id");
    }
    const pulledGenerationId = pulled.generationId;
    const statusReport = await host.harness.behavior.callRpc("syncStatus", {
      ...scope,
    });
    // Frozen RPC inputs carry no thread or worktree capability, so working
    // local/orphan state is intentionally unavailable on this surface.
    expect(statusReport).toMatchObject({
      ...scope,
      local: [],
      upstream: [],
      conflicts: [],
      orphans: [],
      acceptedGenerationIds: {
        requirement: pulledGenerationId,
        vexDecision: pulledGenerationId,
      },
      cache: { acceptedGenerationId: pulledGenerationId },
    });
    await expect(host.harness.behavior.callRpc("syncPlan", scope)).resolves.toMatchObject({
      ...scope,
      planId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/u),
      planSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      baseGenerationIds: {
        requirement: pulledGenerationId,
        vexDecision: pulledGenerationId,
      },
      items: expect.any(Array),
      total: expect.any(Number),
      staleness: { degraded: true },
      cache: {
        state: "stale",
        message: "Working tree unavailable; plan includes upstream changes only",
        acceptedGenerationId: pulledGenerationId,
      },
    });
    const pushInput = {
      ...scope,
      planId: "plan-wp17",
      expectedPlanSha256: "a".repeat(64),
      expectedBaseStateSha256: "b".repeat(64),
      humanApprovalCapability: "approval-capability-wp17-00000000",
    };
    await expect(host.harness.behavior.callRpc("syncPush", pushInput)).rejects.toMatchObject({
      code: "handler_error",
      message: expect.stringContaining("authorization-unavailable"),
    });
    await expect(host.harness.behavior.callRpc("syncPushRetry", {
      ...pushInput,
      runId: "push-run-wp19",
    })).rejects.toMatchObject({
      code: "handler_error",
      message: expect.stringContaining("authorization-unavailable"),
    });
    expect(host.harness.registrations.rpcMethods).toEqual(expect.arrayContaining([
      "syncPull",
      "syncStatus",
      "syncPlan",
      "syncConflictResolve",
      "syncPush",
      "syncPushRetry",
    ]));
  });

  it("partitions direct-Platform local, upstream, and both-side VEX edits exactly", async () => {
    const scope = platformScope();
    const deps = {
      db: context.db(),
      worktreeRoot: root,
      isFileClean: async () => false,
    };
    await pull(deps, scope, ["vexDecision"]);
    const findings = [...state.findings.values()].filter((row) =>
      row["projectVersionId"] === scope.projectVersionId
      && typeof row["vexStatus"] === "string"
      && typeof row["componentPurl"] === "string",
    ).slice(0, 3);
    if (findings.length !== 3) throw new Error("fixture has fewer than three VEX findings");
    const directory = join(root, ".fs", "triage", scope.projectId);
    await mkdir(directory, { recursive: true });
    for (const [index, row] of findings.entries()) {
      const purl = String(row["componentPurl"]);
      const tail = purl.slice(purl.lastIndexOf("/") + 1);
      const at = tail.lastIndexOf("@");
      const name = decodeURIComponent(at < 0 ? tail : tail.slice(0, at));
      const version = at < 0 ? null : decodeURIComponent(tail.slice(at + 1));
      const localStatus = index === 0 ? "NOT_AFFECTED" : index === 2 ? "FALSE_POSITIVE" : row["vexStatus"];
      const localReason = index === 0 || index === 2 ? `local edit ${index}` : null;
      await writeFile(join(directory, `${index}.yaml`), `schema: fs-triage/v1
project: ${JSON.stringify(scope.projectId)}
component:
  purl: ${JSON.stringify(purl)}
  name: ${JSON.stringify(name)}
  group: null
  version: ${JSON.stringify(version)}
decisions:
  ${String(row["cve"])}:
    status: ${JSON.stringify(localStatus)}
    justification: null
    response: null
    reason: ${JSON.stringify(localReason)}
`, "utf8");
    }
    findings[1]!["vexStatus"] = "RESOLVED";
    findings[1]!["vexReason"] = "upstream edit";
    findings[2]!["vexStatus"] = "EXPLOITABLE";
    findings[2]!["vexReason"] = "upstream conflict";

    const report = await status(deps, scope, ["vexDecision"]);
    expect(report.local).toHaveLength(1);
    expect(report.upstream).toHaveLength(1);
    expect(report.conflicts).toHaveLength(1);
    expect(report.orphans).toEqual([]);
    expect(Object.keys(report)).toEqual(["local", "upstream", "conflicts", "orphans"]);
  });

  it("runs the verb-first triage CLI with the documented leading command tolerance", async () => {
    await rm(join(root, ".fs"), { recursive: true, force: true });
    const result = await host.harness.behavior.runCli(
      ["finite-state", "pull", "triage"],
      {
        cwd: "/untrusted-cwd-must-not-be-used",
        threadId: "thread-sync-cli",
        projectId: "bb-project-sync",
      },
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      kinds: { vexDecision: { fetched: expect.any(Number), baseRows: expect.any(Number) } },
    });
    const machine = await host.harness.behavior.runCli(
      ["status", "triage", "--json"],
      {
        cwd: "/untrusted-cwd-must-not-be-used",
        threadId: "thread-sync-cli",
        projectId: "bb-project-sync",
      },
    );
    expect(machine).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(machine.stdout)).toMatchObject({ local: [], conflicts: [], orphans: [] });
    expect(host.harness.realtimeSignals.some((signal) => signal.channel === "fs-sync-pull")).toBe(true);
    expect(host.harness.sdk.callsTo("threads.get")).toHaveLength(2);
    expect(host.harness.sdk.callsTo("environments.get")).toHaveLength(2);
  });

  it("delegates the firmware namespace without changing sync verb parsing", async () => {
    const result = await host.harness.behavior.runCli(
      ["finite-state", "firmware", "status", "pv-1", "--json"],
      { threadId: "thread-sync-cli", projectId: "bb-project-sync" },
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout: `${JSON.stringify({
        namespace: "firmware",
        argv: ["status", "pv-1", "--json"],
      })}\n`,
      stderr: "",
    });
  });

  it("refuses CLI working-tree access without a bb thread identity", async () => {
    const result = await host.harness.behavior.runCli(["status", "triage", "--json"], {
      cwd: root,
    });
    expect(result).toMatchObject({
      exitCode: 1,
      stdout: "",
      stderr: expect.stringContaining("SYNC_EXECUTION_CONTEXT_REQUIRED"),
    });
  });
});
