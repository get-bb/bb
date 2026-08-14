import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import Database from "better-sqlite3";
import { format } from "prettier";

import { openStore } from "../../../../lib/store/index.js";
import { MIGRATIONS } from "../../../../lib/store/schema.js";
import type { Json } from "../../../../lib/remote/types.js";
import { parseFindingStableKey } from "../../../../lib/sync/registry.js";
import { pullFindings } from "../../../../lanes/findings/cache/pull.js";
import { normalizeFinding } from "../../../../lanes/findings/cache/pull.js";
import type { FindingsDeps } from "../../../../lanes/findings/cache/types.js";
import {
  readOverlayFiles,
  serializeOverlay,
} from "../../../../lanes/findings/overlay/reader.js";
import {
  stableKeyFor,
  type DecisionInput,
  type TriageOverlayV1,
} from "../../../../lanes/findings/overlay/schema.js";
import {
  openManifest,
  verifyMountIntegrity,
  type FirmwareNode,
} from "../../../../lanes/firmware/cache/manifest.js";
import { MANIFEST_MIGRATIONS } from "../../../../lanes/firmware/cache/manifest-schema.js";
import { pull } from "../../../../lanes/sync/engine/pull.js";

const execFileAsync = promisify(execFile);
const GENERATED_AT = "2026-01-01T00:00:00.000Z";
const PROJECT_ID = "project-ax3000-demo";
const V23_ID = "pv-ax3000-2.3";
const V24_ID = "pv-ax3000-2.4";
const GENERATOR_VERSION = "wp66-v2";
const EXPECTED = {
  newUntriaged: 412,
  policyMatches: 306,
  policyWritten: 305,
  heldKev: 1,
  carryForwardRecovered: 14,
  stale: 9,
  orphans: 2,
} as const;

export type GoldenSeedManifest = {
  seedVersion: 1;
  generatorVersion: typeof GENERATOR_VERSION;
  seed: number;
  sourceSeed: string;
  generatedAt: string;
  products: {
    v23: { pvId: string; firmwareDigest: string; fileCount: number };
    v24: { pvId: string; firmwareDigest: string; fileCount: number };
  };
  expected: typeof EXPECTED;
  artifacts: Array<{
    path: string;
    sha256: string;
    purpose: string;
    schemaVersion?: number;
  }>;
};

type SeedFindingSets = {
  v23: Record<string, Json>[];
  v24: Record<string, Json>[];
  recovered: string[];
  stale: string[];
  orphans: string[];
  matched: string[];
  held: string[];
  decisions: DecisionInput[];
};

type Story = {
  generatorVersion: typeof GENERATOR_VERSION;
  project: { id: typeof PROJECT_ID; product: "AX3000" };
  versions: {
    v23: { pvId: typeof V23_ID; components: ["COMP-httpd"] };
    v24: { pvId: typeof V24_ID; components: ["COMP-httpd"] };
  };
  counts: typeof EXPECTED;
  links: {
    kev: "CVE-2026-31337";
    component: "COMP-httpd";
    threat: "THREAT-22";
    requirementAbsentAtStart: "REQ-118";
    attackPath: "ATTACK-PATH-WAN-HTTPD";
    craClause: "CRA-ANNEX-I-1.2";
    check: "CHECK-HTTPD-WAN";
  };
  drift: {
    recovered: string[];
    stale: string[];
    orphans: string[];
  };
  policy: { matched: string[]; written: string[]; held: string[] };
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    await format(JSON.stringify(value), { parser: "json" }),
    "utf8",
  );
}

