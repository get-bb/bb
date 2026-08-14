import { readFileSync } from "node:fs";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import {
  findingStableKey,
  parseFindingStableKey,
} from "../../../lib/sync/registry.js";
import type { Json, RemotePage } from "../../../lib/remote/types.js";
import { pull } from "../../sync/engine/pull.js";
import type { AdapterProgress, SyncScope } from "../../sync/engine/adapter.js";
import type { EngineDeps } from "../../sync/engine/pull.js";
import { normalizeFinding, pullFindings } from "./pull.js";
import { queryFindings } from "./query.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

function pages<T>(values: RemotePage<T>[]): AsyncIterable<RemotePage<T>> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const value of values) yield value;
    },
  };
}

describe("findings cache pull", () => {
  it("normalizes the captured distro and CVE/UUID specimens without losing wire identity", () => {
    const fixture = (name: string) =>
      JSON.parse(
        readFileSync(
          new URL(
            `../../../test/mock-remote/fixtures/platform/${name}`,
            import.meta.url,
          ),
          "utf8",
        ),
      ) as Record<string, Json>;
    const distroWire = fixture("fs174-i491nax-distro-specimen.json");
    const distro = normalizeFinding(distroWire, new Map());
    expect(distro).toMatchObject({
      findingId: "0b529d2b-9da8-556e-81e4-f0f57a59956a",
      cve: "CVE-2016-4658",
      componentGroup: "debian",
      componentName: "libxml2",
      componentVersion: "2.9.4+dfsg1-2.2+deb9u2",
    });
    expect(JSON.parse(distro.raw)).toEqual(distroWire);
    expect(parseFindingStableKey(distro.stableKey)).toMatchObject({
      cve: "CVE-2016-4658",
      component: {
        group: "debian",
        name: "libxml2",
        version: "2.9.4%2bdfsg1-2.2%2bdeb9u2",
      },
    });

    const cveWire = fixture("fs174-cve-uuid-mapping-specimen.json");
    const cve = normalizeFinding(cveWire, new Map());
    expect(cve.cve).toBe("CVE-2026-34877");
    expect(parseFindingStableKey(cve.stableKey).cve).toBe("CVE-2026-34877");
    expect(cve.stableKey).not.toBe(
      findingStableKey(
        {
          cve: "cbdc8dc1-66ad-5264-b81b-67b2eaf1257e",
          purl: null,
          name: "Mbed TLS",
          group: null,
          version: "3.0.0",
        },
        "name-group-version",
      ),
    );
  });

  it("preserves malformed escaping and keeps encoded and literal versions collision-free", () => {
    const malformed = normalizeFinding(
      {
        id: "finding-bad-version",
        findingId: "CVE-2026-12345",
        component: { name: "debian/package", version: "1.0%2" },
      },
      new Map(),
    );
    const encoded = normalizeFinding(
      {
        id: "finding-encoded-version",
        findingId: "CVE-2026-12345",
        component: { name: "debian/package", version: "1.0%2B2" },
      },
      new Map(),
    );
    const literal = normalizeFinding(
      {
        id: "finding-literal-version",
        findingId: "CVE-2026-12345",
        component: { name: "debian/package", version: "1.0+2" },
      },
      new Map(),
    );
    expect(malformed.componentVersion).toBe("1.0%2");
    expect(encoded.componentVersion).toBe("1.0+2");
    expect(encoded.stableKey).not.toBe(literal.stableKey);
  });

  it("keeps a non-CVE findingId ahead of an opaque vulnerability UUID", () => {
    const finding = normalizeFinding(
      {
        id: "finding-ghsa",
        findingId: "GHSA-abcd-1234-5678",
        vulnerabilityId: "cbdc8dc1-66ad-5264-b81b-67b2eaf1257e",
        component: { name: "package", version: "1.0.0" },
      },
      new Map(),
    );
    expect(finding.cve).toBe("GHSA-abcd-1234-5678");
    expect(parseFindingStableKey(finding.stableKey).cve).toBe(
      "GHSA-abcd-1234-5678",
    );
  });

  it.each([
    ["github.com/gorilla/websocket", null, "github.com%2fgorilla", "websocket"],
    ["debian//libxml2", null, "debian", "libxml2"],
    ["/libxml2", null, null, "libxml2"],
    ["libxml2/", null, null, "libxml2"],
    [
      "vendor/package",
      "distro/releases",
      "distro%2freleases%2fvendor",
      "package",
    ],
  ])(
    "canonicalizes namespace shape %s deterministically",
    (name, group, expectedGroup, expectedName) => {
      const finding = normalizeFinding(
        {
          id: `finding-${name}`,
          findingId: "CVE-2026-12345",
          component: { name, version: "100%" },
          ...(group === null ? {} : { componentGroup: group }),
        },
        new Map(),
      );
      expect(parseFindingStableKey(finding.stableKey).component).toMatchObject({
        group: expectedGroup,
        name: expectedName,
        version: "100%",
      });
    },
  );

  it("keeps stable keys byte-identical for equivalent flat and nested component identities", () => {
    const identities = new Map([
      [
        "component-1",
        {
          name: "Mbed TLS",
          group: "Arm",
          version: "3.0.0",
          purl: "pkg:generic/mbed-tls@3.0.0",
        },
      ],
    ]);
    const finding = {
      id: "finding-1",
      cve: "CVE-2026-34877",
      title: "CVE-2026-34877 - Mbed TLS@3.0.0",
      type: "cve",
    } satisfies Record<string, Json>;
    const flat = normalizeFinding(
      {
        ...finding,
        componentId: "component-1",
        componentName: "Mbed TLS",
        componentGroup: "Arm",
        componentVersion: "3.0.0",
        componentPurl: "pkg:generic/mbed-tls@3.0.0",
      },
      identities,
    );
    const nested = normalizeFinding(
      {
        ...finding,
        component: {
          appId: "app-component-1",
          id: "component-1",
          name: "Mbed TLS",
          vcId: "vc-component-1",
          version: "3.0.0",
        },
      },
      identities,
    );
    const missingJoin = normalizeFinding(
      {
        ...finding,
        component: {
          appId: "app-component-1",
          id: "component-1",
          name: "Mbed TLS",
          vcId: "vc-component-1",
          version: "3.0.0",
        },
      },
      new Map(),
    );

    expect(nested.stableKey).toBe(flat.stableKey);
    expect(nested.stableKey).toBe(
      findingStableKey(
        {
          cve: "CVE-2026-34877",
          purl: "pkg:generic/mbed-tls@3.0.0",
          name: "Mbed TLS",
          group: "Arm",
          version: "3.0.0",
        },
        "purl",
      ),
    );
    expect(missingJoin.stableKey).toBe(
      findingStableKey(
        {
          cve: "CVE-2026-34877",
          purl: null,
          name: "Mbed TLS",
          group: null,
          version: "3.0.0",
        },
        "name-group-version",
      ),
    );
    expect(missingJoin.stableKey).not.toBe(nested.stableKey);
  });

  it("reports payload keys when component identity is genuinely missing", () => {
    expect(() =>
      normalizeFinding(
        {
          id: "finding-without-component-name",
          cve: "CVE-2026-0001",
          component: { id: "component-1", version: "1.0.0" },
          severity: "high",
        },
        new Map(),
      ),
    ).toThrow(
      "Finding finding-without-component-name has no component name for canonical identity; " +
        "payload keys [component, cve, id, severity]; component keys [id, version]",
    );
  });

  it("treats null, absent, and empty primary aliases identically across stable identity inputs", () => {
    const identities = new Map([
      [
        "component-1",
        {
          name: "Library",
          group: "Acme",
          version: "1.0.0",
          purl: "pkg:npm/library@1.0.0",
        },
      ],
    ]);
    const fallbackRow: Record<string, Json> = {
      uuid: "finding-1",
      vulnerabilityId: "CVE-2026-0001",
      componentUuid: "component-1",
      packageUrl: "pkg:npm/library@1.0.0",
      name: "Library",
      namespace: "Acme",
      version: "1.0.0",
    };
    const expectedKey = findingStableKey(
      {
        cve: "CVE-2026-0001",
        purl: "pkg:npm/library@1.0.0",
        name: "Library",
        group: "Acme",
        version: "1.0.0",
      },
      "purl",
    );
    const primaryAliases = [
      "id",
      "findingId",
      "cve",
      "findingIdentifier",
      "componentId",
      "componentPurl",
      "purl",
      "componentName",
      "componentGroup",
      "group",
      "componentVersion",
    ] as const;
    const primaryStates: Array<{ label: string; value: Json | undefined }> = [
      { label: "absent", value: undefined },
      { label: "null", value: null },
      { label: "empty", value: "" },
    ];

    for (const primaryAlias of primaryAliases) {
      for (const state of primaryStates) {
        const row = { ...fallbackRow };
        if (state.value !== undefined) row[primaryAlias] = state.value;
        const normalized = normalizeFinding(row, identities);
        expect(
          { findingId: normalized.findingId, stableKey: normalized.stableKey },
          `${primaryAlias} ${state.label}`,
        ).toEqual({ findingId: "finding-1", stableKey: expectedKey });
      }
    }
  });

  it("resumes whole pages, deduplicates Platform ids observably, and uses only exact frozen stable keys", async () => {
    const host = createFakePluginHost({ pluginId: "findings-pull" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    const pvId = "pv-1";
    const scope: SyncScope = { projectId: "project-1", projectVersionId: pvId };
    const componentRows: Array<Record<string, Json>> = [
      {
        id: "component-1",
        name: "Library",
        group: "Acme",
        version: "1.0.0",
        purl: "pkg:npm/library@1.0.0",
      },
      {
        id: "component-2",
        name: "Fallback",
        group: "Acme",
        version: "2.0.0",
        purl: null,
      },
    ];
    const first: Record<string, Json> = {
      id: "finding-1",
      projectVersionId: "pv-1",
      componentId: "component-1",
      componentPurl: "pkg:npm/library@1.0.0",
      cve: "CVE-2026-0001",
      severity: "high",
      riskScore: 9,
      cwes: ["CWE-79"],
      title: "First",
    };
    const second: Record<string, Json> = {
      id: "finding-2",
      projectVersionId: "pv-1",
      componentId: "component-2",
      componentPurl: null,
      cve: "CVE-2026-0002",
      severity: "medium",
      riskScore: 5,
      title: "Second",
    };
    let findingsCalls = 0;
    const warning = vi.fn();
    const progress: unknown[] = [];
    const platform = {
      listComponents() {
        return pages([{ items: componentRows, total: 2, next: null }]);
      },
      getFindings(input: { page?: { continuation?: string } }) {
        findingsCalls += 1;
        if (findingsCalls === 1) {
          return {
            async *[Symbol.asyncIterator]() {
              yield { items: [first], total: 3, next: "after-first" };
              throw new Error("connection reset");
            },
          };
        }
        if (findingsCalls === 2) {
          expect(input.page?.continuation).toBe("after-first");
          return pages([{ items: [second, first], total: 3, next: null }]);
        }
        expect(input.page?.continuation).toBeUndefined();
        return pages([
          { items: [first], total: 3, next: "after-first" },
          { items: [second, first], total: 3, next: null },
        ]);
      },
    };
    let generationNumber = 0;
    const deps: EngineDeps = {
      db,
      worktreeRoot: null,
      now: () => new Date("2026-08-13T00:00:00.000Z"),
      createGenerationId: () => `generation-${++generationNumber}`,
      cachePullers: [
        {
          kind: "finding" as const,
          pull: (
            pullScope: SyncScope,
            generationId: string,
            onProgress: (value: AdapterProgress) => void,
          ) =>
            pullFindings(
              { db, platform, warn: warning },
              pullScope,
              generationId,
              (value) => {
                progress.push(value);
                onProgress(value);
              },
            ).then((result) => ({
              fetched: result.fetched,
              baseRows: result.published,
            })),
        },
      ],
    };

    await expect(pull(deps, scope, ["finding"])).rejects.toThrow(
      "connection reset",
    );
    expect(
      queryFindings(db, { projectId: scope.projectId, pvId }).items,
    ).toEqual([]);

    await expect(pull(deps, scope, ["finding"])).resolves.toMatchObject({
      generationId: "generation-1",
      kinds: { finding: { fetched: 1, baseRows: 2 } },
    });
    const result = queryFindings(db, { projectId: scope.projectId, pvId });
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.stableKey)).toEqual([
      findingStableKey(
        {
          cve: "CVE-2026-0001",
          purl: "pkg:npm/library@1.0.0",
          name: "Library",
          group: "Acme",
          version: "1.0.0",
        },
        "purl",
      ),
      findingStableKey(
        {
          cve: "CVE-2026-0002",
          purl: null,
          name: "Fallback",
          group: "Acme",
          version: "2.0.0",
        },
        "name-group-version",
      ),
    ]);
    expect(
      result.items.every((item) => !item.stableKey.includes("finding-")),
    ).toBe(true);
    expect(new Set(result.items.map((item) => item.pulledAt))).toEqual(
      new Set(["2026-08-13T00:00:00.000Z"]),
    );
    expect(warning).toHaveBeenCalledWith(
      "Collapsed duplicate Platform finding ids at ingest",
      { count: 1, projectVersionId: "pv-1" },
    );
    expect(progress).toContainEqual({ page: 2, of: 1, phase: "done" });

    await pull({ ...deps, createGenerationId: () => "generation-2" }, scope, [
      "finding",
    ]);
    expect(
      queryFindings(db, { projectId: scope.projectId, pvId }).items,
    ).toHaveLength(2);
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM findings WHERE generation_id = (SELECT accepted_generation_id FROM sync_state WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'finding')",
          )
          .get(scope.projectId, pvId) as { count: number }
      ).count,
    ).toBe(2);
  });

  it("reports zero fetched while publishing a fully staged resumed generation", async () => {
    const host = createFakePluginHost({ pluginId: "findings-complete-resume" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    const scope: SyncScope = {
      projectId: "project-resume",
      projectVersionId: "pv-resume",
    };
    let remoteCalls = 0;
    let failAfterStaging = true;
    const platform = {
      listComponents() {
        return pages([{ items: [], total: 0, next: null }]);
      },
      getFindings() {
        remoteCalls += 1;
        return pages([
          {
            items: [
              {
                id: "finding-resume",
                findingId: "CVE-2026-10000",
                component: { name: "package", version: "1.0.0" },
              },
            ],
            total: 1,
            next: null,
          },
        ]);
      },
    };
    const deps: EngineDeps = {
      db,
      worktreeRoot: null,
      createGenerationId: () => "generation-resume",
      now: () => new Date("2026-08-13T00:00:00.000Z"),
      cachePullers: [
        {
          kind: "finding",
          async pull(pullScope, generationId, onProgress) {
            const result = await pullFindings(
              { db, platform },
              pullScope,
              generationId,
              onProgress,
            );
            if (failAfterStaging) {
              failAfterStaging = false;
              throw new Error("peer kind failed after finding staging");
            }
            return { fetched: result.fetched, baseRows: result.published };
          },
        },
      ],
    };

    await expect(pull(deps, scope, ["finding"])).rejects.toThrow(
      "peer kind failed",
    );
    await expect(pull(deps, scope, ["finding"])).resolves.toMatchObject({
      generationId: "generation-resume",
      kinds: { finding: { fetched: 0, baseRows: 1 } },
    });
    expect(remoteCalls).toBe(1);
    expect(
      queryFindings(db, { projectId: scope.projectId, pvId: "pv-resume" })
        .items,
    ).toHaveLength(1);
  });

  it("collapses the audited 4,001-row seed to the owner-approved 4,000 cached ids", async () => {
    const fixtureRoot = new URL(
      "../../../test/mock-remote/fixtures/platform/",
      import.meta.url,
    );
    const jsonLines = (name: string): Array<Record<string, Json>> =>
      readFileSync(new URL(name, fixtureRoot), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, Json>);
    const allFindingRows = jsonLines("findings.jsonl");
    const componentRows = jsonLines("components.jsonl");
    const host = createFakePluginHost({ pluginId: "findings-seed" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    const pvId = allFindingRows[0]?.projectVersionId;
    if (typeof pvId !== "string")
      throw new Error("seed has no project version");
    const findingRows = allFindingRows.filter(
      (row) => row.projectVersionId === pvId,
    );
    const scope: SyncScope = {
      projectId: "seed-project",
      projectVersionId: pvId,
    };
    const paged = (
      rows: Array<Record<string, Json>>,
      start: number,
      size: number,
    ) => {
      const result: Array<RemotePage<Record<string, Json>>> = [];
      for (let index = start; index < rows.length; index += size) {
        const next = index + size < rows.length ? String(index + size) : null;
        result.push({
          items: rows.slice(index, index + size),
          total: rows.length,
          next,
        });
      }
      return pages(result);
    };
    const warning = vi.fn();
    const platform = {
      listComponents(input: {
        page?: { continuation?: string; pageSize?: number };
      }) {
        return paged(
          componentRows,
          Number(input.page?.continuation ?? 0),
          input.page?.pageSize ?? 200,
        );
      },
      getFindings(input: {
        page?: { continuation?: string; pageSize?: number };
      }) {
        return paged(
          findingRows,
          Number(input.page?.continuation ?? 0),
          input.page?.pageSize ?? 200,
        );
      },
    };
    const deps: EngineDeps = {
      db,
      worktreeRoot: null,
      now: () => new Date("2026-08-13T00:00:00.000Z"),
      createGenerationId: () => "seed-generation",
      cachePullers: [
        {
          kind: "finding",
          pull: (pullScope, generationId, onProgress) =>
            pullFindings(
              { db, platform, warn: warning },
              pullScope,
              generationId,
              (progress) => {
                onProgress(progress);
              },
            ).then((result) => ({
              fetched: result.fetched,
              baseRows: result.published,
            })),
        },
      ],
    };
    await pull(deps, scope, ["finding"]);
    const accepted = db
      .prepare(
        `SELECT COUNT(*) AS count, COUNT(DISTINCT pulled_at) AS pulledAtCount
         FROM findings
        WHERE project_id = ? AND project_version_id = ? AND generation_id = 'seed-generation'`,
      )
      .get(scope.projectId, pvId) as { count: number; pulledAtCount: number };
    expect(accepted).toEqual({ count: 4_000, pulledAtCount: 1 });
    expect(warning).toHaveBeenCalledWith(
      "Collapsed duplicate Platform finding ids at ingest",
      { count: 1, projectVersionId: pvId },
    );
    const fallback = db
      .prepare(
        "SELECT stable_key FROM findings WHERE generation_id = 'seed-generation' AND component_purl IS NULL",
      )
      .get() as { stable_key: string };
    expect(parseFindingStableKey(fallback.stable_key).tier).toBe(
      "name-group-version",
    );
    const started = process.cpuUsage();
    const representative = queryFindings(db, {
      projectId: scope.projectId,
      pvId,
      severity: ["critical", "high"],
      component: "eagle-component",
      cve: "CVE-202",
      limit: 100,
    });
    expect(representative.total).toBeGreaterThan(0);
    const cpu = process.cpuUsage(started);
    expect((cpu.user + cpu.system) / 1_000).toBeLessThan(50);
  });
});
