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

import { format } from "prettier";

import { ASSURANCE_STUDIO_COMPONENT_TYPES } from "../../lanes/product-security/canvas/editing/schema.js";
import {
  DEFAULT_FIXTURE_SEED,
  FIXTURE_SCHEMA_VERSION,
  FixtureGenerationError,
  type FixtureManifest,
  type GenerateOptions,
} from "./seed-schema.js";

const FIXED_NOW = "2026-05-12T14:30:00.000Z";
// Sanitized GET /public/v0/versions/{pv}/findings captures attached to FS-174.
// Keep these bytes verbatim: they exist specifically to prevent mock/reality drift.
const FS174_DISTRO_FINDING = `{
  "id": "0b529d2b-9da8-556e-81e4-f0f57a59956a",
  "title": "CVE-2016-4658 - debian/libxml2@2.9.4%2Bdfsg1-2.2%2Bdeb9u2",
  "description": "",
  "severity": "critical",
  "status": null,
  "location": "libxml2",
  "type": "cve",
  "findingId": "CVE-2016-4658",
  "vulnerabilityId": "97f077e8-fc05-5198-8ab6-9111fb37e83a",
  "cvssScore": 9.8,
  "cvssVector": "CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/E:U/RL:X/RC:C",
  "detected": "2025-08-02T03:41:39.595176Z",
  "epssScore": "0.08628",
  "epssPercentile": "0.94573",
  "epssWeightedRisk": 9.3,
  "epssWeightedSeverity": "critical",
  "component": {
    "id": "e1a048dc-9890-5333-9e97-cd5d6f429fcd",
    "name": "debian/libxml2",
    "version": "2.9.4%2Bdfsg1-2.2%2Bdeb9u2",
    "appId": "cfe6fb97-ed49-5ace-b0fe-8121dba2c793",
    "vcId": "c75bd181-e012-5cdf-92e9-5e431596285f"
  },
  "inKev": false,
  "vulnInDataset": true,
  "inVcKev": false,
  "risk": 98,
  "warnings": 0,
  "violations": 1,
  "reachabilityScore": 315,
  "project": {
    "id": "cfe6fb97-ed49-5ace-b0fe-8121dba2c793",
    "name": "I491NAX"
  },
  "projectVersion": {
    "id": "b3df3633-ebd7-560e-a3b7-77953521b4e3",
    "version": "reachability",
    "created": "2025-08-01T20:34:39.020812Z",
    "updated": "2026-08-13T13:31:12.642019Z"
  },
  "cwes": [
    "CWE-119"
  ],
  "exploitInfo": [],
  "dependencyPath": null
}`;
const FS174_CVE_UUID_FINDING = `{
  "id": "85c04807-db47-4853-b659-ece4214ef395",
  "title": "CVE-2026-34877 - Mbed TLS@3.0.0",
  "description": "",
  "severity": "critical",
  "status": null,
  "location": "Mbed TLS",
  "type": "cve",
  "findingId": "CVE-2026-34877",
  "vulnerabilityId": "cbdc8dc1-66ad-5264-b81b-67b2eaf1257e",
  "cvssScore": 9.8,
  "cvssVector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
  "detected": "2026-07-22T02:36:58.05251Z",
  "epssScore": "0.00426",
  "epssPercentile": "0.34936",
  "epssWeightedRisk": 3.4,
  "epssWeightedSeverity": "low",
  "component": {
    "id": "df542a94-2571-5f0d-aaf9-3892e9d70ef5",
    "name": "Mbed TLS",
    "version": "3.0.0",
    "appId": "5d78bed3-fa8e-59cf-b8a1-6046853ba785",
    "vcId": "b812780a-fa4c-5562-8919-b00293b43b6d"
  },
  "inKev": false,
  "vulnInDataset": null,
  "inVcKev": false,
  "risk": 98,
  "warnings": 0,
  "violations": 1,
  "reachabilityScore": null,
  "project": {
    "id": "5d78bed3-fa8e-59cf-b8a1-6046853ba785",
    "name": "I490M1-Xirgo"
  },
  "projectVersion": {
    "id": "89ad8a41-2185-5df0-968b-c250312c908b",
    "version": "2026-02-25",
    "created": "2026-02-25T18:21:08.118654Z",
    "updated": "2026-07-28T22:12:37.961582Z"
  },
  "cwes": [
    "CWE-250",
    "CWE-502"
  ],
  "exploitInfo": [],
  "dependencyPath": null
}`;
// Sanitized real-shape specimen from the read-only production Platform capture
// in FS-192:
// bb thread thr_au4euua3y2 events 3966/4015 and
// UX-FINDINGS-2026-08-13-sweep6.md:110. Event 3966 records this exact 29-key
// payload shape; event 4015 records the identity values. Non-identity values
// use the vendored FindingV0 shape and sanitized values observed in the FS-174
// captures. Preserve the nested component, empty version, absent purl,
// string-valued EPSS fields, policy counts, and binary-sast type.
const FS193_BINARY_SAST_FINDING = `{
  "id": "00000000-0000-5000-8000-000000000193",
  "title": "FS-500-006 - /update/firmware-root/etc/ssl/certs/ca-certificates.crt",
  "description": "",
  "severity": "high",
  "status": null,
  "location": "ca-certificates.crt",
  "type": "binary-sast",
  "findingId": "FS-500-006",
  "vulnerabilityId": "00000000-0000-5000-8000-000000000197",
  "cvssScore": 7.5,
  "cvssVector": "CVSS:3.1/AV:L/AC:H/PR:L/UI:N/S:U/C:H/I:H/A:H",
  "detected": "2026-05-12T14:30:00.000Z",
  "epssScore": "0.00426",
  "epssPercentile": "0.34936",
  "epssWeightedRisk": 2.6,
  "epssWeightedSeverity": "low",
  "component": {
    "id": "00000000-0000-5000-8000-000000000194",
    "name": "/update/firmware-root/etc/ssl/certs/ca-certificates.crt",
    "version": "",
    "appId": "00000000-0000-5000-8000-000000000195",
    "vcId": "00000000-0000-5000-8000-000000000196"
  },
  "inKev": false,
  "vulnInDataset": false,
  "inVcKev": false,
  "risk": 75,
  "warnings": 2,
  "violations": 1,
  "reachabilityScore": 0,
  "project": {
    "id": "cfe6fb97-ed49-5ace-b0fe-8121dba2c793",
    "name": "I491NAX"
  },
  "projectVersion": {
    "id": "b3df3633-ebd7-560e-a3b7-77953521b4e3",
    "version": "reachability",
    "created": "2025-08-01T20:34:39.020812Z",
    "updated": "2026-08-13T13:31:12.642019Z"
  },
  "cwes": [
    "CWE-295"
  ],
  "exploitInfo": [],
  "dependencyPath": null
}
`;
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
  component: {
    appId: string;
    id: string;
    name: string;
    vcId: string;
    version: string;
  };
  cve: string;
  severity: string;
  title: string;
  vexStatus: string | null;
  updatedAt: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PRETTIER_JSON_DRAFTS = new Set([
  "assurance-studio/entities-page-1.json",
  "cases.json",
  "platform/fs193-binary-sast-specimen.json",
]);

