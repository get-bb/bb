import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import {
  findingStableKey,
  parseFindingStableKey,
} from "../../../lib/sync/registry.js";
import { registeredResolver } from "../../sync/engine/adapter.js";
import { registerFindingsStableKeyStub } from "./index.js";
import {
  enforcePin,
  FindingPinError,
  parseEncodedFindingKey,
  resolveFinding,
  StableFindingKeyError,
  type StableFindingKey,
} from "./resolve.js";

const PROJECT = "project-37";
const PV = "pv-current";
const GENERATION = "generation-current";
const AT = "2026-08-13T00:00:00.000Z";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.harness.lifecycle.dispose()));
});

function fixture() {
  const host = createFakePluginHost({ pluginId: `stable-key-${hosts.length}` });
  hosts.push(host);
  const db = createPluginContext(host.bb).db();
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status, requested_kinds_json,
        started_at, completed_at, accepted_at, error)
     VALUES (?, ?, ?, 'accepted', '["finding"]', ?, ?, ?, NULL)`,
  ).run(PROJECT, PV, GENERATION, AT, AT, AT);
  db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        staging_generation_id, base_revision, staging_continuation, staged_pages,
        staged_rows, last_pull, error)
     VALUES (?, ?, 'finding', ?, NULL, 1, NULL, 0, 0, ?, NULL)`,
  ).run(PROJECT, PV, GENERATION, AT);
  return db;
}

interface FindingFixture {
  id: string;
  cve?: string;
  purl?: string | null;
  name?: string;
  group?: string | null;
  version?: string | null;
  deleted?: boolean;
}

