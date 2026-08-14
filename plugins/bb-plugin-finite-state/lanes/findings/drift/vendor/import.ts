import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

import { identityFromStableKey } from "../../bulk/readback.js";
import { rebuildOverlayIndex } from "../../overlay/indexer.js";
import { readOverlayFiles } from "../../overlay/reader.js";
import {
  stableKeyFor,
  type VendorProposalInput,
  type VendorProposalV1,
} from "../../overlay/schema.js";
import { setVendorProposal } from "../../overlay/writer.js";
import {
  resolveFinding,
  type FindingResolution,
  type Pin,
} from "../../stable-key/index.js";
import { mapVendorVex, type NormalizedVendorStatement } from "./map.js";
import {
  parseVendorVexBytes,
  type ParsedVendorVex,
  type VendorVexBytes,
  type VendorVexFormat,
} from "./parse.js";

export interface VendorImportResult {
  source: { format: VendorVexFormat; digest: string; vendor: string };
  matched: number;
  unmatched: number;
  needsCompletion: number;
  keptLocal: number;
  written: number;
  proposals: { stableKey?: string; state: string; sourceRef: string }[];
  errors: { sourceRef?: string; code: string; message: string }[];
}

export interface ImportDeps {
  db: Database.Database;
  root: string;
  projectId: string;
  pvId: string;
}

export interface VendorImportOptions {
  vendor: string;
  overwrite: boolean;
  dryRun: boolean;
}

interface ExistingDecisionRow {
  stable_key: string;
  pin: string | null;
}

interface PreparedProposal {
  input: VendorProposalInput;
  stableKey: string;
  sourceRef: string;
  matched: boolean;
  needsCompletion: boolean;
  keptLocal: boolean;
}

function proposalId(digest: string, vendor: string, sourceRef: string): string {
  return `vendor-${createHash("sha256").update(`${digest}\0${vendor}\0${sourceRef}`).digest("hex")}`;
}

export function vendorImportId(digest: string, vendor: string): string {
  return `vendor-${digest.slice(0, 24)}-${createHash("sha256").update(vendor).digest("hex").slice(0, 12)}`;
}

function resolutionFor(
  deps: ImportDeps,
  statement: NormalizedVendorStatement,
): FindingResolution {
  return resolveFinding(
    deps.db,
    {
      schema: "fs-finding-key/v1",
      project: deps.projectId,
      cve: statement.cve,
      ...statement.component,
    },
    deps.pvId,
    "any_version",
  );
}

function findingIds(resolution: FindingResolution): Set<string> {
  return new Set(
    resolution.state === "resolved"
      ? resolution.rows.map((row) => row.findingId)
      : [],
  );
}

function localDecisionExists(
  deps: ImportDeps,
  statement: NormalizedVendorStatement,
  resolution: FindingResolution,
  authoredComponents: ReadonlyMap<string, VendorProposalInput["component"]>,
): boolean {
  const targetIds = findingIds(resolution);
  const sourceStableKey = stableKeyFor(
    deps.projectId,
    statement.component,
    statement.cve,
  );
  const rows = deps.db
    .prepare(
      `SELECT stable_key, pin
       FROM overlay_index
      WHERE project_id = ? AND project_version_id = ?
        AND entity_kind = 'vexDecision' AND cve = ?
      ORDER BY stable_key ASC`,
    )
    .all(deps.projectId, deps.pvId, statement.cve) as ExistingDecisionRow[];
  return rows.some((row) => {
    if (row.stable_key === sourceStableKey) return true;
    if (targetIds.size === 0) return false;
    const decoded = identityFromStableKey(deps.projectId, row.stable_key);
    const component = authoredComponents.get(row.stable_key) ?? {
      purl: decoded.identity.purl ?? null,
      name: decoded.identity.name,
      group: decoded.identity.group ?? null,
      version: decoded.identity.version ?? null,
    };
    const pin: Pin =
      row.pin === "any_version" ? "any_version" : "exact_version";
    const localResolution = resolveFinding(
      deps.db,
      {
        schema: "fs-finding-key/v1",
        project: decoded.project,
        cve: decoded.identity.cve,
        ...component,
      },
      deps.pvId,
      pin,
    );
    return (
      localResolution.state === "resolved" &&
      localResolution.rows.some((finding) => targetIds.has(finding.findingId))
    );
  });
}