function capturedFinding(source: string): Record<string, JsonValue> {
  const value: unknown = JSON.parse(source);
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("Captured finding fixture must be an object");
  }
  return value as Record<string, JsonValue>;
}

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
      const name =
        index === 8
          ? "münchen-µtls"
          : `eagle-component-${number.toString().padStart(3, "0")}`;
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
        // FindingV0 wire authority: docs/Implementation/api-reference/
        // finite-state-api-v0.3.0.reference.md § Findings, `component`.
        // The live API nests exactly these component identity fields.
        component: {
          appId: `app-${component.id}`,
          id: component.id,
          name: component.name,
          vcId: `vc-${component.id}`,
          version: component.version,
        },
        cve: `CVE-${cveYear}-${(10_000 + index).toString().padStart(5, "0")}`,
        severity: severities[index % severities.length],
        title:
          index === 8
            ? "Überlauf in München gateway"
            : `Generated finding ${index + 1}`,
        vexStatus: index % 13 === 0 ? "IN_TRIAGE" : null,
        updatedAt: FIXED_NOW,
      };
    },
  );
  const duplicateFinding = { ...findings[27] };
  const findingRows = [
    ...findings,
    duplicateFinding,
    capturedFinding(FS174_DISTRO_FINDING),
    capturedFinding(FS174_CVE_UUID_FINDING),
    capturedFinding(FS193_BINARY_SAST_FINDING),
  ];

  const severityCounts = Object.fromEntries(
    severities.map((severity) => [
      severity,
      findings.filter((finding) => finding.severity === severity).length,
    ]),
  );

  /*
   * FS-166 fixture-fidelity provenance (vendored under docs/Implementation/api-reference):
   * - Component, Zone, and DataFlow field names/types come from the OpenAPI
   *   `components.schemas.Component`, `.Zone`, and `.DataFlow` response schemas.
   * - Component values use the exact OpenAPI `ComponentType` enum, including
   *   `firmware`, rather than sampling only its overlap with the local schema.
   * - DataFlow uses response property `crosses_trust_boundary`; the request-only
   *   `bidirectional`/`is_bidirectional` names are deliberately absent.
   * - Threat `stride_categories`, `threat_source`, `preconditions`, `asset_ids`,
   *   and `linked_mitigations` come from `components.schemas.Threat`. The fixture
   *   deliberately omits unsupported severity/component/dataflow relation keys.
   * - The vendored spec has no JSON Asset collection response contract, so its
   *   fixture carries identity only; domain fields remain optional in the adapter.
   */
  const taraComponents = Array.from(
    { length: COUNTS.taraNodes },
    (_, index) => ({
      id: `as-component-${(index + 1).toString().padStart(2, "0")}`,
      projectId,
      kind: "component",
      reviewVersion:
        index === 0 ? "9007199254740993" : (100 + index).toString(),
      reviewStatus: index === 0 ? "human_approved" : "pending",
      humanEdited: index === 0,
      fields: {
        name:
          index === 3
            ? "Contrôleur télémétrie"
            : `Architecture node ${index + 1}`,
        zone_id: `zone-${(index % 3) + 1}`,
        component_type:
          ASSURANCE_STUDIO_COMPONENT_TYPES[
            index % ASSURANCE_STUDIO_COMPONENT_TYPES.length
          ],
        criticality: ["low", "medium", "high", "critical"][index % 4],
        interfaces: [index % 2 === 0 ? "ethernet" : "serial"],
        technologies: [index % 2 === 0 ? "linux" : "bare-metal"],
        is_entry_point: index % 4 === 0,
        stores_data: index % 3 === 0,
      },
    }),
  );
  const zones = Array.from({ length: 3 }, (_, index) => ({
    id: `zone-${index + 1}`,
    projectId,
    kind: "zone",
    reviewVersion: (300 + index).toString(),
    reviewStatus: "pending",
    humanEdited: false,
    fields: {
      name: ["Untrusted", "Control", "Safety"][index],
      trust_level: ["untrusted", "semi_trusted", "highly_trusted"][index],
    },
  }));
  const assets = Array.from({ length: 4 }, (_, index) => ({
    id: `asset-${index + 1}`,
    projectId,
    kind: "asset",
    reviewVersion: (400 + index).toString(),
    reviewStatus: "pending",
    humanEdited: false,
    fields: {
      name: `Protected asset ${index + 1}`,
    },
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
      source_component_id: taraComponents[index].id,
      target_component_id: taraComponents[index + 1].id,
      protocol: index % 2 === 0 ? "MQTT" : "TLS",
      data_types: [index % 2 === 0 ? "telemetry" : "control"],
      is_encrypted: index % 2 !== 0,
      is_authenticated: index % 2 !== 0,
      crosses_trust_boundary: index % 3 === 0,
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
      name: `Threat ${index + 1}`,
      stride_categories: [
        ["spoofing"],
        ["tampering"],
        ["repudiation"],
        ["information_disclosure"],
      ][index % 4],
      threat_source: "stride_analysis",
      preconditions: [`Fixture precondition ${index + 1}`],
      asset_ids: [assets[index % assets.length].id],
      linked_mitigations:
        index < 12
          ? [
              {
                id: `mitigation-${(index + 1).toString().padStart(2, "0")}`,
                name: `Mitigation ${index + 1}`,
              },
            ]
          : [],
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

  const requirements = Array.from(
    { length: COUNTS.requirements },
    (_, index) => ({
      id: `requirement-${(index + 1).toString().padStart(3, "0")}`,
      projectId,
      kind: "requirement",
      reviewVersion: (900 + index).toString(),
      reviewStatus: index % 8 === 0 ? "human_approved" : "pending",
      humanEdited: index % 8 === 0,
      fields: {
        key: `REQ-${(index + 1).toString().padStart(3, "0")}`,
        earsPattern: [
          "ubiquitous",
          "event_driven",
          "state_driven",
          "optional",
          "unwanted",
          "complex",
        ][index % 6],
        statement: `The Eagle system shall enforce control ${index + 1}.`,
        threatIds: [threats[index % threats.length].id],
        sourceRef: `document-${(index % COUNTS.documents) + 1}#page=${(index % 5) + 1}`,
      },
    }),
  );
  const verificationChecks = requirements
    .slice(0, -1)
    .map((requirement, index) => ({
      id: `check-${(index + 1).toString().padStart(3, "0")}`,
      projectId,
      requirementId: requirement.id,
      status: index % 7 === 0 ? "failed" : "verified",
      type: ["config_check", "sbom_query", "binary_analysis", "vuln_absence"][
        index % 4
      ],
      results: [
        {
          id: `result-${index + 1}`,
          evidenceId: `evidence-${index + 1}`,
          recordedAt: FIXED_NOW,
        },
      ],
    }));

  const firmwareRootHash = seededHex(seed, "firmware-root");
  const zeroByteSample = new Uint8Array();
  const binarySample = Uint8Array.from([
    0x7f,
    0x45,
    0x4c,
    0x46,
    ...Array.from({ length: 60 }, () => Math.floor(random() * 256)),
  ]);
  const firmwarePaths = Array.from(
    { length: COUNTS.firmwarePaths },
    (_, index) => {
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
                : `rootfs/generated/dir-${Math.floor(index / 100)
                    .toString()
                    .padStart(
                      2,
                      "0",
                    )}/file-${number.toString().padStart(4, "0")}.dat`;
      const kind = index === 2 ? "symlink" : "file";
      const byteSample =
        index === 0
          ? "firmware/bytes/zero-byte.bin"
          : index === 1
            ? "firmware/bytes/eagled.bin"
            : null;
      const sampledBytes =
        index === 0 ? zeroByteSample : index === 1 ? binarySample : null;
      return {
        path,
        kind,
        hash:
          kind === "symlink"
            ? null
            : sampledBytes === null
              ? seededHex(seed, `firmware-file-${number}`)
              : hashBytes(sampledBytes),
        size:
          kind === "symlink"
            ? null
            : sampledBytes === null
              ? 16 + (index % 8)
              : sampledBytes.byteLength,
        linkTarget: kind === "symlink" ? "../../outside-root" : null,
        byteSample,
        errors:
          index === 3
            ? ["nested archive unpack failed: unsupported header"]
            : [],
        scanId,
      };
    },
  );

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
    kind: [
      "architecture",
      "specification",
      "regulatory",
      "design",
      "test_report",
      "other",
    ][index],
    status: index === 5 ? "withdrawn" : "active",
    sha256: seededHex(seed, `document-${index + 1}`),
    sourceRefs: requirements
      .filter(
        (_, requirementIndex) => requirementIndex % COUNTS.documents === index,
      )
      .map(
        (requirement) => `${requirement.id}:${requirement.fields.sourceRef}`,
      ),
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
    verdict:
      run.status === "completed"
        ? "safe_to_ota"
        : run.status === "failed"
          ? "not_safe"
          : "inconclusive",
    requirementIds: run.requirementIds,
    signedAt: FIXED_NOW,
  }));

  const forgeJobs = [
    "RUNNING",
    "COMPLETED",
    "FAILED",
    "TIMEOUT",
    "CANCELLED",
  ].map((status, index) => ({
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
        ? {
            code: `FORGE_JOB_${status}`,
            message: `Fixture ${status.toLowerCase()}`,
          }
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
    error:
      index < 3 ? null : index === 3 ? "finding locked" : "invalid transition",
  }));
  const cases: FixtureManifest["cases"] = {
    "duplicate-finding-row": {
      description:
        "One finding row is repeated byte-for-byte in the JSONL collection.",
      refs: [`platform/findings.jsonl#finding=${duplicateFinding.id}`],
    },
    "component-without-purl": {
      description:
        "A vulnerable component uses its content-hash fallback identity.",
      refs: [`platform/components.jsonl#component=${components[4].id}`],
    },
    "version-changed-component": {
      description:
        "A component changed version between the prior and current product versions.",
      refs: [`platform/components.jsonl#component=${components[1].id}`],
    },
    "soft-delete-then-reconfirm": {
      description:
        "Expected history includes a soft delete followed by upstream reconfirmation.",
      refs: [
        "expected/finding-history.json#event=soft-delete",
        "expected/finding-history.json#event=reconfirm",
      ],
    },
    "requirement-without-verification": {
      description: "One requirement intentionally has no verification check.",
      refs: [
        `assurance-studio/requirements.jsonl#requirement=${requirements.at(-1)?.id}`,
      ],
    },
    "same-field-tara-drift": {
      description:
        "Local and remote edits change the same TARA field from a common base.",
      refs: [`assurance-studio/tara-drift.json#entity=${taraComponents[0].id}`],
    },
    "strict-unknown-key": {
      description: "A strict-schema request contains one unknown key.",
      refs: ["faults/strict-unknown-key.json#key=unexpectedFixtureKey"],
    },
    "partial-vex-failure": {
      description:
        "Bulk VEX succeeds for three rows and fails independently for two.",
      refs: ["platform/vex-bulk-partial.json"],
    },
    "real-distro-finding-identity": {
      description:
        "Captured Platform response preserves a namespaced package name and percent-encoded Debian version.",
      refs: ["platform/fs174-i491nax-distro-specimen.json"],
    },
    "real-cve-uuid-field-mapping": {
      description:
        "Captured Platform response carries the CVE in findingId and an opaque UUID in vulnerabilityId.",
      refs: ["platform/fs174-cve-uuid-mapping-specimen.json"],
    },
    "real-binary-sast-any-version-identity": {
      description:
        "Sanitized 29-key Platform response preserves a binary-SAST file-path component with an empty version, no purl, string EPSS, and policy counts.",
      refs: ["platform/fs193-binary-sast-specimen.json"],
    },
    "non-ascii-names": {
      description:
        "Names contain composed non-ASCII Latin characters and the micro sign.",
      refs: [
        `platform/components.jsonl#component=${components[8].id}`,
        "documents/documents.json#document=document-2",
      ],
    },
    "zero-byte-firmware-file": {
      description: "The firmware tree contains a real zero-byte sample.",
      refs: [
        "firmware/manifest.jsonl#path=rootfs/empty.dat",
        "firmware/bytes/zero-byte.bin",
      ],
    },
    "binary-firmware-file": {
      description: "The firmware tree includes a bounded binary byte sample.",
      refs: [
        "firmware/manifest.jsonl#path=rootfs/usr/bin/eagled",
        "firmware/bytes/eagled.bin",
      ],
    },
    "firmware-symlink": {
      description: "A symlink attempts to escape the materialization root.",
      refs: ["firmware/manifest.jsonl#path=rootfs/link-outside"],
    },
    "firmware-unpack-error": {
      description:
        "A nested archive retains its unpack error in manifest metadata.",
      refs: ["firmware/manifest.jsonl#path=rootfs/var/lib/broken-archive.tar"],
    },
    "withdrawn-document": {
      description: "One document remains addressable after withdrawal.",
      refs: ["documents/documents.json#document=document-6"],
    },
    "conflicting-hbom-claims": {
      description:
        "Two document-backed claims disagree about the same HBOM field.",
      refs: ["documents/hbom-claims.json#component=as-component-01"],
    },
  };

  const identity = {
    organization: { id: orgId, name: "Fictional Eagle Labs" },
    project: { id: projectId, orgId, name: "Eagle Connected Gateway" },
    versions: [
      {
        id: priorVersionId,
        projectId,
        name: "2.3.0",
        priorVersionId: null,
        scanId: priorScanId,
        createdAt: FIXED_NOW,
      },
      {
        id: projectVersionId,
        projectId,
        name: "2.4.0",
        priorVersionId,
        scanId,
        createdAt: FIXED_NOW,
      },
    ],
  };
  const csvRows = findings
    .slice(0, 25)
    .map((finding) =>
      [finding.id, finding.cve, finding.component.id, finding.severity].join(
        ",",
      ),
    );
  const projectLinkGroups = [
    {
      platformProjectId: "platform-project-a",
      platformProjectName: "Platform Project A",
      platformVersionId: "platform-version-a",
      platformVersionName: "Version A",
      projects: ["a1", "a2", "a3", "a4"],
    },
    {
      platformProjectId: "platform-project-b",
      platformProjectName: "Platform Project B",
      platformVersionId: "platform-version-b",
      platformVersionName: "Version B",
      projects: ["b1", "b2"],
    },
    {
      platformProjectId: "platform-project-c",
      platformProjectName: "Platform Project C",
      platformVersionId: "platform-version-c",
      platformVersionName: "Version C",
      projects: ["c1"],
    },
  ];
  const projectLinks = {
    projects: projectLinkGroups.flatMap((group) =>
      group.projects.map((suffix) => ({
        id: `as-project-${suffix}`,
        name: `AS Project ${suffix.toUpperCase()}`,
      })),
    ),
    links: projectLinkGroups.flatMap((group) =>
      group.projects.map((suffix) => ({
        id: `link-${suffix}`,
        project_id: `as-project-${suffix}`,
        fs_product_id: group.platformProjectId,
        fs_product_name: group.platformProjectName,
        is_primary: true,
        version_strategy: "specific",
        fs_version_id: group.platformVersionId,
        fs_version_name: suffix === "a2" ? null : group.platformVersionName,
        last_synced_at: suffix === "a2" ? null : FIXED_NOW,
        sync_status: suffix === "a2" ? "error" : "synced",
        sync_error: suffix === "a2" ? "fixture sync error" : null,
        sbom_component_count: suffix === "a2" ? null : 12,
        vulnerability_count: suffix === "a2" ? null : 3,
        critical_vuln_count: suffix === "a2" ? null : 1,
        created_by: "fixture-user",
        created_at: FIXED_NOW,
        updated_at: FIXED_NOW,
        organization_id: "fixture-organization",
        source_type: "finite_state",
        summary: { status: "captured-shape" },
      })),
    ),
  };

  const drafts: FileDraft[] = [
    { path: ".gitattributes", bytes: text("*.bin binary\n") },
    { path: "platform/identity.json", bytes: json(identity) },
    {
      path: "platform/findings.jsonl",
      bytes: jsonl(findingRows),
      rows: findingRows.length,
    },
    {
      path: "platform/findings-page-1.json",
      bytes: json({
        items: findings.slice(0, 100),
        total: findings.length,
        next: "offset:100",
      }),
    },
    {
      path: "platform/finding-detail.json",
      bytes: json({
        ...findings[0],
        cves: { [findings[0].cve]: { cvss: 9.8, source: "NVD" } },
        comments: [
          { id: "comment-1", body: "fixture comment", createdAt: FIXED_NOW },
        ],
      }),
    },
    {
      path: "platform/findings-summary.json",
      bytes: json({ bySeverity: severityCounts, total: findings.length }),
    },
    {
      path: "platform/fs174-i491nax-distro-specimen.json",
      bytes: text(FS174_DISTRO_FINDING),
    },
    {
      path: "platform/fs174-cve-uuid-mapping-specimen.json",
      bytes: text(FS174_CVE_UUID_FINDING),
    },
    {
      path: "platform/fs193-binary-sast-specimen.json",
      bytes: text(FS193_BINARY_SAST_FINDING),
    },
    {
      path: "platform/components.jsonl",
      bytes: jsonl(components),
      rows: components.length,
    },
    {
      path: "platform/components-page-1.json",
      bytes: json({
        items: components.slice(0, 100),
        total: components.length,
        next: "offset:100",
      }),
    },
    {
      path: "platform/sbom.cdx.json",
      bytes: json({
        bomFormat: "CycloneDX",
        specVersion: "1.5",
        version: 1,
        metadata: {
          component: { name: "Eagle Connected Gateway", version: "2.4.0" },
          timestamp: FIXED_NOW,
        },
        components: components.map((component) => ({
          "bom-ref": component.id,
          name: component.name,
          version: component.version,
          purl: component.purl,
        })),
      }),
    },
    {
      path: "platform/vex-bulk-partial.json",
      bytes: json({
        status: "partial_success",
        summary: { total: 5, succeeded: 3, failed: 2 },
        results: vexResults,
      }),
    },
    {
      path: "platform/vex-export.csv",
      bytes: text(
        `finding_id,cve,component_id,severity\n${csvRows.join("\n")}\n# rows_written=25 rows_skipped=2\n`,
      ),
      rows: 27,
    },
    {
      path: "assurance-studio/entities.jsonl",
      bytes: jsonl(asEntities),
      rows: asEntities.length,
    },
    {
      path: "assurance-studio/entities-page-1.json",
      bytes: json({
        success: true,
        data: {
          items: asEntities.slice(0, 25),
          total: asEntities.length,
          page: 1,
          pageSize: 25,
          hasMore: true,
        },
      }),
    },
    {
      path: "assurance-studio/project-links.json",
      bytes: json(projectLinks),
    },
    {
      path: "assurance-studio/requirements.jsonl",
      bytes: jsonl(requirements),
      rows: requirements.length,
    },
    {
      path: "assurance-studio/verification-checks.jsonl",
      bytes: jsonl(verificationChecks),
      rows: verificationChecks.length,
    },
    {
      path: "assurance-studio/tara-drift.json",
      bytes: json({
        entityId: taraComponents[0].id,
        field: "name",
        base: taraComponents[0].fields.name,
        local: "Gateway Control Unit",
        remote: "Edge Gateway Controller",
        expectedHeadVersionId: taraExpectedHeadVersionId,
        remoteHeadVersionId: taraRemoteHeadVersionId,
      }),
    },
    {
      path: "assurance-studio/project-sbom-page-1.json",
      bytes: json({
        success: true,
        data: {
          items: components.slice(0, 50),
          total: components.length,
          page: 1,
          pageSize: 50,
          hasMore: true,
        },
      }),
    },
    {
      path: "forge-compute/jobs.jsonl",
      bytes: jsonl(forgeJobs),
      rows: forgeJobs.length,
    },
    {
      path: "forge-compute/README.md",
      bytes: text(
        "# Optional Forge compute fixtures\n\nNo Platform or Assurance Studio fixture refers to this optional-service group, so consumers that do not exercise Forge compute can ignore it. Because the group is part of the frozen corpus and its manifest, `--check` still requires these files.\n",
      ),
    },
    {
      path: "firmware/manifest.jsonl",
      bytes: jsonl(firmwarePaths),
      rows: firmwarePaths.length,
    },
    {
      path: "firmware/filesystem-response.json",
      bytes: json({
        projectVersionId,
        scanId,
        artifactHash: firmwareRootHash,
        path: "rootfs",
        entries: firmwarePaths.slice(0, 100),
        total: firmwarePaths.length,
      }),
    },
    { path: "firmware/bytes/zero-byte.bin", bytes: zeroByteSample },
    { path: "firmware/bytes/eagled.bin", bytes: binarySample },
    {
      path: "documents/documents.json",
      bytes: json({ items: documents, total: documents.length }),
    },
    { path: "documents/hbom-claims.json", bytes: json({ claims: hBomClaims }) },
    {
      path: "documents/source-extracts.jsonl",
      bytes: jsonl(
        documents.map((document, index) => ({
          id: `extract-${index + 1}`,
          documentId: document.id,
          page: (index % 5) + 1,
          text: `Synthetic fixture extract ${index + 1}`,
          target:
            index % 2 === 0 ? requirements[index].id : taraComponents[index].id,
        })),
      ),
      rows: documents.length,
    },
    {
      path: "faults/strict-unknown-key.json",
      bytes: json({
        projectVersionId,
        findingId: findings[0].id,
        unexpectedFixtureKey: true,
      }),
    },
    {
      path: "faults/platform-firmware-forbidden.json",
      bytes: json({
        service: "platform",
        status: 403,
        code: "FIRMWARE_BYTES_FORBIDDEN",
        retryable: false,
      }),
    },
    {
      path: "faults/platform-rate-limit.json",
      bytes: json({ service: "platform", status: 429, retryAfterSeconds: 2 }),
    },
    {
      path: "faults/assurance-studio-stale-tara.json",
      bytes: json({
        service: "assurance-studio",
        status: 409,
        code: "stale_tara_state",
        entityId: taraComponents[0].id,
      }),
    },
    {
      path: "faults/forge-compute-unavailable.json",
      bytes: json({
        service: "forge-compute",
        configured: false,
        reachable: false,
      }),
    },
    {
      path: "expected/identity-links.json",
      bytes: json({
        orgId,
        projectId,
        projectVersionId,
        priorVersionId,
        scanId,
        priorScanId,
        firmwareRootHash,
      }),
    },
    {
      path: "expected/finding-history.json",
      bytes: json({
        findingId: findings[12].id,
        events: [
          { id: "soft-delete", action: "soft_delete", at: FIXED_NOW },
          { id: "reconfirm", action: "upstream_reconfirm", at: FIXED_NOW },
        ],
      }),
    },
    {
      path: "expected/bench-runs.jsonl",
      bytes: jsonl(benchRuns),
      rows: benchRuns.length,
    },
    {
      path: "expected/attestations.jsonl",
      bytes: jsonl(attestations),
      rows: attestations.length,
    },
    { path: "cases.json", bytes: json(cases) },
    {
      path: "README.md",
      bytes: text(
        `# Deterministic mock-remote fixture corpus\n\nGenerated by \`generate-seed.ts\` with schema ${FIXTURE_SCHEMA_VERSION}, seed \`${seed}\`, and fixed clock \`${FIXED_NOW}\`. Do not hand-edit generated files.\n\nLarge collections use JSONL. The 6,000-path firmware tree is metadata-only except for the bounded samples under \`firmware/bytes/\`. Forge compute is optional and isolated under \`forge-compute/\`.\n\nManifest \`rows\` counts physical LF-delimited lines. For JSONL that equals records; for CSV it includes the header and trailer lines.\n\nRegenerate from the plugin directory:\n\n\`\`\`sh\n../../node_modules/.bin/tsx test/mock-remote/generate-seed.ts\n../../node_modules/.bin/tsx test/mock-remote/generate-seed.ts --check\n\`\`\`\n`,
      ),
    },
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

async function createGeneratedDirectory(
  seed: string,
  root: string,
): Promise<FixtureManifest> {
  const generated = buildCorpus(seed);
  const drafts = await Promise.all(
    generated.drafts.map(async (draft) =>
      PRETTIER_JSON_DRAFTS.has(draft.path)
        ? {
            ...draft,
            bytes: encoder.encode(
              await format(decoder.decode(draft.bytes), { parser: "json" }),
            ),
          }
        : draft,
    ),
  );
  const { cases, counts } = generated;
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
  const manifestBytes = json(manifest as unknown as JsonValue);
  await writeFile(
    join(root, "manifest.json"),
    encoder.encode(
      await format(decoder.decode(manifestBytes), { parser: "json" }),
    ),
  );
  return manifest;
}

async function listRelativeFiles(
  root: string,
  current = root,
): Promise<string[]> {
  const names = await readdir(current);
  const files: string[] = [];
  for (const name of names.sort(compareText)) {
    const fullPath = join(current, name);
    const info = await lstat(fullPath);
    if (info.isDirectory())
      files.push(...(await listRelativeFiles(root, fullPath)));
    else files.push(relative(root, fullPath).split(sep).join("/"));
  }
  return files;
}

async function assertDirectoriesEqual(
  expected: string,
  actual: string,
): Promise<void> {
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
    throw new FixtureGenerationError(
      "FIXTURE_DRIFT",
      "Fixture file list drift detected",
    );
  }
  for (const file of expectedFiles) {
    const [expectedBytes, actualBytes] = await Promise.all([
      readFile(join(expected, ...file.split("/"))),
      readFile(join(actual, ...file.split("/"))),
    ]);
    if (!expectedBytes.equals(actualBytes)) {
      throw new FixtureGenerationError(
        "FIXTURE_DRIFT",
        `Fixture byte drift detected: ${file}`,
      );
    }
  }
}