async function findingRows(seed: number): Promise<SeedFindingSets> {
  const specimen = JSON.parse(
    await readFile(
      resolve(
        import.meta.dirname,
        "../../../mock-remote/fixtures/platform/fs193-binary-sast-specimen.json",
      ),
      "utf8",
    ),
  ) as Record<string, Json>;
  const componentSpecimen = specimen["component"] as Record<string, Json>;
  const makeRow = (
    index: number,
    options: { purl?: string; cve?: string; idPrefix?: string } = {},
  ): Record<string, Json> => {
    const ordinal = index + 1;
    const kev = index === 0;
    const policyMatch = index < EXPECTED.policyMatches;
    const cve =
      options.cve ??
      (kev ? "CVE-2026-31337" : `CVE-2026-${40_000 + seed * 1_000 + ordinal}`);
    const purl = options.purl ?? "pkg:generic/finite-state/httpd@2.3.1";
    return {
      ...specimen,
      id: `${options.idPrefix ?? "FINDING"}-${String(ordinal).padStart(4, "0")}`,
      findingId: `${options.idPrefix ?? "FINDING"}-${String(ordinal).padStart(4, "0")}`,
      cve,
      vulnerabilityId: `VULN-${seed}-${String(ordinal).padStart(4, "0")}`,
      title: `${cve} on httpd`,
      type: "binary-sast",
      severity: policyMatch ? "high" : "low",
      inKev: kev,
      inVcKev: false,
      vulnInDataset: true,
      hasExploit: kev,
      exploitMaturity: kev ? "weaponized" : "proof-of-concept",
      risk: policyMatch ? 92 : 18,
      riskBand: policyMatch ? "critical" : "low",
      cvssScore: policyMatch ? 9.8 : 3.1,
      epssScore: policyMatch ? "0.971" : "0.014",
      epssPercentile: policyMatch ? "0.998" : "0.210",
      warnings: policyMatch ? 1 : 0,
      violations: policyMatch ? 1 : 0,
      reachabilityScore: policyMatch ? 9 : 0,
      reachability: policyMatch ? "reachable" : "unreachable",
      reachabilityFactors: policyMatch
        ? ["WAN ingress", "http parser"]
        : ["no path"],
      purl,
      component: {
        ...componentSpecimen,
        id: "COMP-httpd",
        name: "httpd",
        version: purl.endsWith("@2.2.0") ? "2.2.0" : "2.3.1",
        appId: "APP-AX3000",
        vcId: "VC-AX3000",
      },
      project: { id: PROJECT_ID, name: "AX3000" },
      projectVersion: {
        id: V24_ID,
        version: "2.4",
        created: GENERATED_AT,
        updated: GENERATED_AT,
      },
      cwes: policyMatch ? ["CWE-119", "CWE-20"] : ["CWE-20"],
      exploitInfo: kev ? [{ type: "test-fixture", public: false }] : [],
      comments: [],
      firstSeen: GENERATED_AT,
      softDeleted: false,
      detected: GENERATED_AT,
    };
  };
  const v24 = Array.from({ length: EXPECTED.newUntriaged }, (_, index) =>
    makeRow(index),
  );
  const recoveredRows = v24.slice(1, 15).map((row, index) => ({
    ...row,
    id: `V23-RECOVERED-${String(index + 1).padStart(2, "0")}`,
    findingId: `V23-RECOVERED-${String(index + 1).padStart(2, "0")}`,
    projectVersion: {
      id: V23_ID,
      version: "2.3",
      created: GENERATED_AT,
      updated: GENERATED_AT,
    },
  }));
  const asV23 = (row: Record<string, Json>): Record<string, Json> => ({
    ...row,
    projectVersion: {
      id: V23_ID,
      version: "2.3",
      created: GENERATED_AT,
      updated: GENERATED_AT,
    },
  });
  const staleRows = v24.slice(15, 24).map((row, index) =>
    asV23(
      makeRow(15 + index, {
        purl: "pkg:generic/finite-state/httpd@2.2.0",
        cve: String(row["cve"]),
        idPrefix: "V23-STALE",
      }),
    ),
  );
  const orphanRows = [0, 1].map((index) =>
    asV23(
      makeRow(500 + index, {
        purl: "pkg:generic/finite-state/httpd@2.2.0",
        cve: `CVE-2025-${99_001 + index}`,
        idPrefix: "V23-ORPHAN",
      }),
    ),
  );
  const v23 = [...recoveredRows, ...staleRows, ...orphanRows];
  const stableKey = (row: Record<string, Json>): string =>
    normalizeFinding(row).stableKey;
  const recovered = recoveredRows.map(stableKey);
  const stale = staleRows.map(stableKey);
  const orphans = orphanRows.map(stableKey);
  const matched = v24.slice(0, EXPECTED.policyMatches).map(stableKey);
  const held = [matched[0]!];
  // The 14 recovered decisions share their stable keys across versions. The
  // stale/orphan baselines remain authored alongside all 305 writable v2.4
  // policy matches, producing 316 unique overlay rows in total.
  const authoredRows = [...v23, ...v24.slice(15, EXPECTED.policyMatches)];
  const decisions = authoredRows.map((row, index): DecisionInput => {
    const normalized = normalizeFinding(row);
    const component = {
      purl: normalized.componentPurl,
      name: normalized.componentName,
      group: normalized.componentGroup,
      version: normalized.componentVersion,
    };
    return {
      project: PROJECT_ID,
      component,
      cve: normalized.cve!,
      stableKey: stableKeyFor(PROJECT_ID, component, normalized.cve!),
      status: "IN_TRIAGE",
      justification: null,
      response: null,
      reason: "Golden Loop deterministic policy decision",
      pin: "exact_version",
      provenance: {
        by: "bb.test/golden-seed",
        at: GENERATED_AT,
        evidence: `offline policy evaluation ${String(index + 1).padStart(3, "0")}`,
      },
      sync: {
        base:
          index < EXPECTED.carryForwardRecovered
            ? {
                status: "IN_TRIAGE",
                justification: null,
                response: null,
                reason: "Golden Loop deterministic policy decision",
              }
            : null,
        pushed_at: index < EXPECTED.carryForwardRecovered ? GENERATED_AT : null,
      },
    };
  });
  return { v23, v24, recovered, stale, orphans, matched, held, decisions };
}

