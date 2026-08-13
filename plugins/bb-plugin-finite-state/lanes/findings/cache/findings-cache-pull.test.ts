import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import { findingStableKey, parseFindingStableKey } from "../../../lib/sync/registry.js";
import type { Json, RemotePage } from "../../../lib/remote/types.js";
import { pull } from "../../sync/engine/pull.js";
import type { AdapterProgress, SyncScope } from "../../sync/engine/adapter.js";
import type { EngineDeps } from "../../sync/engine/pull.js";
import { normalizeFinding, pullFindings } from "./pull.js";
import { queryFindings } from "./query.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.harness.lifecycle.dispose()));
});

function pages<T>(values: RemotePage<T>[]): AsyncIterable<RemotePage<T>> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const value of values) yield value;
    },
  };
}

describe("findings cache pull", () => {
  it("treats null, absent, and empty primary aliases identically across stable identity inputs", () => {
    const identities = new Map([
      ["component-1", {
        name: "Library",
        group: "Acme",
        version: "1.0.0",
        purl: "pkg:npm/library@1.0.0",
      }],
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
    const expectedKey = findingStableKey({
      cve: "CVE-2026-0001",
      purl: "pkg:npm/library@1.0.0",
      name: "Library",
      group: "Acme",
      version: "1.0.0",
    }, "purl");
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
      { id: "component-1", name: "Library", group: "Acme", version: "1.0.0", purl: "pkg:npm/library@1.0.0" },
      { id: "component-2", name: "Fallback", group: "Acme", version: "2.0.0", purl: null },
    ];
    const first: Record<string, Json> = {
      id: "finding-1", projectVersionId: "pv-1", componentId: "component-1",
      componentPurl: "pkg:npm/library@1.0.0", cve: "CVE-2026-0001", severity: "high",
      riskScore: 9, cwes: ["CWE-79"], title: "First",
    };
    const second: Record<string, Json> = {
      id: "finding-2", projectVersionId: "pv-1", componentId: "component-2",
      componentPurl: null, cve: "CVE-2026-0002", severity: "medium",
      riskScore: 5, title: "Second",
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
      cachePullers: [{
        kind: "finding" as const,
        pull: (pullScope: SyncScope, generationId: string, onProgress: (value: AdapterProgress) => void) =>
          pullFindings(
            { db, platform, warn: warning },
            pullScope,
            generationId,
            value => {
              progress.push(value);
              onProgress(value);
            },
          ).then(() => undefined),
      }],
    };

    await expect(pull(deps, scope, ["finding"])).rejects.toThrow("connection reset");
    expect(queryFindings(db, { projectId: scope.projectId, pvId }).items).toEqual([]);

    await expect(pull(deps, scope, ["finding"])).resolves.toMatchObject({ generationId: "generation-1" });
    const result = queryFindings(db, { projectId: scope.projectId, pvId });
    expect(result.items).toHaveLength(2);
    expect(result.items.map(item => item.stableKey)).toEqual([
      findingStableKey({ cve: "CVE-2026-0001", purl: "pkg:npm/library@1.0.0", name: "Library", group: "Acme", version: "1.0.0" }, "purl"),
      findingStableKey({ cve: "CVE-2026-0002", purl: null, name: "Fallback", group: "Acme", version: "2.0.0" }, "name-group-version"),
    ]);
    expect(result.items.every(item => !item.stableKey.includes("finding-"))).toBe(true);
    expect(new Set(result.items.map(item => item.pulledAt))).toEqual(new Set(["2026-08-13T00:00:00.000Z"]));
    expect(warning).toHaveBeenCalledWith(
      "Collapsed duplicate Platform finding ids at ingest",
      { count: 1, projectVersionId: "pv-1" },
    );
    expect(progress).toContainEqual({ page: 2, of: 1, phase: "done" });

    await pull({ ...deps, createGenerationId: () => "generation-2" }, scope, ["finding"]);
    expect(queryFindings(db, { projectId: scope.projectId, pvId }).items).toHaveLength(2);
    expect((db.prepare(
      "SELECT COUNT(*) AS count FROM findings WHERE generation_id = (SELECT accepted_generation_id FROM sync_state WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'finding')",
    ).get(scope.projectId, pvId) as { count: number }).count).toBe(2);
  });

  it("collapses the audited 4,001-row seed to the owner-approved 4,000 cached ids", async () => {
    const fixtureRoot = new URL("../../../test/mock-remote/fixtures/platform/", import.meta.url);
    const jsonLines = (name: string): Array<Record<string, Json>> =>
      readFileSync(new URL(name, fixtureRoot), "utf8")
        .trim()
        .split("\n")
        .map(line => JSON.parse(line) as Record<string, Json>);
    const findingRows = jsonLines("findings.jsonl");
    const componentRows = jsonLines("components.jsonl");
    const host = createFakePluginHost({ pluginId: "findings-seed" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    const pvId = findingRows[0]?.projectVersionId;
    if (typeof pvId !== "string") throw new Error("seed has no project version");
    const scope: SyncScope = { projectId: "seed-project", projectVersionId: pvId };
    const paged = (rows: Array<Record<string, Json>>, start: number, size: number) => {
      const result: Array<RemotePage<Record<string, Json>>> = [];
      for (let index = start; index < rows.length; index += size) {
        const next = index + size < rows.length ? String(index + size) : null;
        result.push({ items: rows.slice(index, index + size), total: rows.length, next });
      }
      return pages(result);
    };
    const warning = vi.fn();
    const platform = {
      listComponents(input: { page?: { continuation?: string; pageSize?: number } }) {
        return paged(componentRows, Number(input.page?.continuation ?? 0), input.page?.pageSize ?? 200);
      },
      getFindings(input: { page?: { continuation?: string; pageSize?: number } }) {
        return paged(findingRows, Number(input.page?.continuation ?? 0), input.page?.pageSize ?? 200);
      },
    };
    const deps: EngineDeps = {
      db,
      worktreeRoot: null,
      now: () => new Date("2026-08-13T00:00:00.000Z"),
      createGenerationId: () => "seed-generation",
      cachePullers: [{
        kind: "finding",
        pull: (pullScope, generationId, onProgress) =>
          pullFindings({ db, platform, warn: warning }, pullScope, generationId, progress => {
            onProgress(progress);
          }).then(() => undefined),
      }],
    };
    await pull(deps, scope, ["finding"]);
    const accepted = db.prepare(
      `SELECT COUNT(*) AS count, COUNT(DISTINCT pulled_at) AS pulledAtCount
         FROM findings
        WHERE project_id = ? AND project_version_id = ? AND generation_id = 'seed-generation'`,
    ).get(scope.projectId, pvId) as { count: number; pulledAtCount: number };
    expect(accepted).toEqual({ count: 4_000, pulledAtCount: 1 });
    expect(warning).toHaveBeenCalledWith(
      "Collapsed duplicate Platform finding ids at ingest",
      { count: 1, projectVersionId: pvId },
    );
    const fallback = db.prepare(
      "SELECT stable_key FROM findings WHERE generation_id = 'seed-generation' AND component_purl IS NULL",
    ).get() as { stable_key: string };
    expect(parseFindingStableKey(fallback.stable_key).tier).toBe("name-group-version");
    const started = performance.now();
    const representative = queryFindings(db, {
      projectId: scope.projectId,
      pvId,
      severity: ["critical", "high"],
      component: "eagle-component",
      cve: "CVE-202",
      limit: 100,
    });
    expect(representative.total).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
