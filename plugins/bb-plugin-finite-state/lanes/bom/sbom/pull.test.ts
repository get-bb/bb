import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformClient } from "../../../lib/remote/platform/client.js";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import { parseKey } from "../../../lib/sync/registry.js";
import {
  RemoteError,
  type PlatformClient as PlatformClientContract,
} from "../../../lib/remote/types.js";
import {
  createMockRemote,
  type MockRemoteHarness,
} from "../../../test/mock-remote/server.js";
import { registerPlatformHandlers } from "../../../test/mock-remote/platform/register.js";
import { createMockPlatformState } from "../../../test/mock-remote/platform/state.js";
import { createBomCommandServices } from "../register.js";
import { normalizeComponent, pullSbom } from "./pull.js";
import { querySbom } from "./query.js";
import { componentKeyFromIdentity } from "./rollup.js";

const FIXTURE_ROOT = resolve(
  import.meta.dirname,
  "../../../test/mock-remote/fixtures",
);
const TOKEN = "sbom-pull-test-token";
const roots: string[] = [];
const harnesses: MockRemoteHarness[] = [];
const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const migration of MIGRATIONS) db.exec(migration);
  return db;
}

async function root(): Promise<string> {
  const value = await mkdtemp(resolve(tmpdir(), "fs-sbom-pull-"));
  roots.push(value);
  return value;
}

function setupPlatform(): {
  client: PlatformClient;
  harness: MockRemoteHarness;
} {
  const state = createMockPlatformState(FIXTURE_ROOT);
  const harness = createMockRemote({
    platformToken: TOKEN,
    assuranceStudioKey: "unused",
    fixtureRoot: FIXTURE_ROOT,
    register(service, registry) {
      if (service === "platform") registerPlatformHandlers(registry, state);
    },
  });
  harnesses.push(harness);
  return {
    harness,
    client: new PlatformClient({
      baseUrl: "http://platform.mock",
      token: TOKEN,
      fetch: harness.platform.fetch,
    }),
  };
}

function seedAccepted(db: Database.Database): string {
  const key = componentKeyFromIdentity({
    purl: "pkg:generic/old@1",
    name: "old",
    group: null,
    version: "1",
  });
  db.exec(`
    INSERT INTO pull_generation
      (project_id, project_version_id, generation_id, status,
       requested_kinds_json, started_at, completed_at, accepted_at)
    VALUES ('p', 'v', 'old-g', 'accepted', '["sbomComponent"]',
            '2026-08-12T19:00:00.000Z', '2026-08-12T19:00:00.000Z',
            '2026-08-12T19:00:00.000Z');
    INSERT INTO sync_state
      (project_id, project_version_id, entity_kind, accepted_generation_id,
       base_revision, last_pull)
    VALUES ('p', 'v', 'sbomComponent', 'old-g', 1, '2026-08-12T19:00:00.000Z');
  `);
  db.prepare(
    `INSERT INTO sbom_components
      (project_id, project_version_id, generation_id, component_id,
       component_key, purl, name, version, raw, pulled_at)
     VALUES ('p', 'v', 'old-g', 'old-id', ?, 'pkg:generic/old@1',
             'old', '1', '{}', '2026-08-12T19:00:00.000Z')`,
  ).run(key);
  return key;
}

function seedStaging(db: Database.Database, generationId: string): void {
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at)
     VALUES ('p', 'v', ?, 'staging', '["sbomComponent"]',
             '2026-08-12T20:00:00.000Z')`,
  ).run(generationId);
  db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, staging_generation_id,
        staging_continuation, staged_pages, staged_rows)
     VALUES ('p', 'v', 'sbomComponent', ?, NULL, 0, 0)
     ON CONFLICT(project_id, project_version_id, entity_kind) DO UPDATE SET
       staging_generation_id = excluded.staging_generation_id,
       staging_continuation = NULL,
       staged_pages = 0,
       staged_rows = 0,
       error = NULL`,
  ).run(generationId);
}