async function createWarmDatabase(
  path: string,
  seed: number,
  rows: SeedFindingSets,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const host = createFakePluginHost({ pluginId: "finite-state-golden-seed" });
  const store = openStore(host.bb);
  const pullScope = async (
    pvId: string,
    scopeRows: Record<string, Json>[],
  ): Promise<void> => {
    const platform: FindingsDeps["platform"] = {
      async *getFindings() {
        for (let offset = 0; offset < scopeRows.length; offset += 137) {
          const items = scopeRows.slice(offset, offset + 137);
          yield {
            items,
            next:
              offset + items.length < scopeRows.length
                ? String(offset + items.length)
                : null,
            total: scopeRows.length,
          };
        }
      },
    };
    await pull(
      {
        db: store.db,
        now: () => new Date(GENERATED_AT),
        createGenerationId: () => `golden-seed-${seed}-${pvId}-findings`,
        adapters: [],
        cachePullers: [
          {
            kind: "finding",
            pull: async (scope, generationId, onProgress) => {
              const result = await pullFindings(
                { db: store.db, platform, pageSize: 137 },
                scope,
                generationId,
                onProgress,
              );
              return {
                fetched: result.fetched,
                baseRows: result.published,
                quarantined: result.quarantined,
                advisories: result.advisories,
              };
            },
          },
        ],
      },
      { projectId: PROJECT_ID, projectVersionId: pvId },
      ["finding"],
    );
  };
  try {
    await pullScope(V23_ID, rows.v23);
    await pullScope(V24_ID, rows.v24);
    store.db
      .prepare("UPDATE _bb_migrations SET applied_at = ?")
      .run(Date.parse(GENERATED_AT));
    store.db.pragma("journal_mode = DELETE");
    store.db.exec("VACUUM");
    const sourcePath = store.db.name;
    store.db.close();
    await copyFile(sourcePath, path);
  } finally {
    await host.harness.lifecycle.dispose();
  }
}

const FILES = {
  v23: {
    "/etc/ax3000-release": "AX3000_VERSION=2.3\n",
    "/usr/sbin/httpd": "ELF-TEST:httpd:2.3.1:vulnerable-parser\n",
    "/etc/httpd/httpd.conf": "listen=0.0.0.0:80\nwan=true\n",
    "/lib/libcrypto.so": "ELF-TEST:libcrypto:3.0.0\n",
  },
  v24: {
    "/etc/ax3000-release": "AX3000_VERSION=2.4\n",
    "/usr/sbin/httpd": "ELF-TEST:httpd:2.3.1:bounded-parser\n",
    "/etc/httpd/httpd.conf":
      "listen=0.0.0.0:80\nwan=true\nrequest_limit=8192\n",
    "/lib/libcrypto.so": "ELF-TEST:libcrypto:3.0.0\n",
  },
} as const;

function firmwareDigest(files: Readonly<Record<string, string>>): string {
  const hash = createHash("sha256");
  for (const path of Object.keys(files).sort()) {
    hash.update(path).update("\0").update(files[path]!).update("\0");
  }
  return hash.digest("hex");
}

async function initializeNestedWorktree(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
}

async function createFirmware(
  worktree: string,
  pvId: string,
  files: Readonly<Record<string, string>>,
  fullyMaterialized: boolean,
  unpackErrors: string[] = [],
): Promise<{ digest: string; fileCount: number }> {
  const rootfs = join(worktree, ".fs-firmware", pvId, "rootfs");
  const nodes: FirmwareNode[] = [];
  const directories = new Set<string>();
  for (const [virtualPath, content] of Object.entries(files)) {
    const relativePath = virtualPath.slice(1);
    const diskPath = join(rootfs, relativePath);
    await mkdir(dirname(diskPath), { recursive: true });
    await writeFile(diskPath, content, "utf8");
    await chmod(diskPath, 0o755);
    let parent = dirname(virtualPath);
    while (parent !== "/" && parent !== ".") {
      directories.add(parent);
      parent = dirname(parent);
    }
    nodes.push({
      path: virtualPath,
      kind: "file",
      fileHash: sha256(content),
      size: Buffer.byteLength(content),
      mimeType: "application/octet-stream",
      fullType: "Golden Loop synthetic firmware bytes",
      unixMode: 0o755,
      symlinkTarget: null,
      materialized: true,
      errors: [],
    });
  }
  for (const path of [...directories].sort())
    nodes.push({
      path,
      kind: "directory",
      fileHash: null,
      size: null,
      mimeType: null,
      fullType: null,
      unixMode: 0o755,
      symlinkTarget: null,
      materialized: false,
      errors: [],
    });
  const digest = firmwareDigest(files);
  const manifest = openManifest(worktree, pvId);
  if (manifest.invalidReason) throw new Error(manifest.invalidReason);
  manifest.replaceNodes(nodes, {
    pvId,
    scanId: `scan-${pvId}`,
    inputSha256: digest,
    source: "standalone_unpack",
    artifactHash: digest,
    fullyMaterialized,
    materializedAt: GENERATED_AT,
    nodeCount: nodes.length,
    hydratedCount: Object.keys(files).length,
    adminBytesOk: null,
    unpackErrors,
    stale: false,
  });
  verifyMountIntegrity(manifest);
  manifest.database.exec(
    `UPDATE fs_node
        SET verified_dev = NULL,
            verified_ino = NULL,
            verified_mtime_ns = NULL,
            verified_ctime_ns = NULL`,
  );
  manifest.database
    .prepare("UPDATE _fs_migrations SET applied_at = ?")
    .run(GENERATED_AT);
  manifest.database.pragma("wal_checkpoint(TRUNCATE)");
  manifest.database.pragma("journal_mode = DELETE");
  manifest.database.exec("VACUUM");
  const manifestFile = manifest.path;
  manifest.close();
  await rm(`${manifestFile}-wal`, { force: true });
  await rm(`${manifestFile}-shm`, { force: true });
  return { digest, fileCount: Object.keys(files).length };
}

