import { createHash } from "node:crypto";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../../lib/context.js";
import { findingStableKey } from "../../../../lib/sync/registry.js";
import { registerCachePuller } from "../../../sync/engine/adapter.js";
import { registerFindingsDrift, type FindingsDriftService } from "../index.js";
import {
  deleteVendorDocumentStaging,
  persistVendorDocument,
  persistVendorImport,
  pruneStaleVendorStaging,
  readVendorDocument,
  readVendorImport,
  VENDOR_STAGING_TTL_MS,
} from "./staging.js";

const PROJECT = "platform-staging";
const PV = "version-staging";
const GENERATION = "generation-staging";
const AT = "2026-08-13T13:00:00.000Z";
const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

function vendorImportCount(
  db: ReturnType<ReturnType<typeof createPluginContext>["db"]>,
): number {
  return db
    .prepare("SELECT COUNT(*) FROM triage_runs WHERE source = 'vendor_import'")
    .pluck()
    .get() as number;
}

function backdateCreatedAt(
  db: ReturnType<ReturnType<typeof createPluginContext>["db"]>,
  runId: string,
  createdAt: string,
): void {
  db.prepare(
    `UPDATE triage_runs
        SET created_at = ?, finished_at = ?
      WHERE project_id = ? AND project_version_id = ? AND run_id = ?
        AND source = 'vendor_import'`,
  ).run(createdAt, createdAt, PROJECT, PV, runId);
}

