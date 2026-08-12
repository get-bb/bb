import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_FIXTURE_SEED,
  FIXTURE_SCHEMA_VERSION,
  FixtureGenerationError,
  type FixtureManifest,
  type GenerateOptions,
} from "./seed-schema.js";

const FIXED_NOW = "2026-05-12T14:30:00.000Z";
const COUNTS = {
  findings: 4_000,
  components: 180,
  sbomComponents: 900,
  taraNodes: 12,
  requirements: 40,
  firmwarePaths: 6_000,
  documents: 6,
} as const;

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

interface FileDraft {
  path: string;
  bytes: Uint8Array;
  rows?: number;
}

interface ComponentRecord extends Record<string, JsonValue> {
  id: string;
  name: string;
  version: string;
  priorVersion: string | null;
  purl: string | null;
  fallbackIdentity: string | null;
  vulnerable: boolean;
}

interface FindingRecord extends Record<string, JsonValue> {
  id: string;
  projectVersionId: string;
  componentId: string;
  componentPurl: string | null;
  componentFallbackIdentity: string | null;
  cve: string;
  severity: string;
  title: string;
  vexStatus: string | null;
  updatedAt: string;
}

const encoder = new TextEncoder();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashText(value: string): string {
  return hashBytes(encoder.encode(value));
}

function stableJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => [key, stableJsonValue(item)]),
  );
}

function json(value: JsonValue): Uint8Array {
  return encoder.encode(`${JSON.stringify(stableJsonValue(value), null, 2)}\n`);
}

function jsonl(values: JsonValue[]): Uint8Array {
  return encoder.encode(
    `${values.map((value) => JSON.stringify(stableJsonValue(value))).join("\n")}\n`,
  );
}

function text(value: string): Uint8Array {
  return encoder.encode(value.replaceAll("\r\n", "\n"));
}

function seedToUint32(seed: string): number {
  let state = 0x811c9dc5;
  for (const byte of encoder.encode(`${FIXTURE_SCHEMA_VERSION}:${seed}`)) {
    state ^= byte;
    state = Math.imul(state, 0x01000193);
  }
  return state >>> 0;
}