async function createOverlays(
  worktree: string,
  findings: SeedFindingSets,
): Promise<void> {
  const overlays = new Map<string, TriageOverlayV1>();
  for (const input of findings.decisions) {
    const identity = JSON.stringify(input.component);
    const overlay = overlays.get(identity) ?? {
      schema: "fs-triage/v1",
      project: input.project,
      component: input.component,
      decisions: {},
    };
    overlay.decisions[input.cve] = {
      status: input.status,
      justification: input.justification,
      response: input.response,
      reason: input.reason,
      pin: input.pin ?? "exact_version",
      provenance: input.provenance,
      sync: input.sync ?? { base: null, pushed_at: null },
    };
    overlays.set(identity, overlay);
  }
  const directory = join(worktree, ".fs", "triage", PROJECT_ID);
  await mkdir(directory, { recursive: true });
  for (const [index, overlay] of [...overlays.values()].entries())
    await writeFile(
      join(directory, `httpd-${index + 1}.yaml`),
      serializeOverlay(overlay),
      "utf8",
    );
  const corpus = await readOverlayFiles(worktree);
  const authored = corpus.files.flatMap((file) =>
    Object.keys(file.overlay.decisions).map((cve) =>
      stableKeyFor(file.overlay.project, file.overlay.component, cve),
    ),
  );
  if (
    corpus.errors.length > 0 ||
    authored.length !==
      EXPECTED.policyWritten + EXPECTED.stale + EXPECTED.orphans
  )
    throw new Error("generated triage overlay count mismatch");
}

function story(findings: SeedFindingSets): Story {
  return {
    generatorVersion: GENERATOR_VERSION,
    project: { id: PROJECT_ID, product: "AX3000" },
    versions: {
      v23: { pvId: V23_ID, components: ["COMP-httpd"] },
      v24: { pvId: V24_ID, components: ["COMP-httpd"] },
    },
    counts: EXPECTED,
    links: {
      kev: "CVE-2026-31337",
      component: "COMP-httpd",
      threat: "THREAT-22",
      requirementAbsentAtStart: "REQ-118",
      attackPath: "ATTACK-PATH-WAN-HTTPD",
      craClause: "CRA-ANNEX-I-1.2",
      check: "CHECK-HTTPD-WAN",
    },
    drift: {
      recovered: findings.recovered,
      stale: findings.stale,
      orphans: findings.orphans,
    },
    policy: {
      matched: findings.matched,
      written: findings.matched.slice(1),
      held: findings.held,
    },
  };
}

const TEST_VECTOR_SEED = Buffer.from(
  "9d61b19deffd5a60ba844af492ec2cc4" + "4449c5697b326919703bac031cae7f60",
  "hex",
);

function dssePayload(firmware: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      _type: "https://in-toto.io/Statement/v1",
      subject: [{ name: "AX3000-v2.4-firmware", digest: { sha256: firmware } }],
      predicateType: "https://slsa.dev/provenance/v1",
      predicate: {
        buildDefinition: { buildType: "bb.test/offline-golden-loop" },
        runDetails: {
          builder: { id: "bb.test/finite-state-golden-seed" },
          metadata: { invocationId: "RUN-OFFLINE-AX3000-24" },
        },
      },
    }),
  );
}

function pae(payloadType: string, payload: Buffer): Buffer {
  return Buffer.from(
    `DSSEv1 ${Buffer.byteLength(payloadType)} ${payloadType} ${payload.length} ${payload.toString()}`,
  );
}

async function createAttestation(
  root: string,
  firmware: string,
): Promise<void> {
  const payloadType = "application/vnd.in-toto+json";
  const pkcs8 = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    TEST_VECTOR_SEED,
  ]);
  const privateKey = createPrivateKey({
    key: pkcs8,
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey);
  const payload = dssePayload(firmware);
  const signature = sign(null, pae(payloadType, payload), privateKey);
  await writeJson(join(root, "attestations", "ax3000-v24.dsse.json"), {
    fixtureIdentity:
      "TEST ONLY — RFC 8032 vector identity; no public Rekor inclusion",
    payloadType,
    payload: payload.toString("base64"),
    signatures: [
      { keyid: "rfc8032-test-vector-1", sig: signature.toString("base64") },
    ],
    transparencyLog: {
      included: false,
      service: "none",
      reason: "offline test fixture",
    },
  });
  await writeFile(
    join(root, "attestations", "rfc8032-test-vector-1.pub.pem"),
    publicKey.export({ type: "spki", format: "pem" }),
  );
}

