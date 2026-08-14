import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../../lib/context.js";
import { findingStableKey } from "../../../../lib/sync/registry.js";
import { readVexWorking } from "../../../sync/entities/vex-decision.js";
import { rebuildOverlayIndex } from "../../overlay/indexer.js";
import { readOverlayFiles } from "../../overlay/reader.js";
import { stableKeyFor } from "../../overlay/schema.js";
import { setDecision } from "../../overlay/writer.js";
import { importVendorVexBytes } from "./import.js";
import { MAX_VENDOR_VEX_BYTES, VendorVexParseError } from "./parse.js";

const PROJECT = "project-vendor";
const PV = "pv-vendor";
const GENERATION = "generation-vendor";
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

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "fs-vendor-vex-")));
  roots.push(root);
  const host = createFakePluginHost({ pluginId: `vendor-vex-${hosts.length}` });
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
  return { root, db };
}

function addFinding(
  db: Awaited<ReturnType<typeof fixture>>["db"],
  input: {
    id: string;
    cve: string;
    purl: string;
    name: string;
    group: string | null;
    version: string;
  },
): void {
  const key = findingStableKey(
    {
      cve: input.cve,
      purl: input.purl,
      name: input.name,
      group: input.group,
      version: input.version,
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
    input.id,
    key,
    input.cve,
    input.name,
    input.group,
    input.version,
    input.purl,
    AT,
  );
}

async function document(
  root: string,
  name: string,
  value: unknown,
): Promise<string> {
  const file = join(root, name);
  await writeFile(
    file,
    typeof value === "string" || Buffer.isBuffer(value)
      ? value
      : JSON.stringify(value),
  );
  return file;
}

function deps(value: Awaited<ReturnType<typeof fixture>>) {
  return { db: value.db, root: value.root, projectId: PROJECT, pvId: PV };
}

describe("vendor VEX import", () => {
  it("maps CycloneDX status, justification, and response with digest-bound provenance", async () => {
    const value = await fixture();
    addFinding(value.db, {
      id: "101",
      cve: "CVE-CDX",
      purl: "pkg:generic/acme/cdx@1.0.0",
      name: "cdx",
      group: "acme",
      version: "1.0.0",
    });
    const file = await document(value.root, "cyclonedx.json", {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      serialNumber: "urn:uuid:cyclonedx-source",
      components: [
        {
          "bom-ref": "cdx-ref",
          purl: "pkg:generic/acme/cdx@1.0.0",
          name: "cdx",
          version: "1.0.0",
        },
      ],
      vulnerabilities: [
        {
          id: "CVE-CDX",
          affects: [{ ref: "cdx-ref" }],
          analysis: {
            state: "not_affected",
            justification: "code_not_reachable",
            response: ["update"],
            detail: "Supplier call graph evidence",
          },
        },
      ],
    });
    const result = await importVendorVexBytes(
      deps(value),
      "cyclonedx.json",
      await readFile(file),
      {
        vendor: "Acme",
        overwrite: false,
        dryRun: false,
      },
    );
    expect(result).toMatchObject({
      matched: 1,
      unmatched: 0,
      needsCompletion: 0,
      keptLocal: 0,
      written: 1,
      errors: [],
    });
    expect(result.source.digest).toMatch(/^[0-9a-f]{64}$/u);
    const overlays = await readOverlayFiles(value.root);
    const proposal = Object.values(
      overlays.files[0]?.overlay.proposals ?? {},
    )[0];
    expect(proposal).toMatchObject({
      status: "NOT_AFFECTED",
      justification: "CODE_NOT_REACHABLE",
      response: "UPDATE",
      reason: "Supplier call graph evidence",
      match: "matched",
      state: "proposal",
      provenance: {
        by: "vendor:Acme",
        import_id: expect.stringMatching(/^vendor-/u),
      },
      source: {
        format: "cyclonedx",
        document_id: "urn:uuid:cyclonedx-source",
        document_sha256: result.source.digest,
      },
    });
    expect(
      value.db
        .prepare("SELECT entity_kind, local_state FROM overlay_index")
        .get(),
    ).toEqual({
      entity_kind: "vendorProposal",
      local_state: "dirty",
    });
  });

  it("retains unmatched OpenVEX NOT_AFFECTED as a null, plan-excluded needs-completion proposal", async () => {
    const value = await fixture();
    const file = await document(value.root, "openvex.json", {
      "@context": "https://openvex.dev/ns/v0.2.0",
      "@id": "https://vendor.example/vex/42",
      author: "Supplier",
      timestamp: AT,
      version: 1,
      statements: [
        {
          vulnerability: { name: "CVE-OPEN" },
          products: [{ "@id": "pkg:generic/acme/future@9.0.0" }],
          status: "not_affected",
        },
      ],
    });
    const first = await importVendorVexBytes(
      deps(value),
      file,
      await readFile(file),
      {
        vendor: "Open Supplier",
        overwrite: false,
        dryRun: false,
      },
    );
    expect(first).toMatchObject({
      matched: 0,
      unmatched: 1,
      needsCompletion: 1,
      written: 1,
      errors: [],
    });
    const overlays = await readOverlayFiles(value.root);
    const proposal = Object.values(
      overlays.files[0]?.overlay.proposals ?? {},
    )[0];
    expect(proposal).toMatchObject({
      status: "NOT_AFFECTED",
      justification: null,
      response: null,
      reason: null,
      state: "needs_completion",
      match: "none",
      target_stable_key: null,
    });
    const yaml = await readFile(overlays.files[0]?.absoluteFile ?? "", "utf8");
    expect(yaml).not.toContain("CODE_NOT_PRESENT");
    expect(yaml).not.toContain("WILL_NOT_FIX");
    await expect(
      readVexWorking(value.root, { projectId: PROJECT, projectVersionId: PV }),
    ).resolves.toEqual([]);
    const repeated = await importVendorVexBytes(
      deps(value),
      file,
      await readFile(file),
      {
        vendor: "Open Supplier",
        overwrite: false,
        dryRun: false,
      },
    );
    expect(repeated.written).toBe(0);
  });

  it("maps CSAF product status and retains the document tracking identity", async () => {
    const value = await fixture();
    addFinding(value.db, {
      id: "201",
      cve: "CVE-CSAF",
      purl: "pkg:generic/acme/csaf@2.0.0",
      name: "csaf",
      group: "acme",
      version: "2.0.0",
    });
    const file = await document(value.root, "csaf.json", {
      document: { category: "csaf_vex", tracking: { id: "ACME-CSAF-22" } },
      product_tree: {
        branches: [
          {
            category: "product_name",
            name: "csaf",
            product: {
              product_id: "CSAF-PRODUCT-1",
              name: "csaf",
              product_identification_helper: {
                purl: "pkg:generic/acme/csaf@2.0.0",
              },
            },
          },
        ],
      },
      vulnerabilities: [
        {
          cve: "CVE-CSAF",
          product_status: { known_affected: ["CSAF-PRODUCT-1"] },
        },
      ],
    });
    const preview = await importVendorVexBytes(
      deps(value),
      file,
      await readFile(file),
      {
        vendor: "CSAF Supplier",
        overwrite: false,
        dryRun: true,
      },
    );
    expect(preview).toMatchObject({ matched: 1, written: 0 });
    expect((await readOverlayFiles(value.root)).files).toEqual([]);
    const result = await importVendorVexBytes(
      deps(value),
      file,
      await readFile(file),
      {
        vendor: "CSAF Supplier",
        overwrite: false,
        dryRun: false,
      },
    );
    expect(result).toMatchObject({
      matched: 1,
      unmatched: 0,
      written: 1,
      errors: [],
    });
    const overlays = await readOverlayFiles(value.root);
    expect(
      Object.values(overlays.files[0]?.overlay.proposals ?? {})[0],
    ).toMatchObject({
      status: "EXPLOITABLE",
      justification: null,
      response: null,
      source: { format: "csaf", document_id: "ACME-CSAF-22" },
    });
  });

  it("resolves CSAF full_product_names and relationship product ids", async () => {
    const value = await fixture();
    const component = {
      purl: "pkg:generic/acme/csaf-tree@3.0.0",
      name: "csaf-tree",
      group: "acme",
      version: "3.0.0",
    };
    addFinding(value.db, { id: "tree-1", cve: "CVE-CSAF-FULL", ...component });
    addFinding(value.db, { id: "tree-2", cve: "CVE-CSAF-REL", ...component });
    const file = await document(value.root, "csaf-product-tree.json", {
      document: { category: "csaf_vex", tracking: { id: "ACME-CSAF-TREE" } },
      product_tree: {
        full_product_names: [
          {
            product_id: "COMPONENT-1",
            name: "csaf-tree",
            product_identification_helper: { purl: component.purl },
          },
        ],
        relationships: [
          {
            category: "default_component_of",
            product_reference: "COMPONENT-1",
            relates_to_product_reference: "PRODUCT-1",
            full_product_name: {
              product_id: "RELATIONSHIP-1",
              name: "csaf-tree within appliance",
            },
          },
        ],
      },
      vulnerabilities: [
        {
          cve: "CVE-CSAF-FULL",
          product_status: { known_affected: ["COMPONENT-1"] },
        },
        { cve: "CVE-CSAF-REL", product_status: { fixed: ["RELATIONSHIP-1"] } },
      ],
    });
    const result = await importVendorVexBytes(
      deps(value),
      file,
      await readFile(file),
      {
        vendor: "CSAF Supplier",
        overwrite: false,
        dryRun: false,
      },
    );
    expect(result).toMatchObject({
      matched: 2,
      unmatched: 0,
      written: 2,
      errors: [],
    });
    const overlays = await readOverlayFiles(value.root);
    expect(
      Object.values(overlays.files[0]?.overlay.proposals ?? {})
        .map((proposal) => proposal.status)
        .sort(),
    ).toEqual(["EXPLOITABLE", "RESOLVED"]);
  });

  it("reports unmapped CSAF justification labels and product-status buckets", async () => {
    const value = await fixture();
    const file = await document(value.root, "csaf-unmapped.json", {
      document: {
        category: "csaf_vex",
        tracking: { id: "ACME-CSAF-UNMAPPED" },
      },
      product_tree: {
        full_product_names: [
          {
            product_id: "UNMAPPED-1",
            name: "unmapped",
            product_identification_helper: {
              purl: "pkg:generic/acme/unmapped@1.0.0",
            },
          },
        ],
      },
      vulnerabilities: [
        {
          cve: "CVE-CSAF-UNMAPPED",
          product_status: {
            known_not_affected: ["UNMAPPED-1"],
            first_affected: ["UNMAPPED-1"],
          },
          flags: [
            {
              label: "vulnerable_code_cannot_be_controlled_by_adversary",
              product_ids: ["UNMAPPED-1"],
            },
          ],
        },
      ],
    });
    const result = await importVendorVexBytes(
      deps(value),
      file,
      await readFile(file),
      {
        vendor: "CSAF Supplier",
        overwrite: false,
        dryRun: false,
      },
    );
    expect(result).toMatchObject({
      matched: 0,
      unmatched: 0,
      needsCompletion: 0,
      written: 0,
    });
    expect(result.errors.map((error) => error.code).sort()).toEqual([
      "JUSTIFICATION_UNSUPPORTED",
      "STATUS_BUCKET_UNSUPPORTED",
    ]);
    expect((await readOverlayFiles(value.root)).files).toEqual([]);
  });

  it("degrades a mixed OpenVEX batch without discarding valid statements", async () => {
    const value = await fixture();
    const component = {
      purl: "pkg:generic/acme/partial@1.0.0",
      name: "partial",
      group: "acme",
      version: "1.0.0",
    };
    addFinding(value.db, {
      id: "partial-1",
      cve: "CVE-PARTIAL-GOOD",
      ...component,
    });
    const file = await document(value.root, "openvex-partial.json", {
      "@context": "https://openvex.dev/ns/v0.2.0",
      "@id": "https://vendor.example/vex/partial",
      statements: [
        {
          vulnerability: { name: "CVE-PARTIAL-GOOD" },
          products: [{ "@id": component.purl }],
          status: "affected",
          action_statement: "Apply the vendor update",
        },
        {
          vulnerability: { name: "CVE-PARTIAL-BAD" },
          products: [{ "@id": "pkg:generic/acme/bad@1.0.0" }],
          status: "not_affected",
          justification: "vulnerable_code_cannot_be_controlled_by_adversary",
        },
      ],
    });
    const result = await importVendorVexBytes(
      deps(value),
      file,
      await readFile(file),
      {
        vendor: "Open Supplier",
        overwrite: false,
        dryRun: false,
      },
    );
    expect(result).toMatchObject({ matched: 1, written: 1 });
    expect(result.errors).toEqual([
      expect.objectContaining({ code: "JUSTIFICATION_UNSUPPORTED" }),
    ]);
  });

  it("keeps a strict local decision by default and writes only a separate proposal on human overwrite", async () => {
    const value = await fixture();
    const component = {
      purl: "pkg:generic/acme/collision@1.0.0",
      name: "collision",
      group: "acme",
      version: "1.0.0",
    };
    addFinding(value.db, { id: "301", cve: "CVE-COLLISION", ...component });
    await setDecision(value.root, {
      project: PROJECT,
      component,
      cve: "CVE-COLLISION",
      stableKey: stableKeyFor(PROJECT, component, "CVE-COLLISION"),
      status: "IN_TRIAGE",
      justification: null,
      response: null,
      reason: "Human triage remains authoritative",
      provenance: { by: "engineer", at: AT, evidence: "ticket FS-44" },
    });
    await rebuildOverlayIndex(value.db, value.root);
    const file = await document(value.root, "collision.json", {
      "@context": "https://openvex.dev/ns/v0.2.0",
      "@id": "https://vendor.example/vex/collision",
      author: "Supplier",
      timestamp: AT,
      version: 1,
      statements: [
        {
          vulnerability: { name: "CVE-COLLISION" },
          products: [{ "@id": component.purl }],
          status: "affected",
          action_statement: "Patch when available",
        },
      ],
    });
    const kept = await importVendorVexBytes(
      deps(value),
      file,
      await readFile(file),
      {
        vendor: "Supplier",
        overwrite: false,
        dryRun: false,
      },
    );
    expect(kept).toMatchObject({ keptLocal: 1, written: 0 });
    const overwritten = await importVendorVexBytes(
      deps(value),
      file,
      await readFile(file),
      {
        vendor: "Supplier",
        overwrite: true,
        dryRun: false,
      },
    );
    expect(overwritten).toMatchObject({ keptLocal: 0, written: 1 });
    const working = await readVexWorking(value.root, {
      projectId: PROJECT,
      projectVersionId: PV,
    });
    expect(working).toHaveLength(1);
    expect(working[0]?.payload).toMatchObject({
      status: "IN_TRIAGE",
      reason: "Human triage remains authoritative",
    });
    expect(
      value.db
        .prepare(
          "SELECT COUNT(*) AS count FROM overlay_index WHERE entity_kind = 'vendorProposal'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it("rejects malformed, oversized, and unrecognized documents before writing", async () => {
    const value = await fixture();
    const malformed = await document(value.root, "malformed.json", "{");
    const unrecognized = await document(value.root, "unknown.json", {
      hello: "world",
    });
    const oversized = await document(
      value.root,
      "oversized.json",
      Buffer.alloc(MAX_VENDOR_VEX_BYTES + 1, 0x20),
    );
    for (const [file, code] of [
      [malformed, "VENDOR_JSON_INVALID"],
      [unrecognized, "VENDOR_FORMAT_UNRECOGNIZED"],
      [oversized, "VENDOR_FILE_OVERSIZED"],
    ] as const) {
      await expect(
        importVendorVexBytes(deps(value), file, await readFile(file), {
          vendor: "Supplier",
          overwrite: false,
          dryRun: false,
        }),
      ).rejects.toMatchObject({ code });
    }
    expect((await readOverlayFiles(value.root)).files).toEqual([]);
    expect(
      value.db.prepare("SELECT COUNT(*) AS count FROM overlay_index").get(),
    ).toEqual({ count: 0 });
    expect(VendorVexParseError).toBeDefined();
  });
});
