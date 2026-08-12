import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import {
  normalizeForgeJobSnapshot,
  type ForgeJobCandidate,
} from "../../lib/remote/types.js";
import { generateFixtureCorpus } from "./generate-seed.js";
import {
  DEFAULT_FIXTURE_SEED,
  FIXTURE_SCHEMA_VERSION,
  type FixtureManifest,
} from "./seed-schema.js";

interface IdentityFixture {
  organization: { id: string };
  project: { id: string; orgId: string };
  versions: { id: string; projectId: string; priorVersionId: string | null; scanId: string }[];
}

interface ComponentFixture {
  id: string;
  name: string;
  version: string;
  purl: string | null;
  fallbackIdentity: string | null;
  vulnerable: boolean;
}

interface FindingFixture {
  id: string;
  projectVersionId: string;
  componentId: string;
  componentPurl: string | null;
  componentFallbackIdentity: string | null;
  cve: string;
}

interface AsEntityFixture {
  id: string;
  projectId: string;
  kind: string;
  reviewVersion: string;
  fields: Record<string, string | string[]>;
}

interface TaraDriftFixture {
  entityId: string;
  field: string;
  base: string;
  expectedHeadVersionId: string;
  remoteHeadVersionId: string;
}

interface RequirementFixture {
  id: string;
  projectId: string;
  fields: { threatIds: string[]; sourceRef: string };
}

interface VerificationFixture {
  id: string;
  projectId: string;
  requirementId: string;
  results: { evidenceId: string }[];
}

interface FirmwareFixture {
  path: string;
  scanId: string;
  byteSample: string | null;
}

interface IdentityLinksFixture {
  orgId: string;
  projectId: string;
  projectVersionId: string;
  priorVersionId: string;
  scanId: string;
  priorScanId: string;
  firmwareRootHash: string;
}

interface FirmwareResponseFixture {
  projectVersionId: string;
  scanId: string;
  artifactHash: string;
  entries: FirmwareFixture[];
  total: number;
}

interface SbomFixture {
  components: {
    "bom-ref": string;
    name: string;
    version: string;
    purl: string | null;
  }[];
}

interface DocumentFixture {
  id: string;
  projectId: string;
  status: string;
  sourceRefs: string[];
}

interface BenchRunFixture {
  id: string;
  projectVersionId: string;
  status: string;
  requirementIds: string[];
  evidenceIds: string[];
}

interface AttestationFixture {
  id: string;
  runId: string;
  requirementIds: string[];
}

interface HbomClaimFixture {
  id: string;
  componentId: string;
  sourceRef: string;
}

interface SourceExtractFixture {
  id: string;
  documentId: string;
  target: string;
}

interface ForgeJobFixture extends Omit<ForgeJobCandidate, "scope"> {
  scope: { projectId: string; projectVersionId: string };
}

interface VexBulkFixture {
  status: string;
  summary: { total: number; succeeded: number; failed: number };
  results: { findingId: string; success: boolean }[];
}

const committedFixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
const temporaryRoots: string[] = [];

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "finite-state-seed-test-"));
  temporaryRoots.push(root);
  return root;
}

