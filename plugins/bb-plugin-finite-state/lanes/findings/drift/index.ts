import type { PluginContext } from "../../../lib/context.js";
import {
  registerCachePuller,
  registeredCachePullers,
} from "../../sync/engine/adapter.js";
import { classifyDrift, readDriftReport } from "./classify.js";
import { orphanBaseState, pruneOrphans } from "./orphans.js";
import { importVendorVexBytes, vendorImportId } from "./vendor/import.js";
import { parseVendorVexBytes } from "./vendor/parse.js";
import {
  persistVendorDocument,
  persistVendorImport,
  readVendorDocument,
  readVendorImport,
} from "./vendor/staging.js";
import { FINDINGS_DRIFT_CHANGED_CHANNEL, type DriftReport } from "./report.js";
import type { VendorImportResult } from "./vendor/import.js";

export * from "./classify.js";
export * from "./orphans.js";
export * from "./report.js";
export * from "./vendor/import.js";
export * from "./vendor/map.js";
export * from "./vendor/parse.js";

export interface FindingsDriftService {
  refresh(input: {
    root: string;
    projectId: string;
    pvId: string;
    limit?: number;
  }): DriftReport;
  report(input: {
    projectId: string;
    pvId: string;
    cursor?: string | null;
    limit?: number;
  }): DriftReport;
  orphanState(input: { projectId: string; pvId: string }): {
    baseStateSha256: string;
    total: number;
  };
  stageVendorDocument(input: {
    projectId: string;
    pvId: string;
    file: string;
    bytes: Uint8Array;
  }): {
    documentSha256: string;
  };
  previewVendorVex(input: {
    root: string;
    projectId: string;
    pvId: string;
    documentSha256: string;
    vendor: string;
  }): Promise<VendorImportResult & { importId: string }>;
  applyVendorVex(input: {
    root: string;
    projectId: string;
    pvId: string;
    importId: string;
    expectedDocumentSha256: string;
    overwrite: boolean;
  }): Promise<VendorImportResult & { importId: string }>;
  pruneOrphans(input: {
    root: string;
    projectId: string;
    pvId: string;
    stableKeys: string[];
    expectedBaseStateSha256: string;
  }): Promise<{
    baseStateSha256: string;
    selected: number;
    pruned: number;
    files: string[];
    results: Array<{
      stableKey: string;
      success: boolean;
      error: {
        code: string;
        message: string;
        artifactId: string | null;
        line: number | null;
      } | null;
    }>;
  }>;
}

/** Installs local drift/import services and one post-publication refetch hint. */
export function registerFindingsDrift(ctx: PluginContext): void {
  const db = ctx.db();
  const findingPuller = registeredCachePullers().find(
    (candidate) => candidate.kind === "finding",
  );
  if (findingPuller === undefined)
    throw new Error(
      "Findings drift requires the registered findings cache puller",
    );
  registerCachePuller("finding", async (scope, generationId, onProgress) => {
    const report = await findingPuller.pull(scope, generationId, onProgress);
    ctx.bb.realtime.publish(FINDINGS_DRIFT_CHANGED_CHANNEL, {
      pvId: scope.projectVersionId,
    });
    return report;
  });
  ctx.service<FindingsDriftService>("findings.drift", () => ({
    refresh(input) {
      const report = classifyDrift(
        {
          db,
          root: input.root,
          projectId: input.projectId,
          limit: input.limit,
        },
        input.pvId,
      );
      ctx.bb.realtime.publish(FINDINGS_DRIFT_CHANGED_CHANNEL, {
        pvId: input.pvId,
      });
      return report;
    },
    report: (input) =>
      readDriftReport(
        {
          db,
          projectId: input.projectId,
          cursor: input.cursor,
          limit: input.limit,
        },
        input.pvId,
      ),
    orphanState(input) {
      const state = orphanBaseState(db, input.projectId, input.pvId);
      return { baseStateSha256: state.sha256, total: state.rows.length };
    },
    stageVendorDocument(input) {
      const parsed = parseVendorVexBytes(input.file, input.bytes);
      persistVendorDocument(db, {
        projectId: input.projectId,
        pvId: input.pvId,
        file: input.file,
        bytes: input.bytes,
        documentSha256: parsed.digest,
      });
      return { documentSha256: parsed.digest };
    },
    async previewVendorVex(input) {
      const document = readVendorDocument(db, input);
      if (!document) throw new Error("VENDOR_DOCUMENT_NOT_STAGED");
      const result = await importVendorVexBytes(
        { db, root: input.root, projectId: input.projectId, pvId: input.pvId },
        document.file,
        document.bytes,
        { vendor: input.vendor, overwrite: false, dryRun: true },
      );
      const id = vendorImportId(result.source.digest, input.vendor);
      persistVendorImport(db, {
        importId: id,
        documentSha256: result.source.digest,
        vendor: input.vendor,
        projectId: input.projectId,
        pvId: input.pvId,
      });
      return { ...result, importId: id };
    },
    async applyVendorVex(input) {
      const staged = readVendorImport(db, input);
      if (!staged) throw new Error("VENDOR_IMPORT_NOT_PREVIEWED");
      if (staged.documentSha256 !== input.expectedDocumentSha256) {
        throw new Error("VENDOR_DOCUMENT_CHANGED");
      }
      const document = readVendorDocument(db, {
        projectId: input.projectId,
        pvId: input.pvId,
        documentSha256: staged.documentSha256,
      });
      if (!document) throw new Error("VENDOR_DOCUMENT_NOT_STAGED");
      const result = await importVendorVexBytes(
        { db, root: input.root, projectId: input.projectId, pvId: input.pvId },
        document.file,
        document.bytes,
        {
          vendor: staged.vendor,
          overwrite: input.overwrite,
          dryRun: false,
        },
      );
      if (result.written > 0) {
        classifyDrift(
          { db, root: input.root, projectId: input.projectId },
          input.pvId,
        );
        ctx.bb.realtime.publish(FINDINGS_DRIFT_CHANGED_CHANNEL, {
          pvId: input.pvId,
        });
      }
      return { ...result, importId: input.importId };
    },
    async pruneOrphans(input) {
      const result = await pruneOrphans(
        { db, root: input.root, projectId: input.projectId, pvId: input.pvId },
        input,
      );
      if (result.pruned > 0) {
        ctx.bb.realtime.publish(FINDINGS_DRIFT_CHANGED_CHANNEL, {
          pvId: input.pvId,
        });
      }
      return result;
    },
  }));
}