async function filesBelow(root: string): Promise<string[]> {
  const result: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(
      () => [],
    )) {
      if (
        entry.name === ".git" ||
        entry.name.endsWith("-wal") ||
        entry.name.endsWith("-shm")
      )
        continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) result.push(path);
    }
  };
  await walk(root);
  return result.sort();
}

function purpose(path: string): string {
  if (path.endsWith("data.db"))
    return "production-migrated offline finding cache";
  if (path.endsWith("manifest.sqlite"))
    return "production firmware mount manifest";
  if (path.includes("attestations/"))
    return "offline test attestation verification material";
  if (path.includes("pv-ax3000-unpack-gap/rootfs/"))
    return "explicit non-fatal unpack-gap honesty fixture";
  if (path.includes("rootfs/"))
    return "fully materialized synthetic firmware file";
  if (path.endsWith("story.json"))
    return "Golden Loop identities, counts, and drift cross-links";
  if (path.includes("/.fs/triage/"))
    return "production-format authored VEX triage overlay";
  if (path.endsWith("trace.json"))
    return "source, binary, firmware, run, and attestation trace links";
  if (path.endsWith("run-events.json"))
    return "deterministic offline bench run and event sequence";
  if (path.endsWith("cra-clause.json"))
    return "CRA clause, check, and missing-requirement fixture";
  if (path.endsWith("THREAT-22.json"))
    return "reachable KEV threat and WAN attack-path fixture";
  if (path.endsWith(".gitignore"))
    return "firmware cache repository-safety fixture";
  if (path.endsWith("generate.ts"))
    return "versioned deterministic Golden Loop generator";
  if (path.endsWith("seed.test.ts"))
    return "seed determinism, integrity, and safety tests";
  if (path.includes("src/")) return "traceable source repair fixture";
  return "deterministic Golden Loop seed artifact";
}