async function parseJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function parseJsonl<T>(path: string): Promise<T[]> {
  return (await readFile(path, "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as T);
}

async function relativeFiles(root: string, current = root): Promise<string[]> {
  const files: string[] = [];
  for (const name of (await readdir(current)).sort(compareText)) {
    const fullPath = join(current, name);
    if ((await lstat(fullPath)).isDirectory()) files.push(...(await relativeFiles(root, fullPath)));
    else files.push(relative(root, fullPath).split(sep).join("/"));
  }
  return files;
}

async function byteSnapshot(root: string): Promise<Map<string, Buffer>> {
  const snapshot = new Map<string, Buffer>();
  for (const path of await relativeFiles(root)) {
    snapshot.set(path, await readFile(join(root, ...path.split("/"))));
  }
  return snapshot;
}

async function runGeneratorCli(args: string[]): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  const executable = fileURLToPath(
    new URL("../../../../node_modules/.bin/tsx", import.meta.url),
  );
  const generator = fileURLToPath(new URL("./generate-seed.ts", import.meta.url));
  return await new Promise((resolveResult, reject) => {
    const child = spawn(executable, [generator, ...args], { stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolveResult({ exitCode, stdout, stderr }));
  });
}

function expectReference(targets: Set<string>, reference: string, source: string): void {
  expect(targets.has(reference), `${source} references missing target ${reference}`).toBe(true);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("deterministic-seed-corpus", () => {
  test("two generations have identical manifest and bytes", async () => {
    const firstRoot = await temporaryDirectory();
    const secondRoot = await temporaryDirectory();
    const firstOut = join(firstRoot, "fixtures");
    const secondOut = join(secondRoot, "fixtures");

    const first = await generateFixtureCorpus({ seed: DEFAULT_FIXTURE_SEED, outDir: firstOut, check: false });
    const second = await generateFixtureCorpus({ seed: DEFAULT_FIXTURE_SEED, outDir: secondOut, check: false });

    expect(first).toEqual(second);
    expect(await byteSnapshot(firstOut)).toEqual(await byteSnapshot(secondOut));
    expect(first.schemaVersion).toBe(FIXTURE_SCHEMA_VERSION);
  }, 30_000);

  test("committed manifest hashes, logical counts, and bounded size are exact", async () => {
    const manifest = await parseJson<FixtureManifest>(join(committedFixtures, "manifest.json"));
    const findings = await parseJsonl<FindingFixture>(join(committedFixtures, "platform", "findings.jsonl"));
    const components = await parseJsonl<ComponentFixture>(join(committedFixtures, "platform", "components.jsonl"));
    const entities = await parseJsonl<AsEntityFixture>(join(committedFixtures, "assurance-studio", "entities.jsonl"));
    const requirements = await parseJsonl<RequirementFixture>(join(committedFixtures, "assurance-studio", "requirements.jsonl"));
    const firmware = await parseJsonl<FirmwareFixture>(join(committedFixtures, "firmware", "manifest.jsonl"));
    const documents = await parseJson<{ items: DocumentFixture[] }>(join(committedFixtures, "documents", "documents.json"));
    expect(manifest.counts).toEqual({
      findings: new Set(findings.map((finding) => finding.id)).size,
      components: components.filter((component) => component.vulnerable).length,
      sbomComponents: components.length,
      taraNodes: entities.filter((entity) => entity.kind === "component").length,
      requirements: requirements.length,
      firmwarePaths: firmware.length,
      documents: documents.items.length,
    });
    expect(manifest.counts.findings).toBeGreaterThanOrEqual(4_000);
    expect(manifest.counts.components).toBeGreaterThanOrEqual(180);
    expect(manifest.counts.sbomComponents).toBeGreaterThanOrEqual(900);
    expect(manifest.counts.taraNodes).toBeGreaterThanOrEqual(12);
    expect(manifest.counts.requirements).toBeGreaterThanOrEqual(40);
    expect(manifest.counts.firmwarePaths).toBeGreaterThanOrEqual(6_000);
    expect(manifest.counts.documents).toBeGreaterThanOrEqual(6);

    const listedPaths = new Set(manifest.files.map((file) => file.path));
    const actualPaths = (await relativeFiles(committedFixtures)).filter((path) => path !== "manifest.json");
    expect(listedPaths).toEqual(new Set(actualPaths));
    let corpusBytes = (await stat(join(committedFixtures, "manifest.json"))).size;
    for (const file of manifest.files) {
      const bytes = await readFile(join(committedFixtures, ...file.path.split("/")));
      corpusBytes += bytes.byteLength;
      expect(bytes.byteLength, file.path).toBe(file.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), file.path).toBe(file.sha256);
      if (file.rows !== undefined) {
        const lineCount = (await readFile(join(committedFixtures, ...file.path.split("/")), "utf8")).trimEnd().split("\n").length;
        expect(lineCount, file.path).toBe(file.rows);
      }
    }
    expect(corpusBytes).toBeLessThan(4 * 1024 * 1024);
    expect((await relativeFiles(join(committedFixtures, "firmware", "bytes"))).length).toBe(2);
    expect(await readFile(join(committedFixtures, ".gitattributes"), "utf8")).toBe(
      "*.bin binary\n",
    );
  });

  test("all references resolve with source-specific diagnostics", async () => {
    const identity = await parseJson<IdentityFixture>(join(committedFixtures, "platform", "identity.json"));
    const components = await parseJsonl<ComponentFixture>(join(committedFixtures, "platform", "components.jsonl"));
    const findings = await parseJsonl<FindingFixture>(join(committedFixtures, "platform", "findings.jsonl"));
    const entities = await parseJsonl<AsEntityFixture>(join(committedFixtures, "assurance-studio", "entities.jsonl"));
    const requirements = await parseJsonl<RequirementFixture>(join(committedFixtures, "assurance-studio", "requirements.jsonl"));
    const checks = await parseJsonl<VerificationFixture>(join(committedFixtures, "assurance-studio", "verification-checks.jsonl"));
    const firmware = await parseJsonl<FirmwareFixture>(join(committedFixtures, "firmware", "manifest.jsonl"));
    const documentEnvelope = await parseJson<{ items: DocumentFixture[] }>(join(committedFixtures, "documents", "documents.json"));
    const runs = await parseJsonl<BenchRunFixture>(join(committedFixtures, "expected", "bench-runs.jsonl"));
    const attestations = await parseJsonl<AttestationFixture>(join(committedFixtures, "expected", "attestations.jsonl"));
    const hBomClaims = await parseJson<{ claims: HbomClaimFixture[] }>(join(committedFixtures, "documents", "hbom-claims.json"));
    const extracts = await parseJsonl<SourceExtractFixture>(join(committedFixtures, "documents", "source-extracts.jsonl"));
    const vex = await parseJson<VexBulkFixture>(join(committedFixtures, "platform", "vex-bulk-partial.json"));
    const forgeJobs = await parseJsonl<ForgeJobFixture>(join(committedFixtures, "forge-compute", "jobs.jsonl"));
    const identityLinks = await parseJson<IdentityLinksFixture>(join(committedFixtures, "expected", "identity-links.json"));
    const filesystemResponse = await parseJson<FirmwareResponseFixture>(join(committedFixtures, "firmware", "filesystem-response.json"));
    const sbom = await parseJson<SbomFixture>(join(committedFixtures, "platform", "sbom.cdx.json"));
    const findingsPage = await parseJson<{ items: FindingFixture[]; total: number }>(join(committedFixtures, "platform", "findings-page-1.json"));
    const componentsPage = await parseJson<{ items: ComponentFixture[]; total: number }>(join(committedFixtures, "platform", "components-page-1.json"));
    const asSbomPage = await parseJson<{ success: boolean; data: { items: ComponentFixture[]; total: number } }>(join(committedFixtures, "assurance-studio", "project-sbom-page-1.json"));
    const strictUnknownKey = await parseJson<{ projectVersionId: string; findingId: string }>(join(committedFixtures, "faults", "strict-unknown-key.json"));
    const staleTara = await parseJson<{ entityId: string }>(join(committedFixtures, "faults", "assurance-studio-stale-tara.json"));

    expectReference(new Set([identity.organization.id]), identity.project.orgId, "platform/identity.json project");
    const projectIds = new Set([identity.project.id]);
    const versionIds = new Set(identity.versions.map((version) => version.id));
    const scanIds = new Set(identity.versions.map((version) => version.scanId));
    for (const version of identity.versions) {
      expectReference(projectIds, version.projectId, `platform/identity.json version ${version.id}`);
      if (version.priorVersionId) expectReference(versionIds, version.priorVersionId, `platform/identity.json version ${version.id}`);
    }
    expect(identityLinks).toMatchObject({
      orgId: identity.organization.id,
      projectId: identity.project.id,
      projectVersionId: identity.versions[1].id,
      priorVersionId: identity.versions[0].id,
      scanId: identity.versions[1].scanId,
      priorScanId: identity.versions[0].scanId,
    });

    const componentIds = new Set(components.map((component) => component.id));
    const componentPurls = new Set(components.flatMap((component) => component.purl ? [component.purl] : []));
    const fallbackIdentities = new Set(components.flatMap((component) => component.fallbackIdentity ? [component.fallbackIdentity] : []));
    for (const finding of findings) {
      expectReference(versionIds, finding.projectVersionId, `platform/findings.jsonl finding ${finding.id}`);
      expectReference(componentIds, finding.componentId, `platform/findings.jsonl finding ${finding.id}`);
      if (finding.componentPurl) expectReference(componentPurls, finding.componentPurl, `platform/findings.jsonl finding ${finding.id}`);
      if (finding.componentFallbackIdentity) expectReference(fallbackIdentities, finding.componentFallbackIdentity, `platform/findings.jsonl finding ${finding.id}`);
    }
    const findingIds = new Set(findings.map((finding) => finding.id));
    for (const result of vex.results) expectReference(findingIds, result.findingId, "platform/vex-bulk-partial.json results");
    expect(findingsPage.items).toEqual(findings.slice(0, findingsPage.items.length));
    expect(findingsPage.total).toBe(new Set(findings.map((finding) => finding.id)).size);
    expect(componentsPage.items).toEqual(components.slice(0, componentsPage.items.length));
    expect(componentsPage.total).toBe(components.length);
    expect(asSbomPage.success).toBe(true);
    expect(asSbomPage.data.items).toEqual(components.slice(0, asSbomPage.data.items.length));
    expect(asSbomPage.data.total).toBe(components.length);
    expect(sbom.components).toHaveLength(components.length);
    for (const [index, sbomComponent] of sbom.components.entries()) {
      const component = components[index];
      expect(sbomComponent, `platform/sbom.cdx.json component ${index}`).toEqual({
        "bom-ref": component.id,
        name: component.name,
        version: component.version,
        purl: component.purl,
      });
      expectReference(componentIds, sbomComponent["bom-ref"], `platform/sbom.cdx.json component ${index}.bom-ref`);
      if (sbomComponent.purl) expectReference(componentPurls, sbomComponent.purl, `platform/sbom.cdx.json component ${index}.purl`);
    }
    expectReference(versionIds, strictUnknownKey.projectVersionId, "faults/strict-unknown-key.json projectVersionId");
    expectReference(findingIds, strictUnknownKey.findingId, "faults/strict-unknown-key.json findingId");

    const entityIds = new Set(entities.map((entity) => entity.id));
    const componentOrEntityIds = new Set([...componentIds, ...entityIds]);
    const threatIds = new Set(entities.filter((entity) => entity.kind === "threat").map((entity) => entity.id));
    const assetIds = new Set(entities.filter((entity) => entity.kind === "asset").map((entity) => entity.id));
    const zoneIds = new Set(entities.filter((entity) => entity.kind === "zone").map((entity) => entity.id));
    const dataflowIds = new Set(entities.filter((entity) => entity.kind === "dataflow").map((entity) => entity.id));
    expectReference(entityIds, staleTara.entityId, "faults/assurance-studio-stale-tara.json entityId");
    for (const entity of entities) {
      expectReference(projectIds, entity.projectId, `assurance-studio/entities.jsonl entity ${entity.id}`);
      for (const [field, targets] of [["componentId", componentOrEntityIds], ["sourceId", entityIds], ["targetId", entityIds], ["zoneId", zoneIds], ["assetId", assetIds], ["threatId", threatIds]] as const) {
        const reference = entity.fields[field];
        if (typeof reference === "string") expectReference(targets, reference, `assurance-studio/entities.jsonl entity ${entity.id}.${field}`);
      }
      for (const [field, targets] of [["threatIds", threatIds], ["dataflowIds", dataflowIds]] as const) {
        const references = entity.fields[field];
        if (Array.isArray(references)) for (const reference of references) expectReference(targets, reference, `assurance-studio/entities.jsonl entity ${entity.id}.${field}`);
      }
    }

    const requirementIds = new Set(requirements.map((requirement) => requirement.id));
    const documentIds = new Set(documentEnvelope.items.map((document) => document.id));
    const evidenceIds = new Set(checks.flatMap((check) => check.results.map((result) => result.evidenceId)));
    for (const requirement of requirements) {
      expectReference(projectIds, requirement.projectId, `assurance-studio/requirements.jsonl ${requirement.id}`);
      for (const threatId of requirement.fields.threatIds) expectReference(threatIds, threatId, `assurance-studio/requirements.jsonl ${requirement.id}`);
      expectReference(documentIds, requirement.fields.sourceRef.split("#")[0], `assurance-studio/requirements.jsonl ${requirement.id}.sourceRef`);
    }
    for (const check of checks) {
      expectReference(projectIds, check.projectId, `assurance-studio/verification-checks.jsonl ${check.id}`);
      expectReference(requirementIds, check.requirementId, `assurance-studio/verification-checks.jsonl ${check.id}`);
    }
    for (const path of firmware) {
      expectReference(scanIds, path.scanId, `firmware/manifest.jsonl ${path.path}`);
      if (path.byteSample) expect((await stat(join(committedFixtures, ...path.byteSample.split("/")))).isFile(), `firmware/manifest.jsonl ${path.path} missing ${path.byteSample}`).toBe(true);
    }
    expectReference(versionIds, filesystemResponse.projectVersionId, "firmware/filesystem-response.json projectVersionId");
    expectReference(scanIds, filesystemResponse.scanId, "firmware/filesystem-response.json scanId");
    expect(filesystemResponse.artifactHash).toBe(identityLinks.firmwareRootHash);
    expect(filesystemResponse.entries).toEqual(firmware.slice(0, filesystemResponse.entries.length));
    expect(filesystemResponse.total).toBe(firmware.length);
    for (const document of documentEnvelope.items) {
      expectReference(projectIds, document.projectId, `documents/documents.json ${document.id}`);
      for (const sourceRef of document.sourceRefs) expectReference(requirementIds, sourceRef.split(":")[0], `documents/documents.json ${document.id}.sourceRefs`);
    }
    for (const claim of hBomClaims.claims) {
      expectReference(entityIds, claim.componentId, `documents/hbom-claims.json ${claim.id}`);
      expectReference(documentIds, claim.sourceRef.split("#")[0], `documents/hbom-claims.json ${claim.id}.sourceRef`);
    }
    for (const extract of extracts) {
      expectReference(documentIds, extract.documentId, `documents/source-extracts.jsonl ${extract.id}`);
      expectReference(new Set([...requirementIds, ...entityIds]), extract.target, `documents/source-extracts.jsonl ${extract.id}.target`);
    }
    const runIds = new Set(runs.map((run) => run.id));
    for (const run of runs) {
      expectReference(versionIds, run.projectVersionId, `expected/bench-runs.jsonl ${run.id}`);
      for (const requirementId of run.requirementIds) expectReference(requirementIds, requirementId, `expected/bench-runs.jsonl ${run.id}`);
      for (const evidenceId of run.evidenceIds) expectReference(evidenceIds, evidenceId, `expected/bench-runs.jsonl ${run.id}`);
    }
    for (const attestation of attestations) {
      expectReference(runIds, attestation.runId, `expected/attestations.jsonl ${attestation.id}`);
      for (const requirementId of attestation.requirementIds) expectReference(requirementIds, requirementId, `expected/attestations.jsonl ${attestation.id}`);
    }
    for (const job of forgeJobs) {
      expectReference(projectIds, job.scope.projectId, `forge-compute/jobs.jsonl ${job.jobId}.scope.projectId`);
      expectReference(versionIds, job.scope.projectVersionId, `forge-compute/jobs.jsonl ${job.jobId}.scope.projectVersionId`);
      if (job.runId) expectReference(runIds, job.runId, `forge-compute/jobs.jsonl ${job.jobId}.runId`);
    }
  });

  test("required awkward cases exist once and every case file is addressable", async () => {
    const manifest = await parseJson<FixtureManifest>(join(committedFixtures, "manifest.json"));
    const expectedCaseIds = [
      "binary-firmware-file",
      "component-without-purl",
      "conflicting-hbom-claims",
      "duplicate-finding-row",
      "firmware-symlink",
      "firmware-unpack-error",
      "non-ascii-names",
      "partial-vex-failure",
      "requirement-without-verification",
      "same-field-tara-drift",
      "soft-delete-then-reconfirm",
      "strict-unknown-key",
      "version-changed-component",
      "withdrawn-document",
      "zero-byte-firmware-file",
    ];
    expect(Object.keys(manifest.cases).sort(compareText)).toEqual(expectedCaseIds);
    const fixturePaths = new Set(await relativeFiles(committedFixtures));
    for (const [caseId, fixtureCase] of Object.entries(manifest.cases)) {
      expect(fixtureCase.refs.length, caseId).toBeGreaterThan(0);
      for (const reference of fixtureCase.refs) {
        expectReference(fixturePaths, reference.split("#")[0], `cases.json ${caseId}`);
      }
    }

    const findings = await parseJsonl<FindingFixture>(join(committedFixtures, "platform", "findings.jsonl"));
    const findingCounts = new Map<string, number>();
    for (const finding of findings) findingCounts.set(finding.id, (findingCounts.get(finding.id) ?? 0) + 1);
    expect([...findingCounts.values()].filter((count) => count === 2)).toHaveLength(1);
    expect([...findingCounts.values()].filter((count) => count > 2)).toHaveLength(0);

    const components = await parseJsonl<ComponentFixture>(join(committedFixtures, "platform", "components.jsonl"));
    expect(components.filter((component) => component.purl === null && component.fallbackIdentity !== null)).toHaveLength(1);
    const requirements = await parseJsonl<RequirementFixture>(join(committedFixtures, "assurance-studio", "requirements.jsonl"));
    const checks = await parseJsonl<VerificationFixture>(join(committedFixtures, "assurance-studio", "verification-checks.jsonl"));
    expect(requirements.filter((requirement) => !checks.some((check) => check.requirementId === requirement.id))).toHaveLength(1);
    const firmware = await parseJsonl<{ kind: string; errors: string[] }>(join(committedFixtures, "firmware", "manifest.jsonl"));
    expect(firmware.filter((entry) => entry.kind === "symlink")).toHaveLength(1);
    expect(firmware.filter((entry) => entry.errors.length > 0)).toHaveLength(1);
    const documents = await parseJson<{ items: DocumentFixture[] }>(join(committedFixtures, "documents", "documents.json"));
    expect(documents.items.filter((document) => document.status === "withdrawn")).toHaveLength(1);
  });

  test("raw fixtures preserve verified service quirks and optional compute isolation", async () => {
    const detail = await parseJson<{ cves: Record<string, object> }>(join(committedFixtures, "platform", "finding-detail.json"));
    expect(Array.isArray(detail.cves)).toBe(false);
    expect(Object.keys(detail.cves)[0]).toMatch(/^CVE-/);

    const summary = await parseJson<{ bySeverity: Record<string, number>; total: number }>(join(committedFixtures, "platform", "findings-summary.json"));
    expect(Object.values(summary.bySeverity).reduce((sum, value) => sum + value, 0)).toBe(summary.total);

    const asPage = await parseJson<{ success: boolean; data: { items: object[]; total: number; page: number; pageSize: number; hasMore: boolean } }>(join(committedFixtures, "assurance-studio", "entities-page-1.json"));
    expect(asPage).toMatchObject({ success: true, data: { page: 1, pageSize: 25, hasMore: true } });
    expect(asPage.data.total).toBeGreaterThan(asPage.data.items.length);
    const entities = await parseJsonl<AsEntityFixture>(join(committedFixtures, "assurance-studio", "entities.jsonl"));
    const precisionRevision = entities.find(
      (entity) => BigInt(entity.reviewVersion) > BigInt(Number.MAX_SAFE_INTEGER),
    );
    expect(precisionRevision?.reviewVersion).toBe("9007199254740993");
    const taraDrift = await parseJson<TaraDriftFixture>(
      join(committedFixtures, "assurance-studio", "tara-drift.json"),
    );
    const taraEntity = entities.find((entity) => entity.id === taraDrift.entityId);
    expect(taraDrift.base).toBe(taraEntity?.fields[taraDrift.field]);
    expect(taraDrift.expectedHeadVersionId).not.toBe(taraEntity?.reviewVersion);
    expect(taraDrift.expectedHeadVersionId).toBe("9007199254740996");
    expect(taraDrift.remoteHeadVersionId).toBe("9007199254740997");
    expect(BigInt(taraDrift.remoteHeadVersionId)).toBeGreaterThan(
      BigInt(taraDrift.expectedHeadVersionId),
    );
    expect(Number(taraDrift.expectedHeadVersionId)).toBe(
      Number(taraDrift.remoteHeadVersionId),
    );

    const vex = await parseJson<VexBulkFixture>(join(committedFixtures, "platform", "vex-bulk-partial.json"));
    expect(vex.status).toBe("partial_success");
    expect(vex.summary).toEqual({ total: 5, succeeded: 3, failed: 2 });
    expect(vex.results.filter((result) => result.success)).toHaveLength(3);

    expect((await readFile(join(committedFixtures, "platform", "vex-export.csv"), "utf8")).toString()).toMatch(/# rows_written=25 rows_skipped=2\n$/);
    const jobs = await parseJsonl<ForgeJobFixture>(join(committedFixtures, "forge-compute", "jobs.jsonl"));
    expect(new Set(jobs.map((job) => job.status))).toEqual(new Set(["RUNNING", "COMPLETED", "FAILED", "TIMEOUT", "CANCELLED"]));
    const cancelled = jobs.find((job) => job.status === "CANCELLED");
    expect(cancelled).toBeDefined();
    if (cancelled) {
      expect(normalizeForgeJobSnapshot(cancelled)).toMatchObject({
        status: "FAILED",
        error: {
          code: "FORGE_JOB_CANCELLED",
          message: "Fixture cancelled by operator",
        },
      });
    }
    const nonForgeFiles = (await relativeFiles(committedFixtures)).filter((path) => !path.startsWith("forge-compute/") && !path.endsWith("manifest.json"));
    for (const path of nonForgeFiles) {
      const bytes = await readFile(join(committedFixtures, ...path.split("/")));
      expect(bytes.includes(Buffer.from("forge-job-")), path).toBe(false);
    }
  });

  test("different seed changes hashes but preserves schema and count invariants", async () => {
    const firstRoot = await temporaryDirectory();
    const secondRoot = await temporaryDirectory();
    const first = await generateFixtureCorpus({ seed: DEFAULT_FIXTURE_SEED, outDir: join(firstRoot, "fixtures"), check: false });
    const second = await generateFixtureCorpus({ seed: "finite-state-eagle-alternate", outDir: join(secondRoot, "fixtures"), check: false });
    expect(second.schemaVersion).toBe(first.schemaVersion);
    expect(second.fixedNow).toBe(first.fixedNow);
    expect(second.counts).toEqual(first.counts);
    expect(second.files.map((file) => file.path)).toEqual(first.files.map((file) => file.path));
    expect(second.files.filter((file, index) => file.sha256 !== first.files[index].sha256).length).toBe(21);
  });

  test("unknown CLI arguments emit one typed diagnostic without a stack", async () => {
    const result = await runGeneratorCli(["--unknown-fixture-option"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "FixtureGenerationError [INVALID_ARGUMENT]: Unknown or incomplete argument: --unknown-fixture-option\n",
    );
    expect(result.stderr).not.toContain("at parseCli");
  });

  test("--seed rejects an option as its value without writing", async () => {
    const root = await temporaryDirectory();
    const outDir = join(root, "fixtures");
    const result = await runGeneratorCli(["--seed", "--check", "--out", outDir]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "FixtureGenerationError [INVALID_ARGUMENT]: Unknown or incomplete argument: --seed\n",
    );
    await expect(stat(outDir)).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  });

  test("--check detects one-byte drift and does not overwrite it", async () => {
    const root = await temporaryDirectory();
    const outDir = join(root, "fixtures");
    await generateFixtureCorpus({ seed: DEFAULT_FIXTURE_SEED, outDir, check: false });
    const driftedPath = join(outDir, "platform", "findings-summary.json");
    const original = await readFile(driftedPath);
    const drifted = Buffer.concat([original.subarray(0, original.length - 1), Buffer.from(" \n")]);
    await writeFile(driftedPath, drifted);

    await expect(generateFixtureCorpus({ seed: DEFAULT_FIXTURE_SEED, outDir, check: true })).rejects.toMatchObject({
      name: "FixtureGenerationError",
      code: "FIXTURE_DRIFT",
    });
    expect(await readFile(driftedPath)).toEqual(drifted);
  });

  test("invalid output path or seed fails with a typed message and leaves no partial corpus", async () => {
    const root = await temporaryDirectory();
    const invalidOutput = join(root, "not-a-directory");
    await writeFile(invalidOutput, "occupied");
    await expect(generateFixtureCorpus({ seed: DEFAULT_FIXTURE_SEED, outDir: invalidOutput, check: false })).rejects.toMatchObject({
      name: "FixtureGenerationError",
      code: "INVALID_OUTPUT",
    });
    expect(await readFile(invalidOutput, "utf8")).toBe("occupied");

    const untouchedOutput = join(root, "untouched-fixtures");
    await expect(generateFixtureCorpus({ seed: " bad-seed", outDir: untouchedOutput, check: false })).rejects.toMatchObject({
      name: "FixtureGenerationError",
      code: "INVALID_SEED",
    });
    await expect(stat(untouchedOutput)).rejects.toThrow();
    expect((await readdir(root)).sort(compareText)).toEqual(["not-a-directory"]);
  });

  test("fixtures contain no secret-like tokens, host paths, wall-clock timestamps, or CRLF", async () => {
    const manifest = await parseJson<FixtureManifest>(join(committedFixtures, "manifest.json"));
    const currentDate = new Date().toISOString().slice(0, 10);
    const textExtensions = new Set([".json", ".jsonl", ".csv", ".md"]);
    for (const path of await relativeFiles(committedFixtures)) {
      const extension = path.slice(path.lastIndexOf("."));
      if (!textExtensions.has(extension)) continue;
      const contents = await readFile(join(committedFixtures, ...path.split("/")), "utf8");
      expect(contents.includes("\r"), path).toBe(false);
      expect(contents, path).not.toMatch(/(?:\/Users\/|\/home\/|[A-Z]:\\|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|gh[opsu]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,})/);
      if (currentDate !== manifest.fixedNow.slice(0, 10)) expect(contents, path).not.toContain(currentDate);
      for (const timestamp of contents.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g)) {
        expect(timestamp[0], `${path} contains timestamp outside fixed clock`).toBe(manifest.fixedNow);
      }
    }
  });
});
