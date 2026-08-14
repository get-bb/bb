import type Database from "better-sqlite3";
import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const stagedDocumentSchema = z
  .object({
    kind: z.literal("vendor-vex-document"),
    file: z.string().min(1).max(1_024),
    documentSha256: sha256Schema,
    bytesBase64: z.string(),
    sizeBytes: z.number().int().positive(),
  })
  .strict();
const stagedImportSchema = z
  .object({
    kind: z.literal("vendor-vex-import"),
    importId: z.string().min(1).max(512),
    documentSha256: sha256Schema,
    vendor: z.string().min(1).max(500),
  })
  .strict();

interface StagingScope {
  projectId: string;
  pvId: string;
}

interface PersistedRunRow {
  report_json: string;
}

/**
 * Staging is a short-lived preview→apply buffer. Documents are base64-encoded
 * into triage_runs.report_json (up to ~6.7 MiB each). Seven days is far longer
 * than any interactive import session, but short enough to bound data.db growth
 * when users preview many supplier docs and never apply (FS-147 R3 MEDIUM-1 /
 * FS-212). Sweep is opportunistic on the next vendor-VEX operation — plugins
 * must not add idle wakeups (see JOURNEY-BEAT-BACKLOG.md performance beat).
 */
export const VENDOR_STAGING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function documentRunId(documentSha256: string): string {
  return `vendor-document-${documentSha256}`;
}

function persist(
  db: Database.Database,
  input: StagingScope & {
    runId: string;
    inputDigest: string;
    report: unknown;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO triage_runs
       (project_id, project_version_id, run_id, source, dry_run, status,
        input_digest, report_json, created_at, finished_at)
     VALUES (?, ?, ?, 'vendor_import', 1, 'completed', ?, ?, ?, ?)
     ON CONFLICT(project_id, project_version_id, run_id) DO UPDATE SET
       source = excluded.source,
       dry_run = excluded.dry_run,
       status = excluded.status,
       input_digest = excluded.input_digest,
       report_json = excluded.report_json,
       created_at = excluded.created_at,
       finished_at = excluded.finished_at`,
  ).run(
    input.projectId,
    input.pvId,
    input.runId,
    input.inputDigest,
    JSON.stringify(input.report),
    now,
    now,
  );
}

function read(
  db: Database.Database,
  input: StagingScope & { runId: string },
): unknown | null {
  const row = db
    .prepare<[string, string, string], PersistedRunRow>(
      `SELECT report_json
         FROM triage_runs
        WHERE project_id = ? AND project_version_id = ? AND run_id = ?
          AND source = 'vendor_import'
        LIMIT 1`,
    )
    .get(input.projectId, input.pvId, input.runId);
  return row ? JSON.parse(row.report_json) : null;
}

/** Deletes vendor_import staging rows older than {@link VENDOR_STAGING_TTL_MS}. */
export function pruneStaleVendorStaging(
  db: Database.Database,
  now: Date = new Date(),
): number {
  const cutoff = new Date(now.getTime() - VENDOR_STAGING_TTL_MS).toISOString();
  const result = db
    .prepare(
      `DELETE FROM triage_runs
        WHERE source = 'vendor_import'
          AND created_at < ?`,
    )
    .run(cutoff);
  return result.changes;
}

/** Drops the staged document blob after a successful apply (dead weight). */
export function deleteVendorDocumentStaging(
  db: Database.Database,
  input: StagingScope & { documentSha256: string },
): void {
  db.prepare(
    `DELETE FROM triage_runs
      WHERE project_id = ? AND project_version_id = ? AND run_id = ?
        AND source = 'vendor_import'`,
  ).run(input.projectId, input.pvId, documentRunId(input.documentSha256));
}

/** Drops the preview import handle after a successful apply. */
export function deleteVendorImportStaging(
  db: Database.Database,
  input: StagingScope & { importId: string },
): void {
  db.prepare(
    `DELETE FROM triage_runs
      WHERE project_id = ? AND project_version_id = ? AND run_id = ?
        AND source = 'vendor_import'`,
  ).run(input.projectId, input.pvId, input.importId);
}

export function persistVendorDocument(
  db: Database.Database,
  input: StagingScope & {
    file: string;
    bytes: Uint8Array;
    documentSha256: string;
  },
): void {
  persist(db, {
    ...input,
    runId: documentRunId(input.documentSha256),
    inputDigest: input.documentSha256,
    report: {
      kind: "vendor-vex-document",
      file: input.file,
      documentSha256: input.documentSha256,
      bytesBase64: Buffer.from(input.bytes).toString("base64"),
      sizeBytes: input.bytes.byteLength,
    },
  });
}

export function readVendorDocument(
  db: Database.Database,
  input: StagingScope & { documentSha256: string },
): { file: string; bytes: Uint8Array } | null {
  const raw = read(db, {
    ...input,
    runId: documentRunId(input.documentSha256),
  });
  if (raw === null) return null;
  const document = stagedDocumentSchema.parse(raw);
  if (document.documentSha256 !== input.documentSha256) {
    throw new Error("VENDOR_DOCUMENT_CHANGED");
  }
  const bytes = Buffer.from(document.bytesBase64, "base64");
  if (bytes.byteLength !== document.sizeBytes) {
    throw new Error("VENDOR_DOCUMENT_STAGING_CORRUPT");
  }
  return { file: document.file, bytes: Uint8Array.from(bytes) };
}

export function persistVendorImport(
  db: Database.Database,
  input: StagingScope & {
    importId: string;
    documentSha256: string;
    vendor: string;
  },
): void {
  persist(db, {
    ...input,
    runId: input.importId,
    inputDigest: input.documentSha256,
    report: {
      kind: "vendor-vex-import",
      importId: input.importId,
      documentSha256: input.documentSha256,
      vendor: input.vendor,
    },
  });
}

export function readVendorImport(
  db: Database.Database,
  input: StagingScope & { importId: string },
): { documentSha256: string; vendor: string } | null {
  const raw = read(db, { ...input, runId: input.importId });
  if (raw === null) return null;
  const staged = stagedImportSchema.parse(raw);
  if (staged.importId !== input.importId) {
    throw new Error("VENDOR_IMPORT_STAGING_CORRUPT");
  }
  return {
    documentSha256: staged.documentSha256,
    vendor: staged.vendor,
  };
}
