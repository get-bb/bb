import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MIGRATIONS } from "../../../lib/store/schema.js";
import { stableKeyFor, type OverlayWriteResult } from "../overlay/index.js";
import { readOverlayFiles } from "../overlay/reader.js";
import { OverlayCasConflictError, OverlayLockHeldError } from "../overlay/writer.js";
import { applyPolicy } from "./apply.js";
import { candidatesFor, evaluatePolicy, type OverlayReader, type PolicyScope } from "./evaluate.js";
import { parseTriagePolicy, parseTriagePolicyText, type TriagePolicyV1 } from "./schema.js";

const databases: Database.Database[] = [];
const roots: string[] = [];
const scope: PolicyScope = { projectId: "project-1", projectVersionId: "pv-1", project: "project-slug" };

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function createDb(): Database.Database {
  const db = new Database(":memory:");
  databases.push(db);
  db.pragma("foreign_keys = ON");
  for (const migration of MIGRATIONS) db.exec(migration);
  db.prepare(
    `INSERT INTO pull_generation
      (project_id, project_version_id, generation_id, status, requested_kinds_json,
       started_at, completed_at, accepted_at, error)
     VALUES (?, ?, 'generation-1', 'accepted', '["finding"]', ?, ?, ?, NULL)`,
  ).run(scope.projectId, scope.projectVersionId, "2026-08-13T00:00:00Z", "2026-08-13T00:00:00Z", "2026-08-13T00:00:00Z");
  db.prepare(
    `INSERT INTO sync_state
      (project_id, project_version_id, entity_kind, accepted_generation_id,
       staging_generation_id, base_revision, staging_continuation, staged_pages,
       staged_rows, last_pull, error)
     VALUES (?, ?, 'finding', 'generation-1', NULL, 1, NULL, 0, 0, ?, NULL)`,
  ).run(scope.projectId, scope.projectVersionId, "2026-08-13T00:00:00Z");
  return db;
}

interface FindingOptions {
  name?: string;
  cve?: string;
  band?: string;
  reachability?: number | null;
  factors?: unknown;
  vulnInDataset?: boolean | null;
  kev?: boolean;
  vcKev?: boolean;
  serverStatus?: string | null;
  severity?: string;
  epss?: number | null;
  type?: string;
  cwes?: string[];
  purl?: string | null;
  version?: string | null;
}

