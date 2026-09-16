// oxlint-disable-next-line no-restricted-imports
import { renameSync } from "node:fs";
import { and, eq, isNull } from "drizzle-orm";
import {
  getProjectAttachment,
  recordProjectAttachment,
  projectAttachments,
  projectAttachmentBackfills,
  attachmentUnavailable,
  type DbConnection,
  type ProjectAttachmentRow,
} from "@bb/db";
import {
  canonicalProjectAttachmentPath,
  pathLooksRuntimeReadable,
} from "@bb/domain";
// oxlint-disable-next-line no-restricted-imports
import {
  mkdir,
  opendir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { resolveContainedPath } from "@bb/process-utils";
import type { PromptInput } from "@bb/domain";
import type { UploadedPromptAttachment } from "@bb/server-contract";
import mimeTypes from "mime-types";
import { ApiError } from "../../errors.js";

const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const FILE_LIMIT_BYTES = 25 * 1024 * 1024;

const HEIF_IMAGE_MIME_TYPES = new Set([
  "image/heic",
  "image/heic-sequence",
  "image/heif",
  "image/heif-sequence",
]);

type PromptAttachmentInput = Extract<
  PromptInput,
  { type: "localFile" | "localImage" }
>;

interface ValidatePromptAttachmentReferencesArgs {
  db: DbConnection;
  dataDir: string;
  input: PromptInput[];
  projectId: string;
}

function sanitizeFilename(name: string): string {
  const base = basename(name).replace(/[^a-zA-Z0-9._-]+/gu, "-");
  return base.length > 0 ? base : "attachment";
}

function buildStoredFilename(originalName: string): string {
  const sanitized = sanitizeFilename(originalName);
  const extension = extname(sanitized);
  const stem =
    extension.length > 0 ? sanitized.slice(0, -extension.length) : sanitized;
  return `${stem}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;
}

function projectAttachmentDir(dataDir: string, projectId: string): string {
  return join(dataDir, "attachments", projectId);
}

function resolveAttachmentPath(
  attachmentDir: string,
  relativePath: string,
): string {
  let normalizedRelativePath: string;
  try {
    normalizedRelativePath = canonicalProjectAttachmentPath(relativePath);
  } catch (error) {
    throw new ApiError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid attachment path",
    );
  }
  const resolvedAttachmentDir = resolve(attachmentDir);
  const resolvedCandidatePath = resolve(
    resolvedAttachmentDir,
    normalizedRelativePath,
  );

  if (resolvedCandidatePath === resolvedAttachmentDir) {
    throw new ApiError(
      400,
      "invalid_request",
      "Attachment path must refer to a file inside the project directory",
    );
  }

  const resolvedPath = resolveContainedPath({
    rootPath: resolvedAttachmentDir,
    candidatePath: resolvedCandidatePath,
  });

  if (resolvedPath) {
    return resolvedPath;
  }

  throw new ApiError(
    400,
    "invalid_request",
    "Attachment path escapes project directory",
  );
}

function shouldValidateProjectAttachmentReference(
  input: PromptInput,
): input is PromptAttachmentInput {
  if (input.type !== "localFile" && input.type !== "localImage") {
    return false;
  }
  return !pathLooksRuntimeReadable(input.path);
}

function missingAttachmentReferenceError(attachmentPath: string): ApiError {
  return new ApiError(
    400,
    "invalid_request",
    `Attachment ${attachmentPath} was not uploaded for this project. Upload files with POST /api/v1/projects/:id/attachments and use the returned path in localFile/localImage prompt input; relative workspace file paths are not valid attachment references.`,
  );
}

export async function ensureAttachmentReferenceExists(
  db: DbConnection,
  dataDir: string,
  projectId: string,
  attachmentPath: string,
): Promise<void> {
  const dir = projectAttachmentDir(dataDir, projectId);
  const resolved = resolveAttachmentPath(dir, attachmentPath);
  const storedPath = canonicalProjectAttachmentPath(attachmentPath);
  const existing = getProjectAttachment(db, projectId, storedPath);
  if (
    existing &&
    (existing.deletionClaimedAt !== null || existing.readyAt === null)
  )
    throw attachmentUnavailable(storedPath);
  if (!existing) {
    const backfill = db
      .select()
      .from(projectAttachmentBackfills)
      .where(eq(projectAttachmentBackfills.projectId, projectId))
      .get();
    if (backfill?.phase === "done")
      throw missingAttachmentReferenceError(storedPath);
  }
  const fileStat = await stat(resolved).catch(() => null);
  if (!fileStat || !fileStat.isFile())
    throw missingAttachmentReferenceError(attachmentPath);
  if (!existing) {
    recordProjectAttachment(db, {
      projectId,
      storedPath,
      originalName: basename(storedPath),
      mimeType: mimeTypes.lookup(storedPath) || null,
      sizeBytes: fileStat.size,
      createdAt: Math.floor(fileStat.mtimeMs),
      readyAt: Date.now(),
    });
  }
}

export async function inventoryAttachmentReference(
  db: DbConnection,
  dataDir: string,
  projectId: string,
  attachmentPath: string,
): Promise<void> {
  const storedPath = canonicalProjectAttachmentPath(attachmentPath);
  if (getProjectAttachment(db, projectId, storedPath)) return;
  const resolved = resolveAttachmentPath(
    projectAttachmentDir(dataDir, projectId),
    storedPath,
  );
  const fileStat = await stat(resolved).catch(() => null);
  if (!fileStat || !fileStat.isFile()) return;
  recordProjectAttachment(db, {
    projectId,
    storedPath,
    originalName: basename(storedPath),
    mimeType: mimeTypes.lookup(storedPath) || null,
    sizeBytes: fileStat.size,
    createdAt: Math.floor(fileStat.mtimeMs),
    readyAt: Date.now(),
  });
}

export async function inventoryPromptAttachmentReferences(
  args: ValidatePromptAttachmentReferencesArgs,
): Promise<void> {
  for (const input of args.input) {
    if (!shouldValidateProjectAttachmentReference(input)) continue;
    await inventoryAttachmentReference(
      args.db,
      args.dataDir,
      args.projectId,
      input.path,
    );
  }
}

export async function validatePromptAttachmentReferences(
  args: ValidatePromptAttachmentReferencesArgs,
): Promise<void> {
  for (const input of args.input) {
    if (!shouldValidateProjectAttachmentReference(input)) {
      continue;
    }
    await ensureAttachmentReferenceExists(
      args.db,
      args.dataDir,
      args.projectId,
      input.path,
    );
  }
}

function isHeifImageUpload(file: File): boolean {
  const mimeType = (file.type.split(";")[0] ?? "").trim().toLowerCase();
  return HEIF_IMAGE_MIME_TYPES.has(mimeType);
}

export async function storeAttachment(
  db: DbConnection,
  dataDir: string,
  projectId: string,
  file: File,
): Promise<UploadedPromptAttachment> {
  if (isHeifImageUpload(file)) {
    throw new ApiError(
      400,
      "invalid_request",
      "HEIC images are not supported. Convert the image to JPEG or PNG before attaching it.",
    );
  }
  const isImage = (file.type || "").startsWith("image/");
  const sizeLimit = isImage ? IMAGE_LIMIT_BYTES : FILE_LIMIT_BYTES;
  if (file.size > sizeLimit) {
    throw new ApiError(
      400,
      "invalid_request",
      `Attachment exceeds ${Math.floor(sizeLimit / (1024 * 1024))}MB limit`,
    );
  }

  const dir = projectAttachmentDir(dataDir, projectId);
  await mkdir(dir, { recursive: true });

  const storedName = buildStoredFilename(file.name);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeInventoriedAttachment(
    db,
    dataDir,
    projectId,
    storedName,
    bytes,
    file.name,
    file.type || null,
  );

  return {
    type: isImage ? "localImage" : "localFile",
    path: storedName,
    name: file.name,
    mimeType: file.type || undefined,
    sizeBytes: file.size,
  };
}

interface StoredAttachmentContent {
  content: Buffer;
  etag: string;
  mimeType?: string;
}

export async function readAttachment(
  dataDir: string,
  projectId: string,
  relativePath: string,
): Promise<StoredAttachmentContent> {
  const dir = projectAttachmentDir(dataDir, projectId);
  const resolved = resolveAttachmentPath(dir, relativePath);

  const fileStat = await stat(resolved).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    throw new ApiError(404, "invalid_request", "Attachment not found");
  }

  return {
    content: await readFile(resolved),
    etag: `"${fileStat.size.toString(16)}-${Math.floor(fileStat.mtimeMs).toString(16)}"`,
    mimeType: mimeTypes.lookup(resolved) || undefined,
  };
}

export async function copyProjectAttachments(
  db: DbConnection,
  dataDir: string,
  sourceProjectId: string,
  targetProjectId: string,
  attachmentPaths: readonly string[],
): Promise<void> {
  if (sourceProjectId === targetProjectId || attachmentPaths.length === 0) {
    return;
  }

  const uniquePaths = [
    ...new Set(attachmentPaths.map(canonicalProjectAttachmentPath)),
  ];
  const attachments = [];
  for (const path of uniquePaths) {
    const { content } = await readAttachment(dataDir, sourceProjectId, path);
    attachments.push({ path, content });
  }
  for (const { path, content } of attachments) {
    await writeInventoriedAttachment(
      db,
      dataDir,
      targetProjectId,
      path,
      content,
      basename(path),
      mimeTypes.lookup(path) || null,
    );
  }
}

export async function deleteProjectAttachments(
  dataDir: string,
  projectId: string,
): Promise<void> {
  await rm(projectAttachmentDir(dataDir, projectId), {
    force: true,
    recursive: true,
  });
}

export function pendingAttachmentPath(
  dataDir: string,
  projectId: string,
  id: string,
): string {
  return join(projectAttachmentDir(dataDir, projectId), ".pending", id);
}

async function writeInventoriedAttachment(
  db: DbConnection,
  dataDir: string,
  projectId: string,
  storedPath: string,
  content: Buffer,
  originalName: string,
  mimeType: string | null,
): Promise<void> {
  const existing = getProjectAttachment(db, projectId, storedPath);
  if (existing) {
    await ensureAttachmentReferenceExists(db, dataDir, projectId, storedPath);
    return;
  }
  const now = Date.now();
  const row = recordProjectAttachment(db, {
    projectId,
    storedPath,
    originalName,
    mimeType,
    sizeBytes: content.length,
    createdAt: now,
    readyAt: null,
  });
  const pendingPath = pendingAttachmentPath(dataDir, projectId, row.id);
  const outputPath = resolveAttachmentPath(
    projectAttachmentDir(dataDir, projectId),
    storedPath,
  );
  try {
    await mkdir(dirname(pendingPath), { recursive: true });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(pendingPath, content, { flag: "wx" });
    db.transaction(
      (tx) => {
        const current = getProjectAttachment(tx, projectId, storedPath);
        if (
          !current ||
          current.id !== row.id ||
          current.deletionClaimedAt !== null ||
          current.readyAt !== null
        )
          throw attachmentUnavailable(storedPath);
        renameSync(pendingPath, outputPath);
        tx.update(projectAttachments)
          .set({ readyAt: Date.now() })
          .where(eq(projectAttachments.id, row.id))
          .run();
      },
      { behavior: "immediate" },
    );
  } catch (error) {
    await rm(pendingPath, { force: true });
    db.update(projectAttachments)
      .set({ deletionClaimedAt: Date.now() })
      .where(
        and(
          eq(projectAttachments.id, row.id),
          isNull(projectAttachments.readyAt),
        ),
      )
      .run();
    throw error;
  }
}

async function* walkFiles(root: string, prefix = ""): AsyncGenerator<string> {
  const dir = await opendir(join(root, prefix)).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  });
  if (!dir) return;
  for await (const entry of dir) {
    if (prefix === "" && entry.name === ".pending") continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walkFiles(root, path);
    else if (entry.isFile()) yield path;
    else throw new Error(`Attachment inventory cannot inspect ${path}`);
  }
}

export function walkProjectAttachmentFiles(
  dataDir: string,
  projectId: string,
): AsyncGenerator<string> {
  return walkFiles(projectAttachmentDir(dataDir, projectId));
}

export async function deleteInventoriedAttachmentFiles(
  dataDir: string,
  attachment: ProjectAttachmentRow,
): Promise<void> {
  await rm(
    resolveAttachmentPath(
      projectAttachmentDir(dataDir, attachment.projectId),
      attachment.storedPath,
    ),
    { force: true },
  );
  await rm(
    pendingAttachmentPath(dataDir, attachment.projectId, attachment.id),
    { force: true },
  );
}