export async function generateGoldenSeed(
  destination: string,
  seed: number,
): Promise<GoldenSeedManifest> {
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new Error("seed must be a non-negative integer");
  const root = resolve(destination);
  await mkdir(root, { recursive: true });
  for (const owned of ["worktree", "warm-cache", "attestations"])
    await rm(join(root, owned), { recursive: true, force: true });
  const worktree = join(root, "worktree");
  await initializeNestedWorktree(worktree);
  const sourceBefore =
    "/* Golden Loop synthetic source v2.3 */\nint request_limit(void) { return -1; }\n";
  const sourceAfter =
    "/* Golden Loop synthetic source */\nint request_limit(void) { return 8192; }\n";
  await mkdir(join(worktree, "src", "v2.3"), { recursive: true });
  await mkdir(join(worktree, "src", "v2.4"), { recursive: true });
  await writeFile(
    join(worktree, "src", "v2.3", "httpd.c"),
    sourceBefore,
    "utf8",
  );
  await writeFile(
    join(worktree, "src", "v2.4", "httpd.c"),
    sourceAfter,
    "utf8",
  );
  const findings = await findingRows(seed);
  await createOverlays(worktree, findings);
  await writeJson(
    join(worktree, ".fs", "golden-loop", "story.json"),
    story(findings),
  );
  await writeJson(join(worktree, ".fs", "threats", "THREAT-22.json"), {
    id: "THREAT-22",
    component: "COMP-httpd",
    finding: "CVE-2026-31337",
    attackPath: {
      id: "ATTACK-PATH-WAN-HTTPD",
      crosses: ["WAN", "dmz", "httpd"],
    },
  });
  await writeJson(join(worktree, ".fs", "compliance", "cra-clause.json"), {
    clause: "CRA-ANNEX-I-1.2",
    check: "CHECK-HTTPD-WAN",
    missingRequirement: "REQ-118",
  });
  const v23 = await createFirmware(worktree, V23_ID, FILES.v23, true);
  const v24 = await createFirmware(worktree, V24_ID, FILES.v24, true);
  await writeJson(join(worktree, ".fs", "golden-loop", "trace.json"), {
    source: {
      before: { path: "src/v2.3/httpd.c", sha256: sha256(sourceBefore) },
      after: { path: "src/v2.4/httpd.c", sha256: sha256(sourceAfter) },
    },
    binary: {
      path: `.fs-firmware/${V24_ID}/rootfs/usr/sbin/httpd`,
      sha256: sha256(FILES.v24["/usr/sbin/httpd"]),
    },
    firmware: { pvId: V24_ID, sha256: v24.digest },
    run: "RUN-OFFLINE-AX3000-24",
    attestation: "attestations/ax3000-v24.dsse.json",
  });
  await createFirmware(
    worktree,
    "pv-ax3000-unpack-gap",
    { "/README.txt": "non-fatal unpack gap honesty fixture\n" },
    false,
    ["TEST_GAP: optional squashfs segment intentionally unavailable"],
  );
  await createWarmDatabase(join(root, "warm-cache", "data.db"), seed, findings);
  await writeJson(join(root, "warm-cache", "run-events.json"), {
    runId: "RUN-OFFLINE-AX3000-24",
    firmwareDigest: v24.digest,
    events: [
      { sequence: 1, at: GENERATED_AT, type: "queued" },
      { sequence: 2, at: "2026-01-01T00:00:01.000Z", type: "started" },
      {
        sequence: 3,
        at: "2026-01-01T00:00:02.000Z",
        type: "completed",
        result: "verified",
      },
    ],
  });
  await createAttestation(root, v24.digest);
  // The nested repository exists only so production firmware layout guards
  // run during generation. The committed harness copy is ordinary data.
  await rm(join(worktree, ".git"), { recursive: true, force: true });
  const sourceManifest = await readFile(
    resolve(import.meta.dirname, "../../../mock-remote/fixtures/manifest.json"),
  );
  const products = {
    v23: { pvId: V23_ID, firmwareDigest: v23.digest, fileCount: v23.fileCount },
    v24: { pvId: V24_ID, firmwareDigest: v24.digest, fileCount: v24.fileCount },
  };
  const artifactPaths = (await filesBelow(root)).filter(
    (path) => relative(root, path) !== "manifest.json",
  );
  const artifacts = await Promise.all(
    artifactPaths.map(async (path) => {
      const relativePath = relative(root, path).split(sep).join("/");
      const artifact = {
        path: relativePath,
        sha256: sha256(await readFile(path)),
        purpose: purpose(relativePath),
      };
      if (relativePath.endsWith("data.db"))
        return { ...artifact, schemaVersion: MIGRATIONS.length };
      if (relativePath.endsWith("manifest.sqlite"))
        return { ...artifact, schemaVersion: MANIFEST_MIGRATIONS.length };
      return artifact;
    }),
  );
  const manifest: GoldenSeedManifest = {
    seedVersion: 1,
    generatorVersion: GENERATOR_VERSION,
    seed,
    sourceSeed: `wp08-sha256:${sha256(sourceManifest)};seed=${seed};generator=${GENERATOR_VERSION}`,
    generatedAt: GENERATED_AT,
    products,
    expected: EXPECTED,
    artifacts,
  };
  await writeJson(join(root, "manifest.json"), manifest);
  return manifest;
}

function parseManifest(value: unknown): GoldenSeedManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("manifest schema mismatch: root must be an object");
  const manifest = value as Partial<GoldenSeedManifest>;
  if (
    manifest.seedVersion !== 1 ||
    manifest.generatorVersion !== GENERATOR_VERSION ||
    !Number.isSafeInteger(manifest.seed) ||
    !manifest.sourceSeed?.endsWith(
      `;seed=${manifest.seed};generator=${GENERATOR_VERSION}`,
    ) ||
    manifest.generatedAt !== GENERATED_AT ||
    manifest.expected?.newUntriaged !== 412 ||
    !Array.isArray(manifest.artifacts)
  )
    throw new Error("manifest schema mismatch");
  return manifest as GoldenSeedManifest;
}

export function semanticDatabaseDump(path: string): Record<string, unknown[]> {
  const db = new Database(path, { readonly: true });
  try {
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .pluck()
        .all() as string[]
    ).filter((name) => name !== "_bb_migrations");
    return Object.fromEntries(
      tables.map((table) => {
        if (!/^[A-Za-z0-9_]+$/u.test(table))
          throw new Error("unsafe SQLite table name");
        return [
          table,
          db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ];
      }),
    );
  } finally {
    db.close();
  }
}

