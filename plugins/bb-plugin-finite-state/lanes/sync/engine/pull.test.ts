import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { PlatformClient } from "../../../lib/remote/platform/client.js";
import {
  RemoteLimiter,
  type Scheduler,
} from "../../../lib/remote/rate-limit.js";
import { RemoteError, type Json } from "../../../lib/remote/types.js";
import { ENTITIES } from "../../../lib/sync/registry.js";
import { createSerializer } from "../serialize/serializer.js";
import { BaseSnapshotStore } from "../store/base-snapshot.js";
import {
  createMockRemote,
  type MockRemoteHarness,
} from "../../../test/mock-remote/server.js";
import {
  createFaultController,
  type FaultControllerRuntime,
} from "../../../test/mock-remote/faults/controller.js";
import { withFaultMiddleware } from "../../../test/mock-remote/faults/middleware.js";
import { PLATFORM_FINDINGS_ROUTE } from "../../../test/mock-remote/faults/scenarios.js";
import { registerPlatformHandlers } from "../../../test/mock-remote/platform/register.js";
import {
  createMockPlatformState,
  type MockPlatformState,
} from "../../../test/mock-remote/platform/state.js";
import {
  createVexDecisionAdapter,
  createVexDecisionResolver,
  fastForwardVexWorking,
  projectVexDecision,
  projectVexDecisionKey,
  readVexWorking,
} from "../entities/vex-decision.js";
import type { EntityAdapter, ServerEntity, WorkingEntity } from "./adapter.js";
import {
  PullFailedError,
  pull,
  type EngineDeps,
  type PullProgress,
} from "./pull.js";
import { status } from "./status.js";

const FIXTURE_ROOT = new URL(
  "../../../test/mock-remote/fixtures/",
  import.meta.url,
).pathname;
const TOKEN = "wp17-platform-token";
const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const harnesses: MockRemoteHarness[] = [];
const clients: PlatformClient[] = [];
const roots: string[] = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

interface PlatformFixture {
  state: MockPlatformState;
  controller: FaultControllerRuntime;
  harness: MockRemoteHarness;
  client: PlatformClient;
  scope: { projectId: string; projectVersionId: string };
}

function setupPlatform(
  options: {
    fault?: boolean;
    fetch?: (base: typeof globalThis.fetch) => typeof globalThis.fetch;
    limiter?: RemoteLimiter;
  } = {},
): PlatformFixture {
  const state = createMockPlatformState(FIXTURE_ROOT);
  const controller = createFaultController();
  if (options.fault) {
    controller.install({
      name: "rate-limit-then-success",
      service: "platform",
      routeIds: [PLATFORM_FINDINGS_ROUTE],
      times: 1,
      retryAfterSeconds: 0,
    });
  }
  const harness = createMockRemote({
    platformToken: TOKEN,
    assuranceStudioKey: "unused",
    fixtureRoot: FIXTURE_ROOT,
    register(service, registry) {
      if (service === "platform") {
        registerPlatformHandlers(
          withFaultMiddleware("platform", registry, controller),
          state,
        );
      }
    },
  });
  harnesses.push(harness);
  const fetch =
    options.fetch?.(harness.platform.fetch) ?? harness.platform.fetch;
  const client = new PlatformClient({
    baseUrl: "http://platform.mock",
    token: TOKEN,
    fetch,
    ...(options.limiter === undefined ? {} : { limiter: options.limiter }),
  });
  clients.push(client);
  const project = [...state.projects.values()][0];
  const finding = [...state.findings.values()].find(
    (row) => row["vexStatus"] !== null,
  );
  if (
    typeof project?.["id"] !== "string" ||
    typeof finding?.["projectVersionId"] !== "string"
  ) {
    throw new Error("fixture has no project or VEX finding");
  }
  return {
    state,
    controller,
    harness,
    client,
    scope: {
      projectId: project["id"],
      projectVersionId: finding["projectVersionId"],
    },
  };
}