function insertFinding(db: Database.Database, id: string, options: FindingOptions = {}): string {
  const name = options.name ?? `component-${id}`;
  const cve = options.cve ?? `CVE-2026-${id.padStart(4, "0")}`;
  const version = "version" in options ? options.version ?? null : "1.0.0";
  const purl = "purl" in options ? options.purl ?? null : `pkg:generic/${name}@${version ?? "unknown"}`;
  const component = { purl, name, group: null, version };
  const stableKey = stableKeyFor(scope.project, component, cve);
  db.prepare(
    `INSERT INTO findings
      (project_id, project_version_id, generation_id, finding_id, stable_key,
       finding_type, cve, component_name, component_version, component_purl,
       severity, band, epss_score, in_kev, in_vc_kev, reachability_score,
       reachability_factors, vuln_in_dataset, cwes, vex_status, raw, pulled_at)
     VALUES (?, ?, 'generation-1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
  ).run(
    scope.projectId,
    scope.projectVersionId,
    id,
    stableKey,
    options.type ?? "vulnerability",
    cve,
    name,
    component.version,
    component.purl,
    options.severity ?? "HIGH",
    options.band ?? "CRITICAL",
    options.epss ?? 0.7,
    options.kev ? 1 : 0,
    options.vcKev ? 1 : 0,
    options.reachability ?? -1,
    JSON.stringify(options.factors ?? ["no caller"]),
    options.vulnInDataset === null ? null : options.vulnInDataset === false ? 0 : 1,
    JSON.stringify(options.cwes ?? ["CWE-79"]),
    options.serverStatus ?? null,
    "2026-08-13T00:00:00Z",
  );
  for (const cwe of options.cwes ?? ["CWE-79"]) {
    db.prepare(
      `INSERT INTO finding_cwes
        (project_id, project_version_id, generation_id, finding_id, cwe, pulled_at)
       VALUES (?, ?, 'generation-1', ?, ?, ?)`,
    ).run(scope.projectId, scope.projectVersionId, id, cwe, "2026-08-13T00:00:00Z");
  }
  return stableKey;
}

function policy(): TriagePolicyV1 {
  return parseTriagePolicy({
    schema: "fs-triage-policy/v1",
    rules: [
      {
        name: "unreachable-not-affected",
        when: { reachability: "unreachable", vuln_in_dataset: true },
        set: {
          status: "NOT_AFFECTED",
          justification: "CODE_NOT_REACHABLE",
          reason: "Unreachable ({score}): {factors}",
          pin: "exact_version",
        },
      },
      {
        name: "critical-in-triage",
        when: { band: "CRITICAL" },
        set: { status: "IN_TRIAGE", reason: "Critical band" },
      },
    ],
    holdback: [{ kev: true }],
    options: { overwrite_existing: false },
  });
}

function noOverlay(local = new Set<string>()): OverlayReader {
  return { hasDecision: (_scope, stableKey) => local.has(stableKey) };
}

async function root(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "fs-policy-test-"));
  roots.push(directory);
  return directory;
}

function singleRulePolicyText(band: string): string {
  return `schema: fs-triage-policy/v1
rules:
  - name: selected-band
    when: {band: ${band}}
    set:
      status: NOT_AFFECTED
      justification: CODE_NOT_REACHABLE
      pin: exact_version
      reason: "Unreachable: {factors}"
holdback: []
options: {overwrite_existing: false}
`;
}

async function writePolicyFile(directory: string, text: string): Promise<void> {
  const triage = join(directory, ".fs", "triage");
  await mkdir(triage, { recursive: true });
  await writeFile(join(triage, "policy.yaml"), text, "utf8");
}

function fakeWrite(stableKey: string): OverlayWriteResult {
  return {
    file: `.fs/triage/${scope.project}/component.yaml`,
    stableKey,
    beforeSha256: null,
    afterSha256: "a".repeat(64),
    changedFields: ["status"],
    state: "dirty",
  };
}

async function previewPolicy(deps: Parameters<typeof applyPolicy>[0]): Promise<Awaited<ReturnType<typeof applyPolicy>>> {
  return applyPolicy(deps, scope, { dryRun: true });
}

async function applyPreview(
  deps: Parameters<typeof applyPolicy>[0],
  preview: Awaited<ReturnType<typeof applyPolicy>>,
): Promise<Awaited<ReturnType<typeof applyPolicy>>> {
  return applyPolicy(deps, scope, {
    dryRun: false,
    expectedPolicySha256: preview.policySha256,
    evaluated: preview,
  });
}

describe("findings policy engine", () => {
  it("validates strict selectors, templates, and overwrite_existing before evaluation", () => {
    expect(() => parseTriagePolicyText(`
schema: fs-triage-policy/v1
rules:
  - name: invalid
    when: {mystery: true}
    set: {status: IN_TRIAGE, reason: queued}
holdback: []
options: {overwrite_existing: false}
`)).toThrow(/unknown|Unrecognized/u);
    expect(() => parseTriagePolicyText(`
schema: fs-triage-policy/v1
rules:
  - name: invalid
    when: {band: CRITICAL}
    set: {status: IN_TRIAGE, reason: "unknown {vendor} evidence"}
holdback: []
options: {overwrite_existing: false}
`)).toThrow(/unknown template/u);
    expect(() => parseTriagePolicyText(`
schema: fs-triage-policy/v1
rules:
  - name: invalid
    when: {band: CRITICAL}
    set: {status: IN_TRIAGE, reason: queued}
holdback: []
options: {overwrite_existing: true}
`)).toThrow(/overwrite_existing/u);
    expect(() => parseTriagePolicy({
      schema: "fs-triage-policy/v1",
      rules: [{ name: "blanket", when: {}, set: { status: "IN_TRIAGE", reason: "queued" } }],
      holdback: [],
      options: { overwrite_existing: false },
    })).toThrow(/at least one selector/u);
  });

  it("uses deterministic first-match order, holds KEV and missing evidence, and skips existing decisions", () => {
    const db = createDb();
    const first = insertFinding(db, "1");
    const kev = insertFinding(db, "2", { reachability: 1, kev: true });
    insertFinding(db, "3", { reachability: 1, serverStatus: "IN_TRIAGE" });
    const local = insertFinding(db, "4", { reachability: 1 });
    const missingEvidence = insertFinding(db, "5", { factors: [] });

    const report = evaluatePolicy(db, noOverlay(new Set([local])), policy(), scope);
    expect(report.rules).toMatchObject([
      { name: "unreachable-not-affected", matched: 2, wouldWrite: 1, held: 1 },
      { name: "critical-in-triage", matched: 3, wouldWrite: 0, held: 1 },
    ]);
    expect(report.skippedExisting).toBe(2);
    expect(report.held).toEqual(expect.arrayContaining([
      expect.objectContaining({ stableKey: kev, rule: "holdback[0]" }),
      expect.objectContaining({ stableKey: missingEvidence, why: expect.stringContaining("missing factors") }),
    ]));
    const candidates = candidatesFor(report);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      stableKey: first,
      rule: "unreachable-not-affected",
      input: {
        pin: "exact_version",
        reason: "Unreachable (-1): [no caller]",
      },
    });
  });

  it("holds invalid NOT_AFFECTED proposals instead of writing them", () => {
    const db = createDb();
    const stableKey = insertFinding(db, "1");
    const invalid = parseTriagePolicy({
      schema: "fs-triage-policy/v1",
      rules: [{ name: "invalid", when: { band: "CRITICAL" }, set: { status: "NOT_AFFECTED", reason: "No rationale" } }],
      holdback: [],
      options: { overwrite_existing: false },
    });
    const report = evaluatePolicy(db, noOverlay(), invalid, scope);
    expect(report.rules[0]).toMatchObject({ matched: 1, held: 1, wouldWrite: 0 });
    expect(report.held).toContainEqual(expect.objectContaining({ stableKey, why: "NOT_AFFECTED requires a justification" }));
  });

  it("evaluates VC-KEV, EPSS, severity, component, finding type, and CWE selectors through bound SQL", () => {
    const db = createDb();
    insertFinding(db, "1", { vcKev: true, reachability: 1, severity: "LOW", epss: 0.1, type: "other", cwes: ["CWE-1"] });
    insertFinding(db, "2", { reachability: 1, severity: "CRITICAL", epss: 0.9, type: "other", cwes: ["CWE-2"] });
    insertFinding(db, "3", { name: "special", reachability: 1, severity: "LOW", epss: 0.1, type: "other", cwes: ["CWE-3"] });
    insertFinding(db, "4", { reachability: 1, severity: "LOW", epss: 0.1, type: "sast", cwes: ["CWE-4"] });
    insertFinding(db, "5", { reachability: 1, severity: "LOW", epss: 0.1, type: "other", cwes: ["CWE-999"] });
    const selectors = parseTriagePolicy({
      schema: "fs-triage-policy/v1",
      rules: [
        { name: "vc-kev", when: { vc_kev: true }, set: { status: "IN_TRIAGE", reason: "VC-KEV" } },
        { name: "epss-severity", when: { epss_gte: 0.8, severity: "CRITICAL" }, set: { status: "IN_TRIAGE", reason: "EPSS" } },
        { name: "component", when: { component: "special" }, set: { status: "IN_TRIAGE", reason: "Component" } },
        { name: "type", when: { finding_type: "sast" }, set: { status: "IN_TRIAGE", reason: "Type" } },
        { name: "cwe", when: { cwe: "CWE-999" }, set: { status: "IN_TRIAGE", reason: "CWE" } },
      ],
      holdback: [],
      options: { overwrite_existing: false },
    });
    const report = evaluatePolicy(db, noOverlay(), selectors, scope);
    expect(report.rules.map((rule) => [rule.name, rule.matched, rule.wouldWrite, rule.held])).toEqual([
      ["vc-kev", 1, 0, 1],
      ["epss-severity", 1, 1, 0],
      ["component", 1, 1, 0],
      ["type", 1, 1, 0],
      ["cwe", 1, 1, 0],
    ]);
  });

  it("uses the same Unicode folding for rule and holdback selectors", () => {
    const db = createDb();
    insertFinding(db, "1", { name: "Widget", band: "LOW", reachability: 1 });
    insertFinding(db, "2", { name: "accent", band: "CRÍTICO", reachability: 1 });
    const foldedPolicy = parseTriagePolicy({
      schema: "fs-triage-policy/v1",
      rules: [
        {
          name: "purl",
          when: { component: "pkg:generic/widget@1.0.0" },
          set: { status: "IN_TRIAGE", reason: "component" },
        },
        {
          name: "unicode-band",
          when: { band: "crítico" },
          set: { status: "IN_TRIAGE", reason: "band" },
        },
      ],
      holdback: [
        { component: "pkg:generic/widget@1.0.0" },
        { band: "crítico" },
      ],
      options: { overwrite_existing: false },
    });
    const report = evaluatePolicy(db, noOverlay(), foldedPolicy, scope);
    expect(report.rules).toMatchObject([
      { name: "purl", matched: 1, held: 1, wouldWrite: 0 },
      { name: "unicode-band", matched: 1, held: 1, wouldWrite: 0 },
    ]);
  });

  it("holds exact-version decisions when component version evidence is absent", () => {
    const db = createDb();
    const stableKey = insertFinding(db, "1", { purl: null, version: null });
    const report = evaluatePolicy(db, noOverlay(), policy(), scope);
    expect(report.rules[0]).toMatchObject({ matched: 1, held: 1, wouldWrite: 0 });
    expect(report.held).toContainEqual(expect.objectContaining({
      stableKey,
      why: "Exact-version policy decision requires component version evidence",
    }));
    expect(candidatesFor(report)).toHaveLength(0);
  });

  it("keeps dry-run free of YAML and SQLite mutation", async () => {
    const db = createDb();
    insertFinding(db, "1");
    const directory = await root();
    const writer = vi.fn(async (_root: string, input: Parameters<NonNullable<Parameters<typeof applyPolicy>[0]["setDecision"]>>[1]) => fakeWrite(input.stableKey));
    const before = db.serialize();
    const report = await applyPolicy({ db, root: directory, policy: policy(), setDecision: writer }, scope, { dryRun: true });
    expect(report).toMatchObject({ dryRun: true, written: 0 });
    expect(writer).not.toHaveBeenCalled();
    expect(db.serialize()).toEqual(before);
    expect(await readdir(directory)).toEqual([]);
  });

  it("writes through WP-27 and is idempotent when the overlay index has not rebuilt yet", async () => {
    const db = createDb();
    insertFinding(db, "1");
    const directory = await root();
    const deps = { db, root: directory, policy: policy() };
    const firstPreview = await previewPolicy(deps);
    const first = await applyPreview(deps, firstPreview);
    expect(first).toMatchObject({ dryRun: false, written: 1, skippedExisting: 0, errors: [] });
    const files = await readdir(join(directory, ".fs", "triage", scope.project));
    expect(files).toHaveLength(1);
    const file = files[0];
    if (file === undefined) throw new Error("Expected policy apply to write one overlay file");
    const yaml = await readFile(join(directory, ".fs", "triage", scope.project, file), "utf8");
    expect(yaml).toContain("justification: CODE_NOT_REACHABLE");
    expect(yaml).toContain("pin: exact_version");

    const secondPreview = await previewPolicy(deps);
    const second = await applyPreview(deps, secondPreview);
    expect(second).toMatchObject({ written: 0, skippedExisting: 1, errors: [] });
    expect(db.prepare("SELECT COUNT(*) AS count FROM triage_runs").get()).toEqual({ count: 2 });
  });

  it("applies the exact preview candidate set and honors the policy digest CAS", async () => {
    const db = createDb();
    const first = insertFinding(db, "1", { reachability: 1 });
    const activePolicy = policy();
    const preview = evaluatePolicy(db, noOverlay(), activePolicy, scope);
    insertFinding(db, "2", { reachability: 1 });
    const directory = await root();
    const writer = vi.fn(async (_root: string, input: Parameters<NonNullable<Parameters<typeof applyPolicy>[0]["setDecision"]>>[1]) => fakeWrite(input.stableKey));
    await expect(applyPolicy(
      { db, root: directory, policy: activePolicy, setDecision: writer },
      scope,
      { dryRun: false, expectedPolicySha256: "f".repeat(64), evaluated: preview },
    )).rejects.toMatchObject({ code: "POLICY_CAS_CONFLICT" });
    expect(writer).not.toHaveBeenCalled();

    const report = await applyPolicy(
      { db, root: directory, policy: activePolicy, setDecision: writer },
      scope,
      { dryRun: false, expectedPolicySha256: preview.policySha256, evaluated: preview },
    );
    expect(report.written).toBe(1);
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer.mock.calls[0]?.[1].stableKey).toBe(first);
  });

  it("fails closed without preview guards and rejects a policy swap across digest domains", async () => {
    const db = createDb();
    insertFinding(db, "1", { reachability: 1, band: "CRITICAL" });
    const directory = await root();
    const initial = singleRulePolicyText("NOPE");
    const changed = singleRulePolicyText("CRITICAL");
    await writePolicyFile(directory, initial);
    const writer = vi.fn(async (_root: string, input: Parameters<NonNullable<Parameters<typeof applyPolicy>[0]["setDecision"]>>[1]) => fakeWrite(input.stableKey));
    const preview = await previewPolicy({ db, root: directory, setDecision: writer });
    expect(preview.rules[0]).toMatchObject({ wouldWrite: 0 });

    await expect(Reflect.apply(applyPolicy, undefined, [
      { db, root: directory, setDecision: writer },
      scope,
      { dryRun: false },
    ])).rejects.toMatchObject({ code: "POLICY_PREVIEW_REQUIRED" });

    await writePolicyFile(directory, changed);
    await expect(applyPolicy(
      { db, root: directory, setDecision: writer },
      scope,
      { dryRun: false, expectedPolicySha256: preview.policySha256, evaluated: preview },
    )).rejects.toMatchObject({ code: "POLICY_CAS_CONFLICT" });
    expect(writer).not.toHaveBeenCalled();

    const changedPreview = await previewPolicy({ db, root: directory, setDecision: writer });
    const report = await applyPolicy(
      { db, root: directory, policy: parseTriagePolicyText(changed), setDecision: writer },
      scope,
      { dryRun: false, expectedPolicySha256: changedPreview.policySha256, evaluated: changedPreview },
    );
    expect(report.written).toBe(1);
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it("keeps 39 successes when one item has a retryable CAS conflict", async () => {
    const db = createDb();
    for (let index = 0; index < 40; index += 1) insertFinding(db, String(index), { reachability: 1 });
    const directory = await root();
    let calls = 0;
    const writer = vi.fn(async (_root: string, input: Parameters<NonNullable<Parameters<typeof applyPolicy>[0]["setDecision"]>>[1]) => {
      calls += 1;
      if (calls === 17) throw new OverlayCasConflictError("component.yaml", "a".repeat(64), "b".repeat(64));
      return fakeWrite(input.stableKey);
    });
    const readOverlays = vi.fn(readOverlayFiles);
    const deps = { db, root: directory, policy: policy(), setDecision: writer, readOverlays };
    const preview = await previewPolicy(deps);
    readOverlays.mockClear();
    const report = await applyPreview(deps, preview);
    expect(report.written).toBe(39);
    expect(report.errors).toEqual([
      expect.objectContaining({ code: "OVERLAY_CAS_CONFLICT", message: expect.stringContaining("Retryable conflict") }),
    ]);
    expect(writer).toHaveBeenCalledTimes(40);
    expect(readOverlays).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT status, written, errors FROM triage_runs").get()).toEqual({ status: "partial", written: 39, errors: 1 });
  });

  it("reads the overlay corpus once while applying a large candidate set", async () => {
    const db = createDb();
    for (let index = 0; index < 400; index += 1) insertFinding(db, String(index), { reachability: 1 });
    const directory = await root();
    const writer = vi.fn(async (_root: string, input: Parameters<NonNullable<Parameters<typeof applyPolicy>[0]["setDecision"]>>[1]) => fakeWrite(input.stableKey));
    const readOverlays = vi.fn(readOverlayFiles);
    const deps = { db, root: directory, policy: policy(), setDecision: writer, readOverlays };
    const preview = await previewPolicy(deps);
    readOverlays.mockClear();
    const report = await applyPreview(deps, preview);
    expect(report).toMatchObject({ written: 400, errors: [] });
    expect(writer).toHaveBeenCalledTimes(400);
    expect(readOverlays).toHaveBeenCalledTimes(1);
  });

  it("retries OVERLAY_LOCK_HELD with bounded backoff and does not retry CAS", async () => {
    const db = createDb();
    insertFinding(db, "1", { reachability: 1 });
    const directory = await root();
    let attempts = 0;
    const writer = vi.fn(async (_root: string, input: Parameters<NonNullable<Parameters<typeof applyPolicy>[0]["setDecision"]>>[1]) => {
      attempts += 1;
      if (attempts < 3) throw new OverlayLockHeldError("component.yaml");
      return fakeWrite(input.stableKey);
    });
    const sleep = vi.fn(async (_milliseconds: number, _signal?: AbortSignal) => undefined);
    const report = await applyPolicy(
      { db, root: directory, policy: policy(), setDecision: writer, sleep, random: () => 0 }, scope, { dryRun: true },
    );
    const applied = await applyPolicy(
      { db, root: directory, policy: policy(), setDecision: writer, sleep, random: () => 0 },
      scope,
      { dryRun: false, expectedPolicySha256: report.policySha256, evaluated: report },
    );
    expect(applied).toMatchObject({ written: 1, errors: [] });
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([25, 50]);
    expect(writer).toHaveBeenCalledTimes(3);
  });

  it("bounds samples and detailed holds for large match sets", () => {
    const db = createDb();
    for (let index = 0; index < 140; index += 1) insertFinding(db, String(index), { kev: true, reachability: 1 });
    const report = evaluatePolicy(db, noOverlay(), policy(), scope);
    expect(report.rules[1]).toMatchObject({ matched: 140, held: 140 });
    expect(report.rules[1]?.samples).toHaveLength(5);
    expect(report.held).toHaveLength(100);
  });
});