describe("vendor VEX staging", () => {
  it("persists imports in scoped SQLite rows without a 16-entry eviction boundary", () => {
    const host = createFakePluginHost({ pluginId: "vendor-vex-staging" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    const firstDigest = "0".repeat(64);

    for (let index = 0; index < 17; index += 1) {
      const documentSha256 = index.toString(16).padStart(2, "0").repeat(32);
      persistVendorDocument(db, {
        projectId: PROJECT,
        pvId: PV,
        file: `vendor-${index}.json`,
        bytes: Uint8Array.from([index + 1]),
        documentSha256,
      });
    }
    persistVendorImport(db, {
      projectId: PROJECT,
      pvId: PV,
      importId: "vendor-import-1",
      documentSha256: firstDigest,
      vendor: "Supplier",
    });

    expect(
      readVendorDocument(db, {
        projectId: PROJECT,
        pvId: PV,
        documentSha256: firstDigest,
      }),
    ).toEqual({ file: "vendor-0.json", bytes: Uint8Array.from([1]) });
    expect(
      readVendorImport(db, {
        projectId: PROJECT,
        pvId: PV,
        importId: "vendor-import-1",
      }),
    ).toEqual({ documentSha256: firstDigest, vendor: "Supplier" });
    expect(
      readVendorImport(db, {
        projectId: "platform-2",
        pvId: PV,
        importId: "vendor-import-1",
      }),
    ).toBeNull();
    expect(vendorImportCount(db)).toBe(18);
  });

  it("ages out stale vendor_import rows while retaining fresh ones", () => {
    const host = createFakePluginHost({ pluginId: "vendor-vex-ttl" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    const staleDigest = "a".repeat(64);
    const freshDigest = "b".repeat(64);
    const now = new Date("2026-08-14T12:00:00.000Z");

    persistVendorDocument(db, {
      projectId: PROJECT,
      pvId: PV,
      file: "stale.json",
      bytes: Uint8Array.from([1]),
      documentSha256: staleDigest,
    });
    persistVendorImport(db, {
      projectId: PROJECT,
      pvId: PV,
      importId: "vendor-import-stale",
      documentSha256: staleDigest,
      vendor: "Stale",
    });
    persistVendorDocument(db, {
      projectId: PROJECT,
      pvId: PV,
      file: "fresh.json",
      bytes: Uint8Array.from([2]),
      documentSha256: freshDigest,
    });
    persistVendorImport(db, {
      projectId: PROJECT,
      pvId: PV,
      importId: "vendor-import-fresh",
      documentSha256: freshDigest,
      vendor: "Fresh",
    });

    const staleAt = new Date(
      now.getTime() - VENDOR_STAGING_TTL_MS - 60_000,
    ).toISOString();
    backdateCreatedAt(db, `vendor-document-${staleDigest}`, staleAt);
    backdateCreatedAt(db, "vendor-import-stale", staleAt);

    expect(pruneStaleVendorStaging(db, now)).toBe(2);
    expect(
      readVendorDocument(db, {
        projectId: PROJECT,
        pvId: PV,
        documentSha256: staleDigest,
      }),
    ).toBeNull();
    expect(
      readVendorImport(db, {
        projectId: PROJECT,
        pvId: PV,
        importId: "vendor-import-stale",
      }),
    ).toBeNull();
    expect(
      readVendorDocument(db, {
        projectId: PROJECT,
        pvId: PV,
        documentSha256: freshDigest,
      }),
    ).toEqual({ file: "fresh.json", bytes: Uint8Array.from([2]) });
    expect(
      readVendorImport(db, {
        projectId: PROJECT,
        pvId: PV,
        importId: "vendor-import-fresh",
      }),
    ).toEqual({ documentSha256: freshDigest, vendor: "Fresh" });
    expect(vendorImportCount(db)).toBe(2);
  });

  it("re-stages the same sha key after prune (idempotent round-trip)", () => {
    const host = createFakePluginHost({ pluginId: "vendor-vex-restage" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    const bytes = Uint8Array.from([9, 8, 7]);
    const documentSha256 = createHash("sha256").update(bytes).digest("hex");

    persistVendorDocument(db, {
      projectId: PROJECT,
      pvId: PV,
      file: "supplier.json",
      bytes,
      documentSha256,
    });
    deleteVendorDocumentStaging(db, {
      projectId: PROJECT,
      pvId: PV,
      documentSha256,
    });
    expect(
      readVendorDocument(db, { projectId: PROJECT, pvId: PV, documentSha256 }),
    ).toBeNull();

    persistVendorDocument(db, {
      projectId: PROJECT,
      pvId: PV,
      file: "supplier.json",
      bytes,
      documentSha256,
    });
    expect(
      readVendorDocument(db, { projectId: PROJECT, pvId: PV, documentSha256 }),
    ).toEqual({ file: "supplier.json", bytes });
    expect(vendorImportCount(db)).toBe(1);
  });

  it("deletes staged vendor-document and import rows after a successful apply", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "fs-vendor-staging-apply-")),
    );
    roots.push(root);
    const host = createFakePluginHost({
      pluginId: "vendor-vex-apply-prune",
    });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    const db = ctx.db();
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
    const key = findingStableKey(
      {
        cve: "CVE-STAGING-APPLY",
        purl: "pkg:generic/acme/staging@1.0.0",
        name: "staging",
        group: "acme",
        version: "1.0.0",
      },
      "purl",
    );
    db.prepare(
      `INSERT INTO findings
         (project_id, project_version_id, generation_id, finding_id, stable_key,
          cve, component_name, component_group, component_version, component_purl,
          raw, pulled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
    ).run(
      PROJECT,
      PV,
      GENERATION,
      "finding-staging-1",
      key,
      "CVE-STAGING-APPLY",
      "staging",
      "acme",
      "1.0.0",
      "pkg:generic/acme/staging@1.0.0",
      AT,
    );

    registerCachePuller("finding", async () => ({
      fetched: 0,
      baseRows: 0,
      quarantined: 0,
      advisories: [],
    }));
    registerFindingsDrift(ctx);
    const drift = ctx.service<FindingsDriftService>("findings.drift", () => {
      throw new Error("Findings drift services are unavailable");
    });

    const bytes = new TextEncoder().encode(
      JSON.stringify({
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        serialNumber: "urn:uuid:staging-apply",
        components: [
          {
            "bom-ref": "staging-ref",
            purl: "pkg:generic/acme/staging@1.0.0",
            name: "staging",
            version: "1.0.0",
          },
        ],
        vulnerabilities: [
          {
            id: "CVE-STAGING-APPLY",
            affects: [{ ref: "staging-ref" }],
            analysis: {
              state: "not_affected",
              justification: "code_not_reachable",
              detail: "Supplier evidence",
            },
          },
        ],
      }),
    );
    const staged = drift.stageVendorDocument({
      projectId: PROJECT,
      pvId: PV,
      file: "staging-apply.json",
      bytes,
    });
    expect(
      readVendorDocument(db, {
        projectId: PROJECT,
        pvId: PV,
        documentSha256: staged.documentSha256,
      }),
    ).not.toBeNull();

    const preview = await drift.previewVendorVex({
      root,
      projectId: PROJECT,
      pvId: PV,
      documentSha256: staged.documentSha256,
      vendor: "Acme",
    });
    expect(vendorImportCount(db)).toBe(2);

    const applied = await drift.applyVendorVex({
      root,
      projectId: PROJECT,
      pvId: PV,
      importId: preview.importId,
      expectedDocumentSha256: staged.documentSha256,
      overwrite: false,
    });
    expect(applied.written).toBe(1);
    expect(
      readVendorDocument(db, {
        projectId: PROJECT,
        pvId: PV,
        documentSha256: staged.documentSha256,
      }),
    ).toBeNull();
    expect(
      readVendorImport(db, {
        projectId: PROJECT,
        pvId: PV,
        importId: preview.importId,
      }),
    ).toBeNull();
    expect(vendorImportCount(db)).toBe(0);

    // Re-upload after prune mints a fresh digest round with the same sha key.
    const restaged = drift.stageVendorDocument({
      projectId: PROJECT,
      pvId: PV,
      file: "staging-apply.json",
      bytes,
    });
    expect(restaged.documentSha256).toBe(staged.documentSha256);
    expect(
      readVendorDocument(db, {
        projectId: PROJECT,
        pvId: PV,
        documentSha256: restaged.documentSha256,
      }),
    ).toEqual({ file: "staging-apply.json", bytes });
  });
});