function engine(
  adapter: EntityAdapter,
  extras: Partial<EngineDeps> = {},
): EngineDeps {
  const host = createFakePluginHost({
    pluginId: `finite-state-pull-${hosts.length}`,
  });
  hosts.push(host);
  return {
    db: createPluginContext(host.bb).db(),
    adapters: [adapter],
    worktreeRoot: null,
    createGenerationId: () => `generation-${hosts.length}`,
    now: () => new Date("2026-08-12T19:00:00.000Z"),
    ...extras,
  };
}

function expectedVexRows(
  state: MockPlatformState,
  projectVersionId: string,
): ServerEntity[] {
  const rows = new Map<string, ServerEntity>();
  for (const value of state.findings.values()) {
    if (value["projectVersionId"] !== projectVersionId) continue;
    const projected = projectVexDecision(value as Record<string, Json>);
    if (projected !== null) rows.set(projected.key, projected);
  }
  return [...rows.values()];
}

describe("sync pull", () => {
  it("populates accepted base rows from the direct Platform fixtures and publishes tiny progress hints", async () => {
    const fixture = setupPlatform();
    const progress: PullProgress[] = [];
    const deps = engine(createVexDecisionAdapter(fixture.client), {
      publish: (_channel, hint) => progress.push(hint),
    });

    const report = await pull(deps, fixture.scope, ["vexDecision"]);
    const expected = expectedVexRows(
      fixture.state,
      fixture.scope.projectVersionId,
    );
    const accepted = new BaseSnapshotStore(deps.db).listAccepted(
      fixture.scope.projectId,
      fixture.scope.projectVersionId,
      "vexDecision",
    );
    expect(report.kinds.vexDecision).toEqual({
      fetched: expected.length,
      baseRows: expected.length,
    });
    expect(accepted).toHaveLength(expected.length);
    expect(accepted.map((row) => row.entityKey)).toEqual(
      expected.map((row) => row.key).sort(),
    );
    expect(progress.some((hint) => hint.phase === "fetch")).toBe(true);
    expect(progress.some((hint) => hint.phase === "write")).toBe(true);
    expect(progress.at(-1)).toMatchObject({
      kind: "vexDecision",
      phase: "done",
    });
    expect(Object.keys(progress[0] ?? {}).sort()).toEqual([
      "generationId",
      "kind",
      "of",
      "page",
      "phase",
      "scope",
    ]);
  });

  it("backs off after a route-scoped 429 and fully drains the production client stream", async () => {
    const sleeps: number[] = [];
    const scheduler: Scheduler = {
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    };
    const limiter = new RemoteLimiter({
      concurrency: 1,
      maxAttempts: 3,
      maxBackoffMs: 60_000,
      scheduler,
      random: () => 0,
    });
    const fixture = setupPlatform({ fault: true, limiter });
    const deps = engine(createVexDecisionAdapter(fixture.client));

    await expect(
      pull(deps, fixture.scope, ["vexDecision"]),
    ).resolves.toMatchObject({
      kinds: {
        vexDecision: {
          fetched: expectedVexRows(
            fixture.state,
            fixture.scope.projectVersionId,
          ).length,
        },
      },
    });
    expect(sleeps).toEqual([0]);
    const effects = fixture.controller.log().map((entry) => entry.effect);
    expect(effects[0]).toBe("rate-limited");
    expect(
      effects
        .slice(1)
        .every((effect) => effect === "succeeded-after-rate-limit"),
    ).toBe(true);
  });

  it("resolves exact overlay keys against findings that have no server VEX tuple", async () => {
    const fixture = setupPlatform();
    const undecided = [...fixture.state.findings.values()].find(
      (row) =>
        row["projectVersionId"] === fixture.scope.projectVersionId &&
        row["vexStatus"] === null &&
        row["vexJustification"] === undefined &&
        row["vexResponse"] === undefined &&
        row["vexReason"] === undefined,
    );
    if (undecided === undefined)
      throw new Error("fixture has no undecided finding");
    const key = projectVexDecisionKey(undecided as Record<string, Json>);
    const resolver = createVexDecisionResolver(fixture.client);
    await expect(resolver(key, fixture.scope)).resolves.toEqual({
      resolved: true,
      detail: { match: "exact" },
    });
    await expect(
      resolver("fs1.ZmluZGluZw.bWlzc2luZw", fixture.scope),
    ).resolves.toEqual({ resolved: false });
  });

  it("keeps whole staged pages after a connection reset and resumes without replaying inserts", async () => {
    let reset = false;
    let failedOffsetAttempts = 0;
    const limiter = new RemoteLimiter({
      concurrency: 1,
      maxAttempts: 1,
      maxBackoffMs: 1,
      scheduler: { now: () => 0, sleep: async () => undefined },
      random: () => 0,
    });
    const fixture = setupPlatform({
      limiter,
      fetch: (base) => async (input, init) => {
        const request = new Request(input, init);
        if (
          reset &&
          new URL(request.url).searchParams.get("offset") === "1000"
        ) {
          failedOffsetAttempts += 1;
          throw new TypeError("mock mid-pull connection reset");
        }
        return base(request);
      },
    });
    let generation = 0;
    const deps = engine(createVexDecisionAdapter(fixture.client), {
      createGenerationId: () => `generation-reset-${++generation}`,
    });

    const first = await pull(deps, fixture.scope, ["vexDecision"]);
    const acceptedBefore = new BaseSnapshotStore(deps.db).listAccepted(
      fixture.scope.projectId,
      fixture.scope.projectVersionId,
      "vexDecision",
    );
    reset = true;

    await expect(
      pull(deps, fixture.scope, ["vexDecision"]),
    ).rejects.toBeInstanceOf(PullFailedError);
    expect(failedOffsetAttempts).toBe(1);
    const staging = deps.db
      .prepare(
        `SELECT staged_pages, staged_rows, accepted_generation_id, staging_generation_id
         FROM sync_state WHERE entity_kind = 'vexDecision'`,
      )
      .get() as {
      staged_pages: number;
      staged_rows: number;
      accepted_generation_id: string | null;
      staging_generation_id: string;
    };
    expect(staging).toMatchObject({
      staged_pages: 1,
      accepted_generation_id: first.generationId,
    });
    expect(staging.staged_rows).toBeGreaterThan(0);
    const stagedCount = deps.db
      .prepare("SELECT COUNT(*) FROM base_snapshot WHERE generation_id = ?")
      .pluck()
      .get(staging.staging_generation_id);
    expect(stagedCount).toBe(staging.staged_rows);
    expect(
      new BaseSnapshotStore(deps.db).listAccepted(
        fixture.scope.projectId,
        fixture.scope.projectVersionId,
        "vexDecision",
      ),
    ).toEqual(acceptedBefore);

    reset = false;
    await expect(
      pull(deps, fixture.scope, ["vexDecision"]),
    ).resolves.toMatchObject({
      generationId: staging.staging_generation_id,
      kinds: {
        vexDecision: {
          baseRows: expectedVexRows(
            fixture.state,
            fixture.scope.projectVersionId,
          ).length,
        },
      },
    });
    expect(
      new BaseSnapshotStore(deps.db).listAccepted(
        fixture.scope.projectId,
        fixture.scope.projectVersionId,
        "vexDecision",
      ),
    ).toHaveLength(
      expectedVexRows(fixture.state, fixture.scope.projectVersionId).length,
    );
    expect(
      deps.db
        .prepare(
          "SELECT base_revision FROM sync_state WHERE entity_kind = 'vexDecision'",
        )
        .pluck()
        .get(),
    ).toBe(2);
  });

  it("leaves a dirty authored file alone and reports its stable key as divergent", async () => {
    const server = {
      key: ENTITIES.requirement.key({ reqId: "REQ-DIRTY" }),
      remoteId: "requirement-dirty",
      payload: {
        id: "requirement-dirty",
        projectId: "project",
        kind: "requirement",
        fields: { reqId: "REQ-DIRTY", title: "unchanged" },
        humanEdited: null,
        reviewStatus: null,
        reviewVersion: null,
      },
    } satisfies ServerEntity;
    const working = [
      {
        key: server.key,
        payload: { reqId: "REQ-DIRTY", title: "unchanged" },
        file: "product-security/requirements/REQ-DIRTY.yaml",
      },
    ] satisfies WorkingEntity[];
    const before = structuredClone(working);
    const adapter: EntityAdapter = {
      kind: "requirement",
      klass: "VERSIONED",
      serializer: createSerializer("requirement"),
      async *fetchRemote(_scope, progress) {
        progress({ page: 1, of: 1 });
        yield [server];
      },
      async readWorking() {
        return working;
      },
    };
    const deps = engine(adapter, {
      worktreeRoot: "/worktree",
      isFileClean: async () => false,
    });
    const report = await pull(
      deps,
      { projectId: "project", projectVersionId: "version" },
      ["requirement"],
    );
    expect(report.workingFastForwarded).toBe(false);
    expect(report.divergence).toEqual([`requirement/${server.key}`]);
    expect(working).toEqual(before);
  });

  it("fast-forwards only sync.base in a git-clean VEX file after publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs-wp17-fast-forward-"));
    roots.push(root);
    await mkdir(join(root, ".fs", "triage", "project"), { recursive: true });
    const file = join(root, ".fs", "triage", "project", "component.yaml");
    await writeFile(
      file,
      `schema: fs-triage/v1
project: project
component:
  purl: pkg:generic/component@1
  name: component
  version: "1"
decisions:
  CVE-2026-99:
    status: NOT_AFFECTED
    justification: CODE_NOT_PRESENT
    response: null
    reason: local evidence
    sync:
      base: {status: null, justification: null, response: null, reason: null}
      pushed_at: null
`,
      "utf8",
    );
    const key = ENTITIES.vexDecision.key({
      cve: "CVE-2026-99",
      purl: "pkg:generic/component@1",
      name: "component",
      version: "1",
    });
    const server = {
      key,
      remoteId: "finding-fast-forward",
      payload: {
        status: "IN_TRIAGE",
        justification: null,
        response: null,
        reason: "server",
      },
    } satisfies ServerEntity;
    const adapter: EntityAdapter = {
      kind: "vexDecision",
      klass: "OVERLAY",
      serializer: createSerializer("vexDecision"),
      async *fetchRemote(_scope, progress) {
        progress({ page: 1, of: 1 });
        yield [server];
      },
      readWorking: readVexWorking,
    };
    const deps = engine(adapter, {
      worktreeRoot: root,
      isFileClean: async () => true,
      fastForwardWorking: ({ worktreeRoot, files, baseRows }) =>
        fastForwardVexWorking(worktreeRoot, files, baseRows),
    });

    await expect(
      pull(deps, { projectId: "project", projectVersionId: "version" }, [
        "vexDecision",
      ]),
    ).resolves.toMatchObject({ workingFastForwarded: true, divergence: [] });
    const written = await readFile(file, "utf8");
    expect(written).toContain("status: NOT_AFFECTED");
    expect(written).toContain("reason: local evidence");
    expect(written).toContain("status: IN_TRIAGE");
    expect(written).toContain("reason: server");
  });

  it("retains only the current accepted base rows across repeated pulls", async () => {
    const key = ENTITIES.requirement.key({ reqId: "REQ-RETENTION" });
    let title = "revision-0";
    const adapter: EntityAdapter = {
      kind: "requirement",
      klass: "VERSIONED",
      serializer: createSerializer("requirement"),
      async *fetchRemote(scope, progress) {
        progress({ page: 1, of: 1 });
        yield [
          {
            key,
            remoteId: "remote-retention",
            payload: {
              id: "remote-retention",
              projectId: scope.projectId,
              kind: "requirement",
              fields: { reqId: "REQ-RETENTION", title },
              humanEdited: null,
              reviewStatus: null,
              reviewVersion: null,
            },
          },
        ];
      },
      async readWorking() {
        return [];
      },
    };
    let generation = 0;
    const deps = engine(adapter, {
      createGenerationId: () => `generation-retention-${++generation}`,
    });
    const selectedScope = {
      projectId: "project-retention",
      projectVersionId: "version-retention",
    };
    for (let revision = 1; revision <= 4; revision += 1) {
      title = `revision-${revision}`;
      await pull(deps, selectedScope, ["requirement"]);
    }
    expect(
      deps.db
        .prepare(
          "SELECT COUNT(*) FROM base_snapshot WHERE project_id = ? AND project_version_id = ?",
        )
        .pluck()
        .get(selectedScope.projectId, selectedScope.projectVersionId),
    ).toBe(1);
    expect(
      deps.db
        .prepare(
          "SELECT generation_id FROM base_snapshot WHERE project_id = ? AND project_version_id = ?",
        )
        .pluck()
        .get(selectedScope.projectId, selectedScope.projectVersionId),
    ).toBe("generation-retention-4");
    expect(
      deps.db
        .prepare(
          "SELECT status, COUNT(*) AS count FROM pull_generation GROUP BY status ORDER BY status",
        )
        .all(),
    ).toEqual([
      { status: "accepted", count: 1 },
      { status: "superseded", count: 3 },
    ]);
  });

  it("deletes a stranded staging base without touching local build evidence", async () => {
    const requirementKey = ENTITIES.requirement.key({ reqId: "REQ-STRANDED" });
    const threatKey = ENTITIES.threat.key({ slug: "THREAT-STRANDED" });
    let resetAfterPage = true;
    const requirement: EntityAdapter = {
      kind: "requirement",
      klass: "VERSIONED",
      serializer: createSerializer("requirement"),
      async *fetchRemote(scope, progress) {
        progress({ page: 1, of: 1 });
        yield [
          {
            key: requirementKey,
            remoteId: "remote-requirement-stranded",
            payload: {
              id: "remote-requirement-stranded",
              projectId: scope.projectId,
              kind: "requirement",
              fields: { reqId: "REQ-STRANDED", title: "Requirement" },
              humanEdited: null,
              reviewStatus: null,
              reviewVersion: null,
            },
          },
        ];
        if (resetAfterPage) throw new TypeError("mock reset after whole page");
      },
      async readWorking() {
        return [];
      },
    };
    const threat: EntityAdapter = {
      kind: "threat",
      klass: "VERSIONED",
      serializer: createSerializer("threat"),
      async *fetchRemote(scope, progress) {
        progress({ page: 1, of: 1 });
        yield [
          {
            key: threatKey,
            remoteId: "remote-threat-stranded",
            payload: {
              id: "remote-threat-stranded",
              projectId: scope.projectId,
              kind: "threat",
              fields: { slug: "THREAT-STRANDED", title: "Threat" },
              humanEdited: null,
              reviewStatus: null,
              reviewVersion: null,
            },
          },
        ];
      },
      async readWorking() {
        return [];
      },
    };
    let generation = 0;
    const deps = engine(requirement, {
      adapters: [requirement, threat],
      createGenerationId: () => `generation-stranded-${++generation}`,
    });
    const selectedScope = {
      projectId: "project-stranded",
      projectVersionId: "version-stranded",
    };
    deps.db
      .prepare(
        `INSERT INTO build_run
         (project_id, project_version_id, run_id, kind, target, toolchain,
          status, artifact, digest, log_path, started_at)
       VALUES (?, ?, 'build-local-evidence', 'build', 'firmware', 'cmake',
               'completed', '/artifacts/firmware.bin', ?, '/logs/build.log', ?)`,
      )
      .run(
        selectedScope.projectId,
        selectedScope.projectVersionId,
        "a".repeat(64),
        "2026-08-12T19:00:00.000Z",
      );
    await expect(
      pull(deps, selectedScope, ["requirement"]),
    ).rejects.toBeInstanceOf(PullFailedError);
    expect(
      deps.db
        .prepare(
          "SELECT COUNT(*) FROM base_snapshot WHERE generation_id = 'generation-stranded-1'",
        )
        .pluck()
        .get(),
    ).toBe(1);

    resetAfterPage = false;
    await expect(
      pull(deps, selectedScope, ["requirement", "threat"]),
    ).resolves.toMatchObject({ generationId: "generation-stranded-2" });
    expect(
      deps.db
        .prepare(
          "SELECT COUNT(*) FROM base_snapshot WHERE generation_id = 'generation-stranded-1'",
        )
        .pluck()
        .get(),
    ).toBe(0);
    expect(
      deps.db
        .prepare(
          "SELECT generation_id, COUNT(*) AS count FROM base_snapshot GROUP BY generation_id",
        )
        .all(),
    ).toEqual([{ generation_id: "generation-stranded-2", count: 2 }]);
    expect(
      deps.db
        .prepare(
          "SELECT status FROM pull_generation WHERE generation_id = 'generation-stranded-1'",
        )
        .pluck()
        .get(),
    ).toBe("superseded");
    await expect(pull(deps, selectedScope, ["buildRun"])).rejects.toThrow(
      "No puller is registered for buildRun",
    );
    // FS-144: CACHED is not a reset allowlist; local run evidence survives generation cleanup.
    expect(
      deps.db
        .prepare(
          `SELECT run_id, status, artifact, digest, log_path
         FROM build_run WHERE project_id = ? AND project_version_id = ?`,
        )
        .get(selectedScope.projectId, selectedScope.projectVersionId),
    ).toEqual({
      run_id: "build-local-evidence",
      status: "completed",
      artifact: "/artifacts/firmware.bin",
      digest: "a".repeat(64),
      log_path: "/logs/build.log",
    });
  });

  it("keeps same keys and remote ids isolated across project, version, and project-level scopes", async () => {
    const key = ENTITIES.requirement.key({ reqId: "REQ-SCOPED" });
    const adapter: EntityAdapter = {
      kind: "requirement",
      klass: "VERSIONED",
      serializer: createSerializer("requirement"),
      async *fetchRemote(scope, progress) {
        progress({ page: 1, of: 1 });
        yield [
          {
            key,
            remoteId: "remote-shared",
            payload: {
              id: "remote-shared",
              projectId: scope.projectId,
              kind: "requirement",
              fields: { reqId: "REQ-SCOPED", title: "same" },
              humanEdited: null,
              reviewStatus: null,
              reviewVersion: null,
            },
          },
        ];
      },
      async readWorking() {
        return [];
      },
    };
    const deps = engine(adapter, {
      createGenerationId: () => "generation-shared",
    });
    const scopes = [
      { projectId: "project-a", projectVersionId: "version-a" },
      { projectId: "project-a", projectVersionId: "version-b" },
      { projectId: "project-b", projectVersionId: "version-a" },
      { projectId: "project-a", projectVersionId: null },
    ];
    for (const selectedScope of scopes) {
      await pull(deps, selectedScope, ["requirement"]);
    }
    expect(
      deps.db
        .prepare(
          "SELECT project_id, project_version_id, entity_key, remote_id FROM id_map ORDER BY project_id, project_version_id",
        )
        .all(),
    ).toEqual([
      {
        project_id: "project-a",
        project_version_id: "@project",
        entity_key: key,
        remote_id: "remote-shared",
      },
      {
        project_id: "project-a",
        project_version_id: "version-a",
        entity_key: key,
        remote_id: "remote-shared",
      },
      {
        project_id: "project-a",
        project_version_id: "version-b",
        entity_key: key,
        remote_id: "remote-shared",
      },
      {
        project_id: "project-b",
        project_version_id: "version-a",
        entity_key: key,
        remote_id: "remote-shared",
      },
    ]);
    await expect(status(deps, scopes[3]!, ["requirement"])).resolves.toEqual({
      local: [],
      upstream: [],
      conflicts: [],
      orphans: [],
    });
  });

  it("reports one remote id claimed by two stable keys as data instead of leaking SqliteError", async () => {
    const adapter: EntityAdapter = {
      kind: "vexDecision",
      klass: "OVERLAY",
      serializer: createSerializer("vexDecision"),
      async *fetchRemote(_scope, progress) {
        progress({ page: 1, of: 1 });
        yield ["CVE-2026-701", "CVE-2026-702"].map((cve) => ({
          key: ENTITIES.vexDecision.key({
            cve,
            purl: `pkg:generic/collision@${cve}`,
            name: "collision",
            version: cve,
          }),
          remoteId: "remote-id-collision",
          payload: {
            status: "IN_TRIAGE",
            justification: null,
            response: null,
            reason: null,
          },
        }));
      },
      async readWorking() {
        return [];
      },
    };
    const deps = engine(adapter);
    await expect(
      pull(
        deps,
        {
          projectId: "project-collision",
          projectVersionId: "version-collision",
        },
        ["vexDecision"],
      ),
    ).rejects.toMatchObject({
      name: "PullFailedError",
      failures: [
        {
          kind: "vexDecision",
          message: expect.stringContaining("remote id is already claimed"),
        },
      ],
    });
  });

  it("preserves a typed remote error code in the surfaced pull failure", async () => {
    const adapter: EntityAdapter = {
      kind: "threat",
      klass: "VERSIONED",
      serializer: createSerializer("threat"),
      async *fetchRemote() {
        throw new RemoteError("Invalid remote paging state", {
          service: "assurance-studio",
          code: "REMOTE_INVALID_PAGE_SIZE",
          status: null,
          retryable: false,
          retryAfterMs: null,
          details: { pageSize: 1_000, maxPageSize: 200 },
        });
      },
      async readWorking() {
        return [];
      },
    };

    await expect(
      pull(
        engine(adapter),
        { projectId: "project", projectVersionId: "version" },
        ["threat"],
      ),
    ).rejects.toMatchObject({
      name: "PullFailedError",
      failures: [
        {
          kind: "threat",
          message: "REMOTE_INVALID_PAGE_SIZE: Invalid remote paging state",
        },
      ],
      message: expect.stringContaining(
        "threat: REMOTE_INVALID_PAGE_SIZE: Invalid remote paging state",
      ),
    });
  });

  it("does not notify when the publication fence moves", async () => {
    const scope = {
      projectId: "project-fenced",
      projectVersionId: "version-fenced",
    };
    let deps: EngineDeps;
    let publications = 0;
    const adapter: EntityAdapter = {
      kind: "requirement",
      klass: "VERSIONED",
      serializer: createSerializer("requirement"),
      async *fetchRemote(_scope, progress) {
        progress({ page: 1, of: 1 });
        yield [
          {
            key: ENTITIES.requirement.key({ reqId: "REQ-FENCED" }),
            remoteId: "remote-fenced",
            payload: {
              id: "remote-fenced",
              projectId: scope.projectId,
              kind: "requirement",
              fields: { reqId: "REQ-FENCED", title: "Fenced" },
              humanEdited: null,
              reviewStatus: null,
              reviewVersion: null,
            },
          },
        ];
      },
      async readWorking() {
        deps.db
          .prepare(
            `UPDATE sync_state
              SET staging_generation_id = NULL
            WHERE project_id = ? AND project_version_id = ?
              AND entity_kind = 'requirement'`,
          )
          .run(scope.projectId, scope.projectVersionId);
        return [];
      },
    };
    deps = engine(adapter, {
      worktreeRoot: "/worktree",
      published: () => {
        publications += 1;
      },
    });

    await expect(pull(deps, scope, ["requirement"])).rejects.toThrow(
      "Publication fence moved for requirement",
    );
    expect(publications).toBe(0);
    expect(
      deps.db
        .prepare(
          `SELECT accepted_generation_id
         FROM sync_state
        WHERE project_id = ? AND project_version_id = ?
          AND entity_kind = 'requirement'`,
        )
        .pluck()
        .get(scope.projectId, scope.projectVersionId),
    ).toBeNull();
  });

  it("isolates a failed kind, keeps prior accepted readers stable, and flips all kinds once on retry", async () => {
    let requirementTitle = "requirement-v1";
    let threatTitle = "threat-v1";
    let failThreat = false;
    const requirementKey = ENTITIES.requirement.key({ reqId: "REQ-MULTI" });
    const threatKey = ENTITIES.threat.key({ slug: "THREAT-MULTI" });
    const requirement: EntityAdapter = {
      kind: "requirement",
      klass: "VERSIONED",
      serializer: createSerializer("requirement"),
      async *fetchRemote(scope, progress) {
        progress({ page: 1, of: 1 });
        yield [
          {
            key: requirementKey,
            remoteId: "remote-requirement",
            payload: {
              id: "remote-requirement",
              projectId: scope.projectId,
              kind: "requirement",
              fields: { reqId: "REQ-MULTI", title: requirementTitle },
              humanEdited: null,
              reviewStatus: null,
              reviewVersion: null,
            },
          },
        ];
      },
      async readWorking() {
        return [];
      },
    };
    const threat: EntityAdapter = {
      kind: "threat",
      klass: "VERSIONED",
      serializer: createSerializer("threat"),
      async *fetchRemote(scope, progress) {
        if (failThreat) throw new TypeError("mock threat reset");
        progress({ page: 1, of: 1 });
        yield [
          {
            key: threatKey,
            remoteId: "remote-threat",
            payload: {
              id: "remote-threat",
              projectId: scope.projectId,
              kind: "threat",
              fields: { slug: "THREAT-MULTI", title: threatTitle },
              humanEdited: null,
              reviewStatus: null,
              reviewVersion: null,
            },
          },
        ];
      },
      async readWorking() {
        return [];
      },
    };
    let generation = 0;
    const publications: Array<{
      generationId: string;
      acceptedKinds: Array<{
        entity_kind: string;
        accepted_generation_id: string;
      }>;
    }> = [];
    const deps = engine(requirement, {
      adapters: [requirement, threat],
      createGenerationId: () => `generation-multi-${++generation}`,
      published(publication) {
        publications.push({
          generationId: publication.generationId,
          acceptedKinds: deps.db
            .prepare<
              [string, string | null],
              { entity_kind: string; accepted_generation_id: string }
            >(
              `SELECT entity_kind, accepted_generation_id
               FROM sync_state
              WHERE project_id = ? AND project_version_id = ?
              ORDER BY entity_kind`,
            )
            .all(
              publication.scope.projectId,
              publication.scope.projectVersionId,
            ),
        });
      },
    });
    const selectedScope = {
      projectId: "project-multi",
      projectVersionId: "version-multi",
    };
    const first = await pull(deps, selectedScope, ["requirement", "threat"]);
    expect(publications).toEqual([
      {
        generationId: first.generationId,
        acceptedKinds: [
          {
            entity_kind: "requirement",
            accepted_generation_id: first.generationId,
          },
          { entity_kind: "threat", accepted_generation_id: first.generationId },
        ],
      },
    ]);
    const acceptedBefore = new BaseSnapshotStore(deps.db).listAccepted(
      selectedScope.projectId,
      selectedScope.projectVersionId,
      "requirement",
    );
    requirementTitle = "requirement-v2";
    threatTitle = "threat-v2";
    failThreat = true;
    await expect(
      pull(deps, selectedScope, ["requirement", "threat"]),
    ).rejects.toMatchObject({
      failures: [{ kind: "threat", message: "mock threat reset" }],
    });
    expect(publications).toHaveLength(1);
    const staged = deps.db
      .prepare(
        `SELECT entity_kind, accepted_generation_id, staging_generation_id, staged_rows
         FROM sync_state ORDER BY entity_kind`,
      )
      .all();
    expect(staged).toEqual([
      {
        entity_kind: "requirement",
        accepted_generation_id: first.generationId,
        staging_generation_id: "generation-multi-2",
        staged_rows: 1,
      },
      {
        entity_kind: "threat",
        accepted_generation_id: first.generationId,
        staging_generation_id: "generation-multi-2",
        staged_rows: 0,
      },
    ]);
    expect(
      new BaseSnapshotStore(deps.db).listAccepted(
        selectedScope.projectId,
        selectedScope.projectVersionId,
        "requirement",
      ),
    ).toEqual(acceptedBefore);

    failThreat = false;
    await expect(
      pull(deps, selectedScope, ["requirement", "threat"]),
    ).resolves.toMatchObject({ generationId: "generation-multi-2" });
    expect(publications.at(-1)).toEqual({
      generationId: "generation-multi-2",
      acceptedKinds: [
        {
          entity_kind: "requirement",
          accepted_generation_id: "generation-multi-2",
        },
        { entity_kind: "threat", accepted_generation_id: "generation-multi-2" },
      ],
    });
    expect(
      deps.db
        .prepare(
          "SELECT entity_kind, base_revision FROM sync_state ORDER BY entity_kind",
        )
        .all(),
    ).toEqual([
      { entity_kind: "requirement", base_revision: 2 },
      { entity_kind: "threat", base_revision: 2 },
    ]);
  });
});