function insertFinding(db: ReturnType<typeof fixture>, row: FindingFixture): void {
  const cve = row.cve ?? "CVE-2026-0037";
  const purl = row.purl ?? null;
  const name = row.name ?? "Widget";
  const group = row.group === undefined ? "Acme" : row.group;
  const version = row.version === undefined ? "1.0.0" : row.version;
  const stableKey = findingStableKey(
    { cve, purl, name, group, version },
    purl === null ? "name-group-version" : "purl",
  );
  db.prepare(
    `INSERT INTO findings
       (project_id, project_version_id, generation_id, finding_id, stable_key,
        cve, component_name, component_group, component_version, component_purl,
        soft_deleted, raw, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
  ).run(
    PROJECT,
    PV,
    GENERATION,
    row.id,
    stableKey,
    cve,
    name,
    group,
    version,
    purl,
    row.deleted ? 1 : 0,
    AT,
  );
}

function key(overrides: Partial<StableFindingKey> = {}): StableFindingKey {
  return {
    schema: "fs-finding-key/v1",
    project: PROJECT,
    purl: "pkg:generic/acme/widget@1.0.0",
    name: "Widget",
    group: "Acme",
    version: "1.0.0",
    cve: "CVE-2026-0037",
    ...overrides,
  };
}

describe("stable finding resolver tier matrix", () => {
  it("returns all duplicate purl rows in UUID order and never skips to conflicting NVG", () => {
    const db = fixture();
    insertFinding(db, { id: "uuid-z", purl: "pkg:generic/acme/widget@1.0.0", name: "Other" });
    insertFinding(db, { id: "uuid-a", purl: "pkg:generic/acme/widget@1.0.0", name: "Other" });
    insertFinding(db, { id: "uuid-nvg", purl: "pkg:generic/different@1", name: "Widget" });

    const result = resolveFinding(db, key(), PV, "any_version");
    expect(result).toMatchObject({ state: "resolved", tier: 1, reason: "purl_cve", versionChanged: false });
    if (result.state === "resolved") expect(result.rows.map(row => row.findingId)).toEqual(["uuid-a", "uuid-z"]);
  });

  it("falls through a missing or changed purl to folded NVG while keeping version exact", () => {
    const db = fixture();
    insertFinding(db, {
      id: "unicode",
      purl: null,
      name: "CAFÉ-部件",
      group: "GRÖUP",
      version: "1.0-RC",
    });
    const changedPurl = key({
      purl: "pkg:generic/old/widget@1.0-RC",
      name: "café-部件",
      group: "gröup",
      version: "1.0-RC",
    });
    expect(resolveFinding(db, changedPurl, PV, "exact_version")).toMatchObject({
      state: "resolved", tier: 2, reason: "folded_name_group_version_cve", versionChanged: false,
    });
    expect(resolveFinding(db, { ...changedPurl, version: "1.0-rc" }, PV, "exact_version")).toMatchObject({
      state: "stale", reason: "exact_version_changed",
    });
  });

  it("matches missing and empty groups identically", () => {
    const db = fixture();
    insertFinding(db, { id: "null-group", purl: null, group: null });
    expect(resolveFinding(db, key({ purl: null, group: "" }), PV, "exact_version")).toMatchObject({
      state: "resolved", tier: 2,
    });
  });

  it("gates NG on any_version and reports exact-version changes as stale", () => {
    const db = fixture();
    insertFinding(db, { id: "v3", purl: null, version: "3.0.0" });
    insertFinding(db, { id: "v2", purl: null, version: "2.0.0" });

    const exact = resolveFinding(db, key({ purl: null, version: "1.0.0" }), PV, "exact_version");
    expect(exact).toMatchObject({ state: "stale", reason: "exact_version_changed" });
    if (exact.state === "stale") expect(exact.candidates.map(row => row.findingId)).toEqual(["v2", "v3"]);

    const promoted = resolveFinding(db, key({ purl: null, version: "1.0.0" }), PV, "any_version");
    expect(promoted).toMatchObject({ state: "resolved", tier: 3, versionChanged: true });
    if (promoted.state === "resolved") expect(promoted.rows.map(row => row.findingId)).toEqual(["v2", "v3"]);
  });

  it("allows a null-version any-version key but never promotes it under exact pin", () => {
    const db = fixture();
    insertFinding(db, { id: "versioned", purl: null, version: "4.0.0" });
    expect(resolveFinding(db, key({ purl: null, version: null }), PV, "any_version")).toMatchObject({
      state: "resolved", tier: 3, versionChanged: true,
    });
    expect(resolveFinding(db, key({ purl: null, version: null }), PV, "exact_version")).toMatchObject({
      state: "stale",
    });
  });

  it("excludes CVE mismatches and soft-deleted rows", () => {
    const db = fixture();
    insertFinding(db, { id: "other-cve", cve: "CVE-OTHER", purl: "pkg:generic/acme/widget@1.0.0" });
    insertFinding(db, { id: "deleted", purl: "pkg:generic/acme/widget@1.0.0", deleted: true });
    expect(resolveFinding(db, key(), PV, "any_version")).toEqual({
      state: "orphaned", reason: "no_component_cve_match",
    });
  });

  it("reattaches a soft-delete then re-confirm cycle to the fresh UUID without writing", () => {
    const db = fixture();
    insertFinding(db, { id: "old-uuid", purl: "pkg:generic/acme/widget@1.0.0", deleted: true });
    insertFinding(db, { id: "new-uuid", purl: "pkg:generic/acme/widget@1.0.0" });
    const before = db.prepare("SELECT COUNT(*) AS count FROM findings").get() as { count: number };
    const result = resolveFinding(db, key(), PV, "exact_version");
    const after = db.prepare("SELECT COUNT(*) AS count FROM findings").get() as { count: number };
    expect(result).toMatchObject({ state: "resolved", tier: 1 });
    if (result.state === "resolved") expect(result.rows.map(row => row.findingId)).toEqual(["new-uuid"]);
    expect(after).toEqual(before);
  });
});

describe("stable finding key and pin safety", () => {
  it("round-trips separator and non-ASCII fixtures without UUID or pvId material", () => {
    const encoded = findingStableKey({
      cve: "CVE-2026-0037",
      purl: "pkg:maven/com.acmé/部件@1.0.0?repo=one/two",
      name: "ignored",
      group: null,
      version: "1.0.0",
      findingId: "ephemeral-uuid",
      pvId: "pv-secret",
    }, "purl");
    const parsed = parseEncodedFindingKey(encoded);
    expect(parsed).toEqual(parseFindingStableKey(encoded));
    expect(findingStableKey({
      cve: parsed.cve,
      purl: "purl" in parsed.component ? parsed.component.purl : null,
      name: "ignored",
      group: null,
      version: "1.0.0",
    }, parsed.tier)).toBe(encoded);
    expect(JSON.stringify(parsed)).not.toContain("ephemeral-uuid");
    expect(JSON.stringify(parsed)).not.toContain("pv-secret");
  });

  it("rejects malformed and oversized route keys as INVALID_STABLE_KEY", () => {
    for (const encoded of ["fs1.not+base64", `fs1.${"a".repeat(600)}`]) {
      expect(() => parseEncodedFindingKey(encoded)).toThrow(StableFindingKeyError);
      try {
        parseEncodedFindingKey(encoded);
      } catch (error: unknown) {
        expect(error).toMatchObject({ code: "INVALID_STABLE_KEY" });
      }
    }
  });

  it("defaults and centrally enforces CODE_NOT_REACHABLE exact pinning", () => {
    expect(enforcePin({})).toBe("exact_version");
    expect(enforcePin({ justification: "CODE_NOT_REACHABLE" })).toBe("exact_version");
    expect(enforcePin({ pin: "exact_version", justification: "CODE_NOT_REACHABLE" })).toBe("exact_version");
    expect(() => enforcePin({ pin: "any_version", justification: "CODE_NOT_REACHABLE" }))
      .toThrow(FindingPinError);
  });
});

describe("vexDecision resolver registration", () => {
  it("uses additive full identity context for lossless changed-purl NVG fallback", async () => {
    const db = fixture();
    insertFinding(db, {
      id: "current-uuid",
      purl: null,
      name: "Widget",
      group: "Acme",
      version: "1.0-RC",
    });
    const identity = {
      cve: "CVE-2026-0037",
      purl: "pkg:generic/acme/old-widget@1.0-RC",
      name: "Widget",
      group: "Acme",
      version: "1.0-RC",
    };
    const encoded = findingStableKey(identity, "purl");
    registerFindingsStableKeyStub(db);
    const resolver = registeredResolver("vexDecision");
    expect(resolver).toBeDefined();

    await expect(resolver?.(encoded, { projectId: PROJECT, projectVersionId: PV }, {
      kind: "finding",
      identity,
      pin: "exact_version",
    })).resolves.toMatchObject({
      resolved: true,
      detail: { state: "resolved", tier: 2, reason: "folded_name_group_version_cve" },
    });
    await expect(resolver?.(encoded, { projectId: PROJECT, projectVersionId: PV }))
      .resolves.toEqual({ resolved: false });
  });

  it("folds both sides for encoded-only uppercase versions instead of reporting a false orphan", async () => {
    const db = fixture();
    insertFinding(db, { id: "maven-final", purl: null, version: "4.1.0-Final" });
    const identity = {
      cve: "CVE-2026-0037",
      purl: null,
      name: "Widget",
      group: "Acme",
      version: "4.1.0-Final",
    };
    const encoded = findingStableKey({ ...identity }, "name-group-version");
    registerFindingsStableKeyStub(db);
    const result = await registeredResolver("vexDecision")?.(
      encoded,
      { projectId: PROJECT, projectVersionId: PV },
    );
    expect(result).toMatchObject({ resolved: true, detail: { state: "resolved", tier: 2 } });
    if (result?.resolved) {
      const detail = result.detail as ReturnType<typeof resolveFinding>;
      if (detail.state === "resolved") expect(detail.rows.map(row => row.findingId)).toEqual(["maven-final"]);
    }
  });

  it("returns every case-colliding encoded match while full context stays exact", async () => {
    const db = fixture();
    insertFinding(db, { id: "exact-case", purl: null, version: "1.0-RC" });
    insertFinding(db, { id: "folded-case", purl: null, version: "1.0-rc" });
    const identity = {
      cve: "CVE-2026-0037",
      purl: null,
      name: "Widget",
      group: "Acme",
      version: "1.0-RC",
    };
    const encoded = findingStableKey({ ...identity }, "name-group-version");
    expect(parseFindingStableKey(encoded).component).toMatchObject({ version: "1.0-rc" });
    registerFindingsStableKeyStub(db);
    const resolver = registeredResolver("vexDecision");

    const encodedOnly = await resolver?.(encoded, { projectId: PROJECT, projectVersionId: PV });
    expect(encodedOnly).toMatchObject({ resolved: true, detail: { state: "resolved", tier: 2 } });
    if (encodedOnly?.resolved) {
      const detail = encodedOnly.detail as ReturnType<typeof resolveFinding>;
      if (detail.state === "resolved") {
        expect(detail.rows.map(row => row.findingId)).toEqual(["exact-case", "folded-case"]);
      }
    }

    const fullDomain = await resolver?.(encoded, { projectId: PROJECT, projectVersionId: PV }, {
      kind: "finding",
      identity,
      pin: "exact_version",
    });
    expect(fullDomain).toMatchObject({ resolved: true, detail: { state: "resolved", tier: 2 } });
    if (fullDomain?.resolved) {
      const detail = fullDomain.detail as ReturnType<typeof resolveFinding>;
      if (detail.state === "resolved") expect(detail.rows.map(row => row.findingId)).toEqual(["exact-case"]);
    }
  });

  it("rejects mismatched full identity before resolution", async () => {
    const db = fixture();
    const identity = key({ purl: null });
    const encoded = findingStableKey({ ...identity }, "name-group-version");
    registerFindingsStableKeyStub(db);
    const resolver = registeredResolver("vexDecision");
    await expect(resolver?.(encoded, { projectId: PROJECT, projectVersionId: PV }, {
      kind: "finding",
      identity: { ...identity, cve: "CVE-MISMATCH" },
      pin: "exact_version",
    })).rejects.toMatchObject({ code: "INVALID_STABLE_KEY" });
  });
});