export async function verifyGoldenSeed(rootInput: string): Promise<void> {
  const root = resolve(rootInput);
  const manifest = parseManifest(
    JSON.parse(await readFile(join(root, "manifest.json"), "utf8")),
  );
  const actualPaths = (await filesBelow(root))
    .map((path) => relative(root, path).split(sep).join("/"))
    .filter((path) => path !== "manifest.json");
  const declaredPaths = manifest.artifacts.map(({ path }) => path).sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(declaredPaths))
    throw new Error("artifact inventory mismatch");
  for (const artifact of manifest.artifacts) {
    const actual = sha256(await readFile(join(root, artifact.path)));
    if (actual !== artifact.sha256)
      throw new Error(`integrity error: ${artifact.path}`);
  }
  const storyValue = JSON.parse(
    await readFile(
      join(root, "worktree", ".fs", "golden-loop", "story.json"),
      "utf8",
    ),
  ) as Story;
  if (
    JSON.stringify(storyValue.counts) !== JSON.stringify(manifest.expected) ||
    storyValue.policy.matched.length !== 306 ||
    storyValue.policy.written.length !== 305 ||
    storyValue.policy.held.length !== 1 ||
    storyValue.drift.recovered.length !== 14 ||
    storyValue.drift.stale.length !== 9 ||
    storyValue.drift.orphans.length !== 2 ||
    storyValue.links.kev !== "CVE-2026-31337" ||
    storyValue.links.component !== "COMP-httpd" ||
    storyValue.links.threat !== "THREAT-22" ||
    storyValue.links.requirementAbsentAtStart !== "REQ-118"
  )
    throw new Error("Golden Loop story cross-link mismatch");
  const trace = JSON.parse(
    await readFile(
      join(root, "worktree", ".fs", "golden-loop", "trace.json"),
      "utf8",
    ),
  ) as {
    source: {
      before: { path: string; sha256: string };
      after: { path: string; sha256: string };
    };
    binary: { path: string; sha256: string };
    firmware: { pvId: string; sha256: string };
    run: string;
    attestation: string;
  };
  const traceRoot = join(root, "worktree");
  if (
    trace.source.before.sha256 !==
      sha256(await readFile(join(traceRoot, trace.source.before.path))) ||
    trace.source.after.sha256 !==
      sha256(await readFile(join(traceRoot, trace.source.after.path))) ||
    trace.binary.sha256 !==
      sha256(await readFile(join(traceRoot, trace.binary.path))) ||
    trace.firmware.pvId !== manifest.products.v24.pvId ||
    trace.firmware.sha256 !== manifest.products.v24.firmwareDigest ||
    trace.run !== "RUN-OFFLINE-AX3000-24" ||
    trace.attestation !== "attestations/ax3000-v24.dsse.json"
  )
    throw new Error("Golden Loop trace cross-link mismatch");
  const dataDb = new Database(join(root, "warm-cache", "data.db"), {
    readonly: true,
  });
  try {
    const migrationCount = dataDb
      .prepare("SELECT COUNT(*) FROM _bb_migrations")
      .pluck()
      .get();
    const findingCount = dataDb
      .prepare("SELECT COUNT(*) FROM findings WHERE project_version_id = ?")
      .pluck()
      .get(V24_ID);
    const baselineCount = dataDb
      .prepare("SELECT COUNT(*) FROM findings WHERE project_version_id = ?")
      .pluck()
      .get(V23_ID);
    const kev = dataDb
      .prepare(
        `SELECT stable_key, component_name, component_group,
                component_version, component_purl, cve, in_kev,
                severity, risk_score, band, cvss_score, cvss_vector,
                epss_score, epss_percentile, has_exploit,
                exploit_maturity, reachability_score,
                reachability_verdict, reachability_factors,
                vuln_in_dataset, cwes, warning_count, violation_count,
                location, first_seen
           FROM findings
          WHERE project_version_id = ? AND cve = ?`,
      )
      .get(V24_ID, "CVE-2026-31337") as
      | Record<string, string | number | null>
      | undefined;
    if (migrationCount !== MIGRATIONS.length)
      throw new Error("data.db schema mismatch");
    const showcaseFields = [
      "component_name",
      "component_group",
      "component_version",
      "component_purl",
      "severity",
      "risk_score",
      "band",
      "cvss_score",
      "cvss_vector",
      "epss_score",
      "epss_percentile",
      "exploit_maturity",
      "reachability_score",
      "reachability_verdict",
      "reachability_factors",
      "vuln_in_dataset",
      "cwes",
      "warning_count",
      "violation_count",
      "location",
      "first_seen",
    ];
    if (
      findingCount !== EXPECTED.newUntriaged ||
      baselineCount !== 25 ||
      kev?.["component_name"] !== "httpd" ||
      kev["in_kev"] !== 1 ||
      kev["has_exploit"] !== 1 ||
      showcaseFields.some((field) => kev[field] === null) ||
      parseFindingStableKey(String(kev["stable_key"])).tier !== "purl"
    )
      throw new Error("data.db Golden Loop cross-link mismatch");

    const v23Rows = dataDb
      .prepare(
        "SELECT stable_key, cve FROM findings WHERE project_version_id = ?",
      )
      .all(V23_ID) as Array<{ stable_key: string; cve: string }>;
    const v24Rows = dataDb
      .prepare(
        "SELECT stable_key, cve FROM findings WHERE project_version_id = ?",
      )
      .all(V24_ID) as Array<{ stable_key: string; cve: string }>;
    const v23Keys = new Set(v23Rows.map(({ stable_key }) => stable_key));
    const v24Keys = new Set(v24Rows.map(({ stable_key }) => stable_key));
    const v24Cves = new Set(v24Rows.map(({ cve }) => cve));
    if (
      !storyValue.policy.matched.every((key) => v24Keys.has(key)) ||
      !storyValue.drift.recovered.every(
        (key) => v23Keys.has(key) && v24Keys.has(key),
      ) ||
      !storyValue.drift.stale.every(
        (key) =>
          v23Keys.has(key) &&
          !v24Keys.has(key) &&
          v24Cves.has(parseFindingStableKey(key).cve),
      ) ||
      !storyValue.drift.orphans.every(
        (key) =>
          v23Keys.has(key) &&
          !v24Keys.has(key) &&
          !v24Cves.has(parseFindingStableKey(key).cve),
      )
    )
      throw new Error("data.db drift baseline mismatch");
  } finally {
    dataDb.close();
  }
  const overlays = await readOverlayFiles(join(root, "worktree"));
  const authoredKeys = overlays.files.flatMap((file) =>
    Object.keys(file.overlay.decisions).map((cve) =>
      stableKeyFor(file.overlay.project, file.overlay.component, cve),
    ),
  );
  if (
    overlays.errors.length > 0 ||
    authoredKeys.length !==
      EXPECTED.policyWritten + EXPECTED.stale + EXPECTED.orphans ||
    !storyValue.policy.written.every((key) => authoredKeys.includes(key)) ||
    JSON.stringify([...authoredKeys].sort()) !==
      JSON.stringify(
        [
          ...storyValue.policy.written,
          ...storyValue.drift.stale,
          ...storyValue.drift.orphans,
        ].sort(),
      )
  )
    throw new Error("triage overlay cross-link mismatch");
  const worktree = join(root, "worktree");
  for (const product of [manifest.products.v23, manifest.products.v24]) {
    const manifestPath = join(
      worktree,
      ".fs-firmware",
      product.pvId,
      "manifest.sqlite",
    );
    const firmware = new Database(manifestPath, { readonly: true });
    try {
      const migrations = firmware
        .prepare("SELECT COUNT(*) FROM _fs_migrations")
        .pluck()
        .get();
      const meta = new Map(
        (
          firmware.prepare("SELECT key, value FROM fs_meta").all() as Array<{
            key: string;
            value: string;
          }>
        ).map(({ key, value }) => [key, JSON.parse(value) as unknown]),
      );
      const nodes = firmware
        .prepare(
          "SELECT path, file_hash, size, materialized, errors FROM fs_node WHERE kind = 'file' ORDER BY path",
        )
        .all() as Array<{
        path: string;
        file_hash: string;
        size: number;
        materialized: number;
        errors: string;
      }>;
      let coherent = true;
      for (const node of nodes) {
        const bytes = await readFile(
          join(
            worktree,
            ".fs-firmware",
            product.pvId,
            "rootfs",
            node.path.slice(1),
          ),
        );
        coherent &&=
          node.materialized === 1 &&
          node.errors === "[]" &&
          node.size === bytes.length &&
          sha256(bytes) === node.file_hash;
      }
      if (
        migrations !== MANIFEST_MIGRATIONS.length ||
        meta.get("artifact_hash") !== product.firmwareDigest ||
        meta.get("fully_materialized") !== true ||
        nodes.length !== product.fileCount ||
        !coherent
      )
        throw new Error(`${product.pvId} firmware cross-link mismatch`);
    } finally {
      firmware.close();
    }
  }
  const envelope = JSON.parse(
    await readFile(join(root, "attestations", "ax3000-v24.dsse.json"), "utf8"),
  ) as {
    payloadType: string;
    payload: string;
    signatures: Array<{ sig: string }>;
    transparencyLog: { included: boolean };
    fixtureIdentity: string;
  };
  const payload = Buffer.from(envelope.payload, "base64");
  const statement = JSON.parse(payload.toString()) as {
    subject: Array<{ digest: { sha256: string } }>;
  };
  if (
    statement.subject[0]?.digest.sha256 !== manifest.products.v24.firmwareDigest
  )
    throw new Error("attestation subject mismatch");
  if (
    envelope.transparencyLog.included ||
    !envelope.fixtureIdentity.startsWith("TEST ONLY")
  )
    throw new Error("attestation provenance safety mismatch");
  const publicKey = createPublicKey(
    await readFile(
      join(root, "attestations", "rfc8032-test-vector-1.pub.pem"),
      "utf8",
    ),
  );
  if (
    !verify(
      null,
      pae(envelope.payloadType, payload),
      publicKey,
      Buffer.from(envelope.signatures[0]?.sig ?? "", "base64"),
    )
  )
    throw new Error("attestation signature mismatch");
}

async function isEntrypoint(): Promise<boolean> {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  return (
    (await realpath(argvPath).catch(() => resolve(argvPath))) ===
    fileURLToPath(import.meta.url)
  );
}

if (await isEntrypoint()) {
  const verifyIndex = process.argv.indexOf("--verify");
  if (verifyIndex >= 0) {
    await verifyGoldenSeed(
      process.argv[verifyIndex + 1] ?? import.meta.dirname,
    );
  } else {
    const destination = process.argv[2] ?? import.meta.dirname;
    const seed = Number(process.argv[3] ?? "66");
    await generateGoldenSeed(destination, seed);
  }
}