function prepare(
  deps: ImportDeps,
  parsed: ParsedVendorVex,
  statement: NormalizedVendorStatement,
  options: VendorImportOptions,
  authoredComponents: ReadonlyMap<string, VendorProposalInput["component"]>,
): PreparedProposal {
  const resolution = resolutionFor(deps, statement);
  const matched = resolution.state === "resolved";
  const targetStableKey = matched
    ? (resolution.rows[0]?.stableKey ?? null)
    : null;
  const needsCompletion =
    statement.status === "NOT_AFFECTED" && statement.justification === null;
  const keptLocal =
    localDecisionExists(deps, statement, resolution, authoredComponents) &&
    !options.overwrite;
  const id = proposalId(parsed.digest, options.vendor, statement.sourceRef);
  const proposal: VendorProposalV1 = {
    cve: statement.cve,
    status: statement.status,
    justification: statement.justification,
    response: statement.response,
    reason: statement.reason,
    state: needsCompletion ? "needs_completion" : "proposal",
    match: matched ? "matched" : "none",
    target_stable_key: targetStableKey,
    provenance: {
      by: `vendor:${options.vendor}`,
      at: null,
      evidence: statement.sourceRef,
      import_id: vendorImportId(parsed.digest, options.vendor),
    },
    source: {
      format: parsed.format,
      document_id: parsed.documentId,
      document_sha256: parsed.digest,
      statement: statement.sourceRef.slice(
        statement.sourceRef.indexOf("#") + 1,
      ),
    },
  };
  return {
    input: {
      project: deps.projectId,
      component: statement.component,
      proposalId: id,
      proposal,
    },
    stableKey:
      targetStableKey ??
      stableKeyFor(deps.projectId, statement.component, statement.cve),
    sourceRef: statement.sourceRef,
    matched,
    needsCompletion,
    keptLocal,
  };
}

async function importParsedVendorVex(
  deps: ImportDeps,
  parsed: ParsedVendorVex,
  options: VendorImportOptions,
): Promise<VendorImportResult> {
  if (options.vendor.trim().length === 0 || options.vendor.length > 500) {
    throw new TypeError(
      "Vendor name must contain between 1 and 500 characters",
    );
  }
  const mapped = mapVendorVex(parsed);
  const overlays = await readOverlayFiles(deps.root);
  if (overlays.errors.length > 0) {
    throw new Error(
      `Vendor import cannot safely inspect local decisions: ${overlays.errors[0]?.message ?? "overlay parse failed"}`,
    );
  }
  const authoredComponents = new Map<
    string,
    VendorProposalInput["component"]
  >();
  for (const overlay of overlays.files) {
    if (overlay.overlay.project !== deps.projectId) continue;
    for (const cve of Object.keys(overlay.overlay.decisions)) {
      authoredComponents.set(
        stableKeyFor(deps.projectId, overlay.overlay.component, cve),
        overlay.overlay.component,
      );
    }
  }
  const prepared: PreparedProposal[] = [];
  const errors = [...mapped.errors];
  for (const statement of mapped.statements) {
    try {
      prepared.push(
        prepare(deps, parsed, statement, options, authoredComponents),
      );
    } catch (error) {
      errors.push({
        sourceRef: statement.sourceRef,
        code: "MAPPING_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let written = 0;
  const proposals: VendorImportResult["proposals"] = [];
  for (const item of prepared) {
    if (item.keptLocal) {
      proposals.push({
        stableKey: item.stableKey,
        state: "kept_local",
        sourceRef: item.sourceRef,
      });
      continue;
    }
    if (options.dryRun) {
      proposals.push({
        stableKey: item.stableKey,
        state: item.input.proposal.state,
        sourceRef: item.sourceRef,
      });
      continue;
    }
    try {
      const result = await setVendorProposal(deps.root, item.input);
      if (result.changedFields.length > 0) written += 1;
      proposals.push({
        stableKey: item.stableKey,
        state: item.input.proposal.state,
        sourceRef: item.sourceRef,
      });
    } catch (error) {
      errors.push({
        sourceRef: item.sourceRef,
        code:
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : "PROPOSAL_WRITE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (!options.dryRun && written > 0)
    await rebuildOverlayIndex(deps.db, deps.root);

  return {
    source: {
      format: parsed.format,
      digest: parsed.digest,
      vendor: options.vendor,
    },
    matched: prepared.filter((item) => item.matched).length,
    unmatched: prepared.filter((item) => !item.matched).length,
    needsCompletion: prepared.filter((item) => item.needsCompletion).length,
    keptLocal: prepared.filter((item) => item.keptLocal).length,
    written,
    proposals,
    errors,
  };
}

/** Imports bytes already read through a host-confined bb file boundary. */
export async function importVendorVexBytes(
  deps: ImportDeps,
  file: string,
  bytes: VendorVexBytes,
  options: VendorImportOptions,
): Promise<VendorImportResult> {
  return importParsedVendorVex(deps, parseVendorVexBytes(file, bytes), options);
}