async function validateOutputPath(outDir: string): Promise<string> {
  if (outDir.trim().length === 0 || outDir.includes("\0")) {
    throw new FixtureGenerationError(
      "INVALID_OUTPUT",
      "Fixture output path is invalid",
    );
  }
  const resolved = resolve(outDir);
  try {
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      throw new FixtureGenerationError(
        "INVALID_OUTPUT",
        `Fixture output path is not a directory: ${resolved}`,
      );
    }
  } catch (error: unknown) {
    if (error instanceof FixtureGenerationError) throw error;
    try {
      const parentInfo = await stat(dirname(resolved));
      if (!parentInfo.isDirectory())
        throw new Error("parent is not a directory");
    } catch {
      throw new FixtureGenerationError(
        "INVALID_OUTPUT",
        `Fixture output parent does not exist: ${dirname(resolved)}`,
      );
    }
  }
  return resolved;
}

async function replaceDirectoryAtomically(
  staged: string,
  target: string,
): Promise<void> {
  const backup = join(
    dirname(target),
    `.${basename(target)}.backup-${process.pid}`,
  );
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

export async function generateFixtureCorpus(
  options: GenerateOptions,
): Promise<FixtureManifest> {
  validateSeed(options.seed);
  const outDir = await validateOutputPath(options.outDir);
  if (options.check) {
    const tempRoot = await mkdtemp(
      join(tmpdir(), "finite-state-fixture-check-"),
    );
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
    } else
      throw new FixtureGenerationError(
        "INVALID_ARGUMENT",
        `Unknown or incomplete argument: ${argument}`,
      );
  }
  return { seed, outDir, check };
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
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