function seededRandom(seed: string): () => number {
  let state = seedToUint32(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function seededHex(seed: string, label: string): string {
  return hashText(`${FIXTURE_SCHEMA_VERSION}:${seed}:${label}`);
}

function validateSeed(seed: string): void {
  if (
    seed.length === 0 ||
    seed.length > 128 ||
    seed.trim() !== seed ||
    /[\u0000-\u001f\u007f]/.test(seed)
  ) {
    throw new FixtureGenerationError(
      "INVALID_SEED",
      "Fixture seed must be 1-128 visible characters with no surrounding whitespace",
    );
  }
}

function buildCorpus(seed: string): {
  drafts: FileDraft[];
  cases: FixtureManifest["cases"];
  counts: FixtureManifest["counts"];
} {
  const random = seededRandom(seed);
  const orgId = `org-${seededHex(seed, "org").slice(0, 12)}`;
  const projectId = `project-${seededHex(seed, "project").slice(0, 12)}`;
  const projectVersionId = `pv-${seededHex(seed, "current-version").slice(0, 12)}`;
  const priorVersionId = `pv-${seededHex(seed, "prior-version").slice(0, 12)}`;
  const scanId = `scan-${seededHex(seed, "scan-current").slice(0, 12)}`;
  const priorScanId = `scan-${seededHex(seed, "scan-prior").slice(0, 12)}`;

  const components: ComponentRecord[] = Array.from(
    { length: COUNTS.sbomComponents },
    (_, index) => {
      const number = index + 1;
      const missingPurl = index === 4;
      const name = index === 8 ? "münchen-µtls" : `eagle-component-${number.toString().padStart(3, "0")}`;
      const version = index === 1 ? "2.0.0" : `1.${index % 17}.${index % 11}`;
      return {
        id: `component-${number.toString().padStart(4, "0")}`,
        name,
        version,
        priorVersion: index === 1 ? "1.9.7" : version,
        purl: missingPurl
          ? null
          : `pkg:generic/${encodeURIComponent(name)}@${version}`,
        fallbackIdentity: missingPurl
          ? `sha256:${seededHex(seed, `component-fallback-${number}`)}`
          : null,
        vulnerable: index < COUNTS.components,
      };
    },
  );

  const severities = ["critical", "high", "medium", "low"];
  const findings: FindingRecord[] = Array.from(
    { length: COUNTS.findings },
    (_, index) => {
      const component = components[index % COUNTS.components];
      const cveYear = 2020 + (index % 7);
      return {
        id: (8_000_000_000_000_000_000n + BigInt(index)).toString(),
        projectVersionId,
        componentId: component.id,
        componentPurl: component.purl,
        componentFallbackIdentity: component.fallbackIdentity,
        cve: `CVE-${cveYear}-${(10_000 + index).toString().padStart(5, "0")}`,
        severity: severities[index % severities.length],
        title: index === 8 ? "Überlauf in München gateway" : `Generated finding ${index + 1}`,
        vexStatus: index % 13 === 0 ? "IN_TRIAGE" : null,
        updatedAt: FIXED_NOW,
      };
    },
  );
  const duplicateFinding = { ...findings[27] };
  const findingRows = [...findings, duplicateFinding];

  const severityCounts = Object.fromEntries(
    severities.map((severity) => [
      severity,
      findings.filter((finding) => finding.severity === severity).length,
    ]),
  );

  const taraComponents = Array.from({ length: COUNTS.taraNodes }, (_, index) => ({
    id: `as-component-${(index + 1).toString().padStart(2, "0")}`,
    projectId,
    kind: "component",
    reviewVersion: index === 0 ? "9007199254740993" : (100 + index).toString(),
    reviewStatus: index === 0 ? "human_approved" : "pending",
    humanEdited: index === 0,
    fields: {
      name: index === 3 ? "Contrôleur télémétrie" : `Architecture node ${index + 1}`,
      componentId: components[index].id,
      zoneId: `zone-${(index % 3) + 1}`,
    },
  }));
  const zones = Array.from({ length: 3 }, (_, index) => ({
    id: `zone-${index + 1}`,
    projectId,
    kind: "zone",
    reviewVersion: (300 + index).toString(),
    reviewStatus: "pending",
    humanEdited: false,
    fields: { name: ["Untrusted", "Control", "Safety"][index] },
  }));
  const assets = Array.from({ length: 4 }, (_, index) => ({
    id: `asset-${index + 1}`,
    projectId,
    kind: "asset",
    reviewVersion: (400 + index).toString(),
    reviewStatus: "pending",
    humanEdited: false,
    fields: { name: `Protected asset ${index + 1}`, componentId: taraComponents[index].id },
  }));
  const dataflows = Array.from({ length: 11 }, (_, index) => ({
    id: `flow-${(index + 1).toString().padStart(2, "0")}`,
    projectId,
    kind: "dataflow",
    reviewVersion: (500 + index).toString(),
    reviewStatus: "pending",
    humanEdited: false,
    fields: {
      name: `Dataflow ${index + 1}`,
      sourceId: taraComponents[index].id,
      targetId: taraComponents[index + 1].id,
      protocol: index % 2 === 0 ? "MQTT" : "TLS",
    },
  }));
  const threats = Array.from({ length: 16 }, (_, index) => ({
    id: `threat-${(index + 1).toString().padStart(2, "0")}`,
    projectId,
    kind: "threat",
    reviewVersion: (600 + index).toString(),
    reviewStatus: index === 2 ? "ai_flagged" : "pending",
    humanEdited: false,
    fields: {
      title: `Threat ${index + 1}`,
      componentId: taraComponents[index % taraComponents.length].id,
      assetId: assets[index % assets.length].id,
      stride: ["spoofing", "tampering", "repudiation", "information_disclosure"][index % 4],
    },
  }));
  const mitigations = Array.from({ length: 12 }, (_, index) => ({
    id: `mitigation-${(index + 1).toString().padStart(2, "0")}`,
    projectId,
    kind: "mitigation",
    reviewVersion: (700 + index).toString(),
    reviewStatus: "pending",
    humanEdited: false,
    fields: { title: `Mitigation ${index + 1}`, threatId: threats[index].id },
  }));
  const attackPaths = Array.from({ length: 4 }, (_, index) => ({
    id: `attack-path-${index + 1}`,
    projectId,
    kind: "attack-path",
    reviewVersion: (800 + index).toString(),
    reviewStatus: "pending",
    humanEdited: false,
    fields: {
      name: `Attack path ${index + 1}`,
      threatIds: [threats[index].id, threats[index + 4].id],
      dataflowIds: [dataflows[index].id, dataflows[index + 4].id],
    },
  }));
  const asEntities = [
    ...taraComponents,
    ...zones,
    ...assets,
    ...dataflows,
    ...threats,
    ...mitigations,
    ...attackPaths,
  ];
  const taraExpectedHeadVersionId = "9007199254740996";
  const taraRemoteHeadVersionId = "9007199254740997";

  const requirements = Array.from({ length: COUNTS.requirements }, (_, index) => ({
    id: `requirement-${(index + 1).toString().padStart(3, "0")}`,
    projectId,
    kind: "requirement",
    reviewVersion: (900 + index).toString(),
    reviewStatus: index % 8 === 0 ? "human_approved" : "pending",
    humanEdited: index % 8 === 0,
    fields: {
      key: `REQ-${(index + 1).toString().padStart(3, "0")}`,
      earsPattern: ["ubiquitous", "event_driven", "state_driven", "optional", "unwanted", "complex"][index % 6],
      statement: `The Eagle system shall enforce control ${index + 1}.`,
      threatIds: [threats[index % threats.length].id],
      sourceRef: `document-${(index % COUNTS.documents) + 1}#page=${(index % 5) + 1}`,
    },
  }));
  const verificationChecks = requirements.slice(0, -1).map((requirement, index) => ({
    id: `check-${(index + 1).toString().padStart(3, "0")}`,
    projectId,
    requirementId: requirement.id,
    status: index % 7 === 0 ? "failed" : "verified",
    type: ["config_check", "sbom_query", "binary_analysis", "vuln_absence"][index % 4],
    results: [{ id: `result-${index + 1}`, evidenceId: `evidence-${index + 1}`, recordedAt: FIXED_NOW }],
  }));

  const firmwareRootHash = seededHex(seed, "firmware-root");
  const zeroByteSample = new Uint8Array();
  const binarySample = Uint8Array.from([
    0x7f, 0x45, 0x4c, 0x46,
    ...Array.from({ length: 60 }, () => Math.floor(random() * 256)),
  ]);
  const firmwarePaths = Array.from({ length: COUNTS.firmwarePaths }, (_, index) => {
    const number = index + 1;
    const path =
      index === 0
        ? "rootfs/empty.dat"
        : index === 1
          ? "rootfs/usr/bin/eagled"
          : index === 2
            ? "rootfs/link-outside"
            : index === 3
              ? "rootfs/var/lib/broken-archive.tar"
              : `rootfs/generated/dir-${Math.floor(index / 100).toString().padStart(2, "0")}/file-${number.toString().padStart(4, "0")}.dat`;
    const kind = index === 2 ? "symlink" : "file";
    const byteSample = index === 0
      ? "firmware/bytes/zero-byte.bin"
      : index === 1
        ? "firmware/bytes/eagled.bin"
        : null;
    const sampledBytes = index === 0 ? zeroByteSample : index === 1 ? binarySample : null;
    return {
      path,
      kind,
      hash: kind === "symlink"
        ? null
        : sampledBytes === null
          ? seededHex(seed, `firmware-file-${number}`)
          : hashBytes(sampledBytes),
      size: kind === "symlink"
        ? null
        : sampledBytes === null
          ? 16 + (index % 8)
          : sampledBytes.byteLength,
      linkTarget: kind === "symlink" ? "../../outside-root" : null,
      byteSample,
      errors: index === 3 ? ["nested archive unpack failed: unsupported header"] : [],
      scanId,
    };
  });

  const documents = Array.from({ length: COUNTS.documents }, (_, index) => ({
    id: `document-${index + 1}`,
    projectId,
    name: [
      "Eagle architecture.pdf",
      "München radio specification.pdf",
      "CRA Annex I.txt",
      "Register map.csv",
      "Lab report.txt",
      "Withdrawn vendor datasheet.pdf",
    ][index],
    kind: ["architecture", "specification", "regulatory", "design", "test_report", "other"][index],
    status: index === 5 ? "withdrawn" : "active",
    sha256: seededHex(seed, `document-${index + 1}`),
    sourceRefs: requirements
      .filter((_, requirementIndex) => requirementIndex % COUNTS.documents === index)
      .map((requirement) => `${requirement.id}:${requirement.fields.sourceRef}`),
    createdAt: FIXED_NOW,
  }));

  const benchRuns = ["completed", "failed", "timeout"].map((status, index) => ({
    id: `bench-run-${status}`,
    projectVersionId,
    firmwareDigest: firmwareRootHash,
    tier: `tier${index}`,
    kind: ["static", "rehost", "renode"][index],
    status,
    requirementIds: [requirements[index].id],
    evidenceIds: [`evidence-${index + 1}`],
    startedAt: FIXED_NOW,
    finishedAt: FIXED_NOW,
  }));
  const attestations = benchRuns.map((run, index) => ({
    id: `attestation-${index + 1}`,
    runId: run.id,
    subjectDigest: firmwareRootHash,
    predicateType: "https://slsa.dev/provenance/v1",
    verdict: run.status === "completed" ? "safe_to_ota" : run.status === "failed" ? "not_safe" : "inconclusive",
    requirementIds: run.requirementIds,
    signedAt: FIXED_NOW,
  }));

  const forgeJobs = ["RUNNING", "COMPLETED", "FAILED", "TIMEOUT", "CANCELLED"].map((status, index) => ({
    jobId: `forge-job-${status.toLowerCase()}`,
    status,
    tool: index % 2 === 0 ? "verify_dynamic" : "pen_test_run",
    recipe: index % 2 === 0 ? "qemu-eagle" : null,
    scope: { projectId, projectVersionId },
    environment: { image: "fixture/forge-compute:1" },
    runId: status === "RUNNING" ? null : benchRuns[Math.min(index - 1, 2)].id,
    elapsedSeconds: index * 30,
    logTail: [`fixture job ${status.toLowerCase()}`],
    events: [],
    eventCount: 0,
    result: status === "COMPLETED" ? { verdict: "pass" } : null,
    error:
      status === "FAILED" || status === "TIMEOUT"
        ? { code: `FORGE_JOB_${status}`, message: `Fixture ${status.toLowerCase()}` }
        : status === "CANCELLED"
          ? { code: "RAW_CANCELLED", message: "Fixture cancelled by operator" }
          : null,
  }));

  const hBomClaims = [
    {
      id: "hbom-claim-1",
      componentId: taraComponents[0].id,
      field: "manufacturer",
      value: "Acme Components",
      confidence: 0.91,
      sourceRef: "document-2#page=4",
    },
    {
      id: "hbom-claim-2",
      componentId: taraComponents[0].id,
      field: "manufacturer",
      value: "Acme Semiconductor",
      confidence: 0.88,
      sourceRef: "document-6#page=2",
    },
  ];

  const vexResults = findings.slice(0, 5).map((finding, index) => ({
    findingId: finding.id,
    success: index < 3,
    status: index < 3 ? "NOT_AFFECTED" : null,
    error: index < 3 ? null : index === 3 ? "finding locked" : "invalid transition",
  }));
  const cases: FixtureManifest["cases"] = {
    "duplicate-finding-row": {
      description: "One finding row is repeated byte-for-byte in the JSONL collection.",
      refs: [`platform/findings.jsonl#finding=${duplicateFinding.id}`],
    },
    "component-without-purl": {
      description: "A vulnerable component uses its content-hash fallback identity.",
      refs: [`platform/components.jsonl#component=${components[4].id}`],
    },
    "version-changed-component": {
      description: "A component changed version between the prior and current product versions.",
      refs: [`platform/components.jsonl#component=${components[1].id}`],
    },
    "soft-delete-then-reconfirm": {
      description: "Expected history includes a soft delete followed by upstream reconfirmation.",
      refs: ["expected/finding-history.json#event=soft-delete", "expected/finding-history.json#event=reconfirm"],
    },
    "requirement-without-verification": {
      description: "One requirement intentionally has no verification check.",
      refs: [`assurance-studio/requirements.jsonl#requirement=${requirements.at(-1)?.id}`],
    },
    "same-field-tara-drift": {
      description: "Local and remote edits change the same TARA field from a common base.",
      refs: [`assurance-studio/tara-drift.json#entity=${taraComponents[0].id}`],
    },
    "strict-unknown-key": {
      description: "A strict-schema request contains one unknown key.",
      refs: ["faults/strict-unknown-key.json#key=unexpectedFixtureKey"],
    },
    "partial-vex-failure": {
      description: "Bulk VEX succeeds for three rows and fails independently for two.",
      refs: ["platform/vex-bulk-partial.json"],
    },
    "non-ascii-names": {
      description: "Names contain composed non-ASCII Latin characters and the micro sign.",
      refs: [`platform/components.jsonl#component=${components[8].id}`, "documents/documents.json#document=document-2"],
    },
    "zero-byte-firmware-file": {
      description: "The firmware tree contains a real zero-byte sample.",
      refs: ["firmware/manifest.jsonl#path=rootfs/empty.dat", "firmware/bytes/zero-byte.bin"],
    },
    "binary-firmware-file": {
      description: "The firmware tree includes a bounded binary byte sample.",
      refs: ["firmware/manifest.jsonl#path=rootfs/usr/bin/eagled", "firmware/bytes/eagled.bin"],
    },
    "firmware-symlink": {
      description: "A symlink attempts to escape the materialization root.",
      refs: ["firmware/manifest.jsonl#path=rootfs/link-outside"],
    },
    "firmware-unpack-error": {
      description: "A nested archive retains its unpack error in manifest metadata.",
      refs: ["firmware/manifest.jsonl#path=rootfs/var/lib/broken-archive.tar"],
    },
    "withdrawn-document": {
      description: "One document remains addressable after withdrawal.",
      refs: ["documents/documents.json#document=document-6"],
    },
    "conflicting-hbom-claims": {
      description: "Two document-backed claims disagree about the same HBOM field.",
      refs: ["documents/hbom-claims.json#component=as-component-01"],
    },
  };

  const identity = {
    organization: { id: orgId, name: "Fictional Eagle Labs" },
    project: { id: projectId, orgId, name: "Eagle Connected Gateway" },
    versions: [
      { id: priorVersionId, projectId, name: "2.3.0", priorVersionId: null, scanId: priorScanId, createdAt: FIXED_NOW },
      { id: projectVersionId, projectId, name: "2.4.0", priorVersionId, scanId, createdAt: FIXED_NOW },
    ],
  };
  const csvRows = findings.slice(0, 25).map((finding) =>
    [finding.id, finding.cve, finding.componentId, finding.severity].join(","),
  );

  const drafts: FileDraft[] = [
    { path: ".gitattributes", bytes: text("*.bin binary\n") },
    { path: "platform/identity.json", bytes: json(identity) },
    { path: "platform/findings.jsonl", bytes: jsonl(findingRows), rows: findingRows.length },
    { path: "platform/findings-page-1.json", bytes: json({ items: findings.slice(0, 100), total: findings.length, next: "offset:100" }) },
    { path: "platform/finding-detail.json", bytes: json({ ...findings[0], cves: { [findings[0].cve]: { cvss: 9.8, source: "NVD" } }, comments: [{ id: "comment-1", body: "fixture comment", createdAt: FIXED_NOW }] }) },
    { path: "platform/findings-summary.json", bytes: json({ bySeverity: severityCounts, total: findings.length }) },
    { path: "platform/components.jsonl", bytes: jsonl(components), rows: components.length },
    { path: "platform/components-page-1.json", bytes: json({ items: components.slice(0, 100), total: components.length, next: "offset:100" }) },
    { path: "platform/sbom.cdx.json", bytes: json({ bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { component: { name: "Eagle Connected Gateway", version: "2.4.0" }, timestamp: FIXED_NOW }, components: components.map((component) => ({ "bom-ref": component.id, name: component.name, version: component.version, purl: component.purl })) }) },
    { path: "platform/vex-bulk-partial.json", bytes: json({ status: "partial_success", summary: { total: 5, succeeded: 3, failed: 2 }, results: vexResults }) },
    { path: "platform/vex-export.csv", bytes: text(`finding_id,cve,component_id,severity\n${csvRows.join("\n")}\n# rows_written=25 rows_skipped=2\n`), rows: 27 },
    { path: "assurance-studio/entities.jsonl", bytes: jsonl(asEntities), rows: asEntities.length },
    { path: "assurance-studio/entities-page-1.json", bytes: json({ success: true, data: { items: asEntities.slice(0, 25), total: asEntities.length, page: 1, pageSize: 25, hasMore: true } }) },
    { path: "assurance-studio/requirements.jsonl", bytes: jsonl(requirements), rows: requirements.length },
    { path: "assurance-studio/verification-checks.jsonl", bytes: jsonl(verificationChecks), rows: verificationChecks.length },
    { path: "assurance-studio/tara-drift.json", bytes: json({ entityId: taraComponents[0].id, field: "name", base: taraComponents[0].fields.name, local: "Gateway Control Unit", remote: "Edge Gateway Controller", expectedHeadVersionId: taraExpectedHeadVersionId, remoteHeadVersionId: taraRemoteHeadVersionId }) },
    { path: "assurance-studio/project-sbom-page-1.json", bytes: json({ success: true, data: { items: components.slice(0, 50), total: components.length, page: 1, pageSize: 50, hasMore: true } }) },
    { path: "forge-compute/jobs.jsonl", bytes: jsonl(forgeJobs), rows: forgeJobs.length },
    { path: "forge-compute/README.md", bytes: text("# Optional Forge compute fixtures\n\nNo Platform or Assurance Studio fixture refers to this optional-service group, so consumers that do not exercise Forge compute can ignore it. Because the group is part of the frozen corpus and its manifest, `--check` still requires these files.\n") },
    { path: "firmware/manifest.jsonl", bytes: jsonl(firmwarePaths), rows: firmwarePaths.length },
    { path: "firmware/filesystem-response.json", bytes: json({ projectVersionId, scanId, artifactHash: firmwareRootHash, path: "rootfs", entries: firmwarePaths.slice(0, 100), total: firmwarePaths.length }) },
    { path: "firmware/bytes/zero-byte.bin", bytes: zeroByteSample },
    { path: "firmware/bytes/eagled.bin", bytes: binarySample },
    { path: "documents/documents.json", bytes: json({ items: documents, total: documents.length }) },
    { path: "documents/hbom-claims.json", bytes: json({ claims: hBomClaims }) },
    { path: "documents/source-extracts.jsonl", bytes: jsonl(documents.map((document, index) => ({ id: `extract-${index + 1}`, documentId: document.id, page: (index % 5) + 1, text: `Synthetic fixture extract ${index + 1}`, target: index % 2 === 0 ? requirements[index].id : taraComponents[index].id }))), rows: documents.length },
    { path: "faults/strict-unknown-key.json", bytes: json({ projectVersionId, findingId: findings[0].id, unexpectedFixtureKey: true }) },
    { path: "faults/platform-firmware-forbidden.json", bytes: json({ service: "platform", status: 403, code: "FIRMWARE_BYTES_FORBIDDEN", retryable: false }) },
    { path: "faults/platform-rate-limit.json", bytes: json({ service: "platform", status: 429, retryAfterSeconds: 2 }) },
    { path: "faults/assurance-studio-stale-tara.json", bytes: json({ service: "assurance-studio", status: 409, code: "stale_tara_state", entityId: taraComponents[0].id }) },
    { path: "faults/forge-compute-unavailable.json", bytes: json({ service: "forge-compute", configured: false, reachable: false }) },
    { path: "expected/identity-links.json", bytes: json({ orgId, projectId, projectVersionId, priorVersionId, scanId, priorScanId, firmwareRootHash }) },
    { path: "expected/finding-history.json", bytes: json({ findingId: findings[12].id, events: [{ id: "soft-delete", action: "soft_delete", at: FIXED_NOW }, { id: "reconfirm", action: "upstream_reconfirm", at: FIXED_NOW }] }) },
    { path: "expected/bench-runs.jsonl", bytes: jsonl(benchRuns), rows: benchRuns.length },
    { path: "expected/attestations.jsonl", bytes: jsonl(attestations), rows: attestations.length },
    { path: "cases.json", bytes: json(cases) },
    { path: "README.md", bytes: text(`# Deterministic mock-remote fixture corpus\n\nGenerated by \`generate-seed.ts\` with schema ${FIXTURE_SCHEMA_VERSION}, seed \`${seed}\`, and fixed clock \`${FIXED_NOW}\`. Do not hand-edit generated files.\n\nLarge collections use JSONL. The 6,000-path firmware tree is metadata-only except for the bounded samples under \`firmware/bytes/\`. Forge compute is optional and isolated under \`forge-compute/\`.\n\nManifest \`rows\` counts physical LF-delimited lines. For JSONL that equals records; for CSV it includes the header and trailer lines.\n\nRegenerate from the plugin directory:\n\n\`\`\`sh\n../../node_modules/.bin/tsx test/mock-remote/generate-seed.ts\n../../node_modules/.bin/tsx test/mock-remote/generate-seed.ts --check\n\`\`\`\n`) },
  ];
  const counts: FixtureManifest["counts"] = {
    findings: new Set(findingRows.map((finding) => finding.id)).size,
    components: components.filter((component) => component.vulnerable).length,
    sbomComponents: components.length,
    taraNodes: taraComponents.length,
    requirements: requirements.length,
    firmwarePaths: firmwarePaths.length,
    documents: documents.length,
  };
  return { drafts, cases, counts };
}

async function writeDrafts(root: string, drafts: FileDraft[]): Promise<void> {
  for (const draft of drafts) {
    const target = join(root, ...draft.path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, draft.bytes);
  }
}

async function createGeneratedDirectory(seed: string, root: string): Promise<FixtureManifest> {
  const { drafts, cases, counts } = buildCorpus(seed);
  await writeDrafts(root, drafts);
  const files = drafts
    .map((draft) => ({
      path: draft.path,
      sha256: hashBytes(draft.bytes),
      bytes: draft.bytes.byteLength,
      ...(draft.rows === undefined ? {} : { rows: draft.rows }),
    }))
    .sort((left, right) => compareText(left.path, right.path));
  const manifest: FixtureManifest = {
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    seed,
    fixedNow: FIXED_NOW,
    counts,
    files,
    cases,
  };
  await writeFile(join(root, "manifest.json"), json(manifest as unknown as JsonValue));
  return manifest;
}

async function listRelativeFiles(root: string, current = root): Promise<string[]> {
  const names = await readdir(current);
  const files: string[] = [];
  for (const name of names.sort(compareText)) {
    const fullPath = join(current, name);
    const info = await lstat(fullPath);
    if (info.isDirectory()) files.push(...(await listRelativeFiles(root, fullPath)));
    else files.push(relative(root, fullPath).split(sep).join("/"));
  }
  return files;
}

async function assertDirectoriesEqual(expected: string, actual: string): Promise<void> {
  let expectedFiles: string[];
  try {
    expectedFiles = await listRelativeFiles(expected);
  } catch {
    throw new FixtureGenerationError(
      "INVALID_OUTPUT",
      `Fixture output directory does not exist or is unreadable: ${expected}`,
    );
  }
  const actualFiles = await listRelativeFiles(actual);
  if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) {
    throw new FixtureGenerationError("FIXTURE_DRIFT", "Fixture file list drift detected");
  }
  for (const file of expectedFiles) {
    const [expectedBytes, actualBytes] = await Promise.all([
      readFile(join(expected, ...file.split("/"))),
      readFile(join(actual, ...file.split("/"))),
    ]);
    if (!expectedBytes.equals(actualBytes)) {
      throw new FixtureGenerationError("FIXTURE_DRIFT", `Fixture byte drift detected: ${file}`);
    }
  }
}

async function validateOutputPath(outDir: string): Promise<string> {
  if (outDir.trim().length === 0 || outDir.includes("\0")) {
    throw new FixtureGenerationError("INVALID_OUTPUT", "Fixture output path is invalid");
  }
  const resolved = resolve(outDir);
  try {
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      throw new FixtureGenerationError("INVALID_OUTPUT", `Fixture output path is not a directory: ${resolved}`);
    }
  } catch (error: unknown) {
    if (error instanceof FixtureGenerationError) throw error;
    try {
      const parentInfo = await stat(dirname(resolved));
      if (!parentInfo.isDirectory()) throw new Error("parent is not a directory");
    } catch {
      throw new FixtureGenerationError("INVALID_OUTPUT", `Fixture output parent does not exist: ${dirname(resolved)}`);
    }
  }
  return resolved;
}