const rowA = {
  id: "a",
  name: "Alpha",
  purl: "pkg:generic/alpha@1",
  version: "1",
};
const rowB = { id: "b", name: "Beta", purl: null, group: "Core", version: "2" };

describe("resumable SBOM pull", () => {
  it("uses exact purl identity for path-like names and types invalid fallback rows by id", () => {
    const normalized = normalizeComponent({
      id: "firmware-path-row",
      name: "bin/busybox",
      group: "vendor/acme",
      purl: "pkg:generic/busybox@1.36",
      version: "1.36",
    });
    expect(normalized.componentKey).toBe(
      componentKeyFromIdentity({
        purl: "pkg:generic/busybox@1.36",
        name: "any-safe-name",
        group: null,
        version: null,
      }),
    );
    expect(() =>
      normalizeComponent({
        id: "invalid-fallback-row",
        name: "bin/busybox",
        purl: null,
        version: "1.36",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "SBOM_INVALID_COMPONENT",
        message: expect.stringContaining("invalid-fallback-row"),
      }),
    );
  });

  it("fully drains the audited 900-component Platform iterable and publishes one atomic slice", async () => {
    const db = createDb();
    const worktreeRoot = await root();
    const { client } = setupPlatform();
    const progress = vi.fn();
    seedStaging(db, "generation-a");
    const result = await pullSbom(
      {
        db,
        platform: client,
        stagingRoot: worktreeRoot,
        generationId: "generation-a",
        pageSize: 37,
        now: () => new Date("2026-08-12T20:00:00.000Z"),
        publishProgress: progress,
      },
      { projectId: "p", projectVersionId: "v" },
    );

    expect(result).toEqual({
      projectVersionId: "v",
      components: 900,
      pages: Math.ceil(899 / 37) + 1,
      rollups: 900,
      pulledAt: "2026-08-12T20:00:00.000Z",
      resumed: false,
    });
    expect(
      db.prepare("SELECT COUNT(*) FROM sbom_components").pluck().get(),
    ).toBe(900);
    expect(
      db
        .prepare("SELECT COUNT(DISTINCT component_id) FROM sbom_components")
        .pluck()
        .get(),
    ).toBe(900);
    expect(
      db.prepare("SELECT COUNT(*) FROM sbom_vuln_rollup").pluck().get(),
    ).toBe(900);
    const noPurl = db
      .prepare<
        [],
        { component_id: string; component_key: string; purl: null }
      >("SELECT component_id, component_key, purl FROM sbom_components WHERE purl IS NULL LIMIT 1")
      .get()!;
    expect(noPurl.purl).toBeNull();
    expect(parseKey(noPurl.component_key).slice(0, 2)).toEqual([
      "finding",
      "name-group-version",
    ]);
    expect(noPurl.component_key).not.toContain(noPurl.component_id);
    expect(progress).toHaveBeenCalledTimes(Math.ceil(899 / 37) + 1);
    expect(Object.keys(progress.mock.calls[0]![0]).sort()).toEqual([
      "components",
      "pages",
      "projectVersionId",
    ]);
    client.close();
    db.close();
  });

  it("rolls back a malformed page, retains its cursor, and resumes without exposing partial rows", async () => {
    const db = createDb();
    const oldKey = seedAccepted(db);
    seedStaging(db, "generation-next");
    const worktreeRoot = await root();
    const malformed = {
      async *listComponents(
        input: Parameters<PlatformClientContract["listComponents"]>[0],
      ) {
        if (input.excluded) {
          yield { items: [], total: 0, next: null };
          return;
        }
        yield { items: [rowA], total: 2, next: "resume-at-one" };
        yield {
          items: [{ id: "malformed-without-name" }],
          total: 2,
          next: null,
        };
      },
    } satisfies Pick<PlatformClientContract, "listComponents">;

    await expect(
      pullSbom(
        {
          db,
          platform: malformed,
          stagingRoot: worktreeRoot,
          generationId: "generation-next",
          now: () => new Date("2026-08-12T20:00:00.000Z"),
        },
        { projectId: "p", projectVersionId: "v" },
      ),
    ).rejects.toMatchObject({ code: "SBOM_INVALID_COMPONENT" });
    expect(
      querySbom(db, { projectVersionId: "v" }).items[0]!.componentKey,
    ).toBe(oldKey);
    const saved = db
      .prepare<
        [],
        {
          staging_continuation: string;
          staged_pages: number;
          staged_rows: number;
        }
      >(
        "SELECT staging_continuation, staged_pages, staged_rows FROM sync_state WHERE entity_kind = 'sbomComponent'",
      )
      .get()!;
    expect(saved).toMatchObject({ staged_pages: 1, staged_rows: 1 });
    expect(saved.staging_continuation).toMatch(/^bp1\.included\./u);

    const resumedInputs: Array<
      Parameters<PlatformClientContract["listComponents"]>[0]
    > = [];
    const resumed = {
      async *listComponents(
        input: Parameters<PlatformClientContract["listComponents"]>[0],
      ) {
        resumedInputs.push(input);
        if (input.excluded) {
          yield { items: [], total: 0, next: null };
          return;
        }
        yield { items: [rowB], total: 2, next: null };
      },
    } satisfies Pick<PlatformClientContract, "listComponents">;
    const result = await pullSbom(
      {
        db,
        platform: resumed,
        stagingRoot: worktreeRoot,
        generationId: "generation-next",
        now: () => new Date("2026-08-12T21:00:00.000Z"),
      },
      { projectId: "p", projectVersionId: "v", resume: true },
    );
    expect(resumedInputs).toEqual([
      {
        excluded: false,
        page: { pageSize: 200, continuation: "resume-at-one" },
      },
      { excluded: true, page: { pageSize: 200 } },
    ]);
    expect(result).toMatchObject({ components: 2, pages: 3, resumed: true });
    expect(
      db
        .prepare(
          "SELECT component_id FROM sbom_components WHERE generation_id = 'generation-next' ORDER BY component_id",
        )
        .pluck()
        .all(),
    ).toEqual(["a", "b"]);
    expect(
      querySbom(db, { projectVersionId: "v" }).items[0]!.componentKey,
    ).toBe(oldKey);
    expect(
      db
        .prepare(
          "SELECT status FROM pull_generation WHERE generation_id = 'old-g'",
        )
        .pluck()
        .get(),
    ).toBe("accepted");
    expect(
      db
        .prepare(
          "SELECT status FROM pull_generation WHERE generation_id = 'generation-next'",
        )
        .pluck()
        .get(),
    ).toBe("staging");
    db.close();
  });

  it("preserves the complete cache after a mid-stream 429 and resumes its staged page", async () => {
    const db = createDb();
    const oldKey = seedAccepted(db);
    seedStaging(db, "rate-limited-generation");
    const worktreeRoot = await root();
    const rateLimited = {
      async *listComponents(
        input: Parameters<PlatformClientContract["listComponents"]>[0],
      ) {
        if (!input.excluded) {
          yield { items: [rowA], total: 2, next: "after-one" };
        }
        throw new RemoteError("Rate limited", {
          service: "platform",
          code: "REMOTE_RATE_LIMITED",
          status: 429,
          retryable: true,
          retryAfterMs: 2_000,
          details: null,
        });
      },
    } satisfies Pick<PlatformClientContract, "listComponents">;
    await expect(
      pullSbom(
        {
          db,
          platform: rateLimited,
          stagingRoot: worktreeRoot,
          generationId: "rate-limited-generation",
        },
        { projectId: "p", projectVersionId: "v" },
      ),
    ).rejects.toMatchObject({ code: "REMOTE_RATE_LIMITED", status: 429 });
    const page = querySbom(db, { projectVersionId: "v" });
    expect(page.items[0]!.componentKey).toBe(oldKey);
    expect(page.cache).toMatchObject({
      state: "stale",
      asOf: "2026-08-12T19:00:00.000Z",
      message: expect.stringMatching(/Platform.*REMOTE_RATE_LIMITED.*Retry/u),
    });
    expect(
      db.prepare("SELECT is_stale FROM sbom_components").pluck().get(),
    ).toBe(1);

    const staged = db
      .prepare<
        [],
        { staged_pages: number; staged_rows: number }
      >("SELECT staged_pages, staged_rows FROM sync_state WHERE entity_kind = 'sbomComponent'")
      .get()!;
    expect(staged).toEqual({ staged_pages: 1, staged_rows: 1 });
    // Simulate the bounded crash window between the page commit and shared
    // cursor update; resume should heal from the request-owned staging DB.
    db.prepare(
      `UPDATE sync_state SET staging_continuation = NULL, staged_pages = 0, staged_rows = 0
        WHERE entity_kind = 'sbomComponent'`,
    ).run();
    const resumedInputs: Array<
      Parameters<PlatformClientContract["listComponents"]>[0]
    > = [];
    const recovered = {
      async *listComponents(
        input: Parameters<PlatformClientContract["listComponents"]>[0],
      ) {
        resumedInputs.push(input);
        yield input.excluded
          ? { items: [], total: 0, next: null }
          : { items: [rowB], total: 2, next: null };
      },
    } satisfies Pick<PlatformClientContract, "listComponents">;
    const result = await pullSbom(
      {
        db,
        platform: recovered,
        stagingRoot: worktreeRoot,
        generationId: "rate-limited-generation",
      },
      { projectId: "p", projectVersionId: "v", resume: true },
    );
    expect(result).toMatchObject({ components: 2, pages: 3, resumed: true });
    expect(resumedInputs[0]).toEqual({
      excluded: false,
      page: { pageSize: 200, continuation: "after-one" },
    });
    expect(
      db
        .prepare(
          "SELECT component_id FROM sbom_components WHERE generation_id = 'rate-limited-generation' ORDER BY component_id",
        )
        .pluck()
        .all(),
    ).toEqual(["a", "b"]);
    db.close();
  });

  it("publishes only count progress through the registered service", async () => {
    const db = createDb();
    const worktreeRoot = await root();
    const host = createFakePluginHost({ pluginId: "finite-state-bom-signals" });
    hosts.push(host);
    const platform = {
      async *listComponents(
        input: Parameters<PlatformClientContract["listComponents"]>[0],
      ) {
        yield input.excluded
          ? { items: [], total: 0, next: null }
          : {
              items: [{ ...rowA, cpe: "cpe:/a:alpha:alpha:1", isStale: true }],
              total: 1,
              next: null,
            };
      },
    } satisfies Pick<PlatformClientContract, "listComponents">;
    const service = createBomCommandServices(host.bb, db, () => platform);
    seedStaging(db, "service-generation");
    await service.pull({
      projectId: "p",
      projectVersionId: "v",
      stagingRoot: worktreeRoot,
      generationId: "service-generation",
    });
    expect(host.harness.realtimeSignals).toEqual([
      {
        channel: "bom:progress",
        payload: { projectVersionId: "v", components: 1, pages: 1 },
      },
      {
        channel: "bom:progress",
        payload: { projectVersionId: "v", components: 1, pages: 2 },
      },
    ]);
    expect(
      db
        .prepare(
          `SELECT cpe, source, is_stale
         FROM sbom_components
        WHERE generation_id = 'service-generation'`,
        )
        .get(),
    ).toMatchObject({
      cpe: "cpe:/a:alpha:alpha:1",
      source: "platform",
      is_stale: 1,
    });
    db.close();
  });
});