async function replaceDirectoryAtomically(staged: string, target: string): Promise<void> {
  const backup = join(dirname(target), `.${basename(target)}.backup-${process.pid}`);
  let hadTarget = false;
  try {
    await rename(target, backup);
    hadTarget = true;
  } catch {
    hadTarget = false;
  }
  try {
    await rename(staged, target);
    if (hadTarget) await rm(backup, { recursive: true, force: true });
  } catch (error: unknown) {
    if (hadTarget) await rename(backup, target);
    throw error;
  }
}

export async function generateFixtureCorpus(options: GenerateOptions): Promise<FixtureManifest> {
  validateSeed(options.seed);
  const outDir = await validateOutputPath(options.outDir);
  if (options.check) {
    const tempRoot = await mkdtemp(join(tmpdir(), "finite-state-fixture-check-"));
    try {
      const generated = join(tempRoot, "fixtures");
      await mkdir(generated);
      const manifest = await createGeneratedDirectory(options.seed, generated);
      await assertDirectoriesEqual(outDir, generated);
      return manifest;
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  const parent = dirname(outDir);
  let stagingRoot: string | null = null;
  try {
    stagingRoot = await mkdtemp(join(parent, `.${basename(outDir)}.generate-`));
    const staged = join(stagingRoot, "fixtures");
    await mkdir(staged);
    const manifest = await createGeneratedDirectory(options.seed, staged);
    await replaceDirectoryAtomically(staged, outDir);
    return manifest;
  } catch (error: unknown) {
    if (error instanceof FixtureGenerationError) throw error;
    throw new FixtureGenerationError(
      "INVALID_OUTPUT",
      `Could not generate fixture corpus at ${outDir}`,
    );
  } finally {
    if (stagingRoot !== null) {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }
}

function parseCli(argv: string[]): GenerateOptions {
  let seed: string = DEFAULT_FIXTURE_SEED;
  let outDir = fileURLToPath(new URL("./fixtures", import.meta.url));
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") check = true;
    else if (argument === "--seed" || argument === "--out") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new FixtureGenerationError(
          "INVALID_ARGUMENT",
          `Unknown or incomplete argument: ${argument}`,
        );
      }
      index += 1;
      if (argument === "--seed") seed = value;
      else outDir = value;
    }
    else throw new FixtureGenerationError("INVALID_ARGUMENT", `Unknown or incomplete argument: ${argument}`);
  }
  return { seed, outDir, check };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  Promise.resolve()
    .then(() => generateFixtureCorpus(parseCli(process.argv.slice(2))))
    .catch((error: unknown) => {
      const message =
        error instanceof FixtureGenerationError
          ? `${error.name} [${error.code}]: ${error.message}`
          : error instanceof Error
            ? `${error.name}: ${error.message}`
            : "Fixture generation failed";
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
