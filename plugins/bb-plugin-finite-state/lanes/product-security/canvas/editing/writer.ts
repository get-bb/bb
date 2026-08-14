import { randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { BbPluginApi } from "@bb/plugin-sdk";
import { ENTITIES } from "../../../../lib/sync/registry.js";
import { canonicalJson } from "../../../sync/serialize/canonical.js";
import { createSerializer } from "../../../sync/serialize/serializer.js";
import {
  architectureEntityPayload,
  entityReferences,
  parseArchitectureEntity,
  type ArchitectureKind,
  type ArchitectureYamlEntity,
  type CanvasEntityKind,
  type DeletionImpact,
  type RetiredAuthoredComponentYamlEntity,
} from "./schema.js";
import {
  CanvasEntityValidationError,
  RetiredComponentTypeValidationAdvisory,
  UnsupportedComponentTypeValidationAdvisory,
  validateArchitecturePayload,
  validateEntityReferences,
} from "./validators.js";

export interface StoredCanvasEntity {
  entity: ArchitectureYamlEntity;
  file: string;
  content: string;
  sha256: string;
}

export class RetiredComponentTypeReadAdvisory extends Error {
  readonly code = "RETIRED_COMPONENT_TYPE" as const;
  readonly field = "component_type" as const;

  constructor(
    readonly entity: RetiredAuthoredComponentYamlEntity,
    readonly file: string,
    readonly sha256: string,
    message: string,
  ) {
    super(message);
    this.name = "RetiredComponentTypeReadAdvisory";
  }
}

export interface CanvasFileDiagnostic {
  code:
    | "UNSUPPORTED_COMPONENT_TYPE"
    | "RETIRED_COMPONENT_TYPE"
    | "INVALID_AUTHORED_YAML";
  file: string;
  slug: string;
  value: string | null;
  message: string;
}

export interface CanvasFileListing {
  entities: StoredCanvasEntity[];
  diagnostics: CanvasFileDiagnostic[];
}

function canvasFileDiagnosticCode(
  error: unknown,
): CanvasFileDiagnostic["code"] {
  if (error instanceof UnsupportedComponentTypeValidationAdvisory) {
    return "UNSUPPORTED_COMPONENT_TYPE";
  }
  if (error instanceof RetiredComponentTypeReadAdvisory) {
    return "RETIRED_COMPONENT_TYPE";
  }
  return "INVALID_AUTHORED_YAML";
}

export type CanvasWriteOutcome =
  | { outcome: "written"; sha256: string }
  | { outcome: "conflict"; currentSha256: string | null };

export type CanvasRemoveOutcome =
  | { outcome: "removed" }
  | {
      outcome: "conflict";
      currentSha256: string | null;
      preservedFile: string | null;
    };

export interface CanvasFileStore {
  read(file: string): Promise<StoredCanvasEntity | null>;
  list(kind: CanvasEntityKind): Promise<StoredCanvasEntity[]>;
  listWithDiagnostics?(kind: CanvasEntityKind): Promise<CanvasFileListing>;
  write(
    file: string,
    content: string,
    expectedSha256: string | null,
  ): Promise<CanvasWriteOutcome>;
  remove(file: string, expectedSha256: string): Promise<CanvasRemoveOutcome>;
}

export interface CanvasProjectSource {
  hostId: string;
  path: string;
}

export interface CanvasFileStoreOptions {
  reclaimTombstones?: boolean;
}

export function canvasUsedSlugMarkerKey(
  projectId: string,
  projectVersionId: string | null,
  kind: CanvasEntityKind,
  slug: string,
): string {
  return `canvas-editing:used-slug:${encodeURIComponent(projectId)}:${encodeURIComponent(projectVersionId ?? "__project__")}:${kind}:${encodeURIComponent(slug)}`;
}

export function canvasDeletedMarkerPrefix(
  projectId: string,
  projectVersionId: string | null,
  kind: CanvasEntityKind,
): string {
  return `canvas-editing:deleted:${encodeURIComponent(projectId)}:${encodeURIComponent(projectVersionId ?? "__project__")}:${kind}:`;
}

export function canvasDeletedMarkerKey(
  projectId: string,
  projectVersionId: string | null,
  kind: CanvasEntityKind,
  slug: string,
): string {
  return `${canvasDeletedMarkerPrefix(projectId, projectVersionId, kind)}${encodeURIComponent(slug)}`;
}

const TOMBSTONE_MARKER = ".fs-cas-remove.";
const STALE_TOMBSTONE_MS = 30_000;

function decodeText(
  content: string,
  contentEncoding: "utf8" | "base64",
): string {
  return contentEncoding === "utf8"
    ? content
    : Buffer.from(content, "base64").toString("utf8");
}

function isMissingFile(error: unknown): boolean {
  return /\bENOENT\b|not found|does not exist/iu.test(
    error instanceof Error ? error.message : String(error),
  );
}

function isPathExists(error: unknown): boolean {
  return /\bEEXIST\b|path_exists|already exists/iu.test(
    error instanceof Error ? error.message : String(error),
  );
}

function absolutePath(
  source: CanvasProjectSource,
  relativePath: string,
): string {
  return join(source.path, relativePath);
}

function tombstoneName(file: string, now: number, token: string): string {
  return `${basename(file)}${TOMBSTONE_MARKER}${now}.${token}`;
}

function tombstoneTimestamp(name: string, targetName: string): number | null {
  const prefix = `${targetName}${TOMBSTONE_MARKER}`;
  if (!name.startsWith(prefix)) return null;
  const timestamp = Number(name.slice(prefix.length).split(".")[0]);
  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null;
}

function tombstoneTargetName(name: string): string | null {
  const marker = name.lastIndexOf(TOMBSTONE_MARKER);
  if (marker <= 0) return null;
  const target = name.slice(0, marker);
  return tombstoneTimestamp(name, target) === null ? null : target;
}

async function readOptionalSdkFile(
  bb: BbPluginApi,
  source: CanvasProjectSource,
  relativePath: string,
): Promise<{ content: string; sha256: string } | null> {
  try {
    const read = await bb.sdk.files.read({
      hostId: source.hostId,
      path: absolutePath(source, relativePath),
      rootPath: source.path,
    });
    return {
      content: decodeText(read.content, read.contentEncoding),
      sha256: read.sha256,
    };
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

async function readCanvasTargetFile(
  bb: BbPluginApi,
  source: CanvasProjectSource,
  file: string,
): Promise<{ content: string; sha256: string } | null> {
  const current = await readOptionalSdkFile(bb, source, file);
  if (current) return current;
  const directory = dirname(file);
  let listing;
  try {
    listing = await bb.sdk.files.list({
      hostId: source.hostId,
      path: absolutePath(source, directory),
      limit: 10_000,
    });
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
  if (listing.truncated) {
    throw new Error(
      `Canvas directory ${directory} exceeds the 10,000-file safety bound.`,
    );
  }
  const candidates = listing.files
    .map((entry) => ({
      file: `${directory}/${entry.name}`,
      timestamp: tombstoneTimestamp(entry.name, basename(file)),
    }))
    .filter(
      (candidate): candidate is { file: string; timestamp: number } =>
        candidate.timestamp !== null,
    )
    .sort(
      (left, right) =>
        right.timestamp - left.timestamp || left.file.localeCompare(right.file),
    );
  if (candidates.length > 1) {
    throw new Error(
      `LOCAL_WRITE_CONFLICT: ${file} has multiple preserved delete artifacts; reload and compare ${candidates.map((candidate) => candidate.file).join(", ")}.`,
    );
  }
  const candidate = candidates[0];
  return candidate ? readOptionalSdkFile(bb, source, candidate.file) : null;
}

async function removeIfPresent(
  bb: BbPluginApi,
  source: CanvasProjectSource,
  relativePath: string,
): Promise<void> {
  try {
    await bb.sdk.files.remove({
      hostId: source.hostId,
      path: absolutePath(source, relativePath),
      rootPath: source.path,
      recursive: false,
    });
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

async function move(
  bb: BbPluginApi,
  source: CanvasProjectSource,
  from: string,
  to: string,
): Promise<void> {
  await bb.sdk.files.move({
    hostId: source.hostId,
    sourcePath: absolutePath(source, from),
    destinationPath: absolutePath(source, to),
    rootPath: source.path,
  });
}

/**
 * Reclaims crash-stale delete tombstones without choosing between divergent
 * bytes. A missing target is restored atomically; a matching duplicate is
 * removed; divergent artifacts are retained for explicit compare/reload.
 */
export async function reclaimCanvasDeleteTombstones(
  bb: BbPluginApi,
  source: CanvasProjectSource,
  file: string,
  now = Date.now(),
): Promise<void> {
  const directory = dirname(file);
  let listing;
  try {
    listing = await bb.sdk.files.list({
      hostId: source.hostId,
      path: absolutePath(source, directory),
      limit: 10_000,
    });
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
  if (listing.truncated) {
    throw new Error(
      `Canvas directory ${directory} exceeds the 10,000-file safety bound.`,
    );
  }
  const candidates = listing.files
    .map((entry) => {
      const timestamp = tombstoneTimestamp(entry.name, basename(file));
      if (timestamp === null || now - timestamp < STALE_TOMBSTONE_MS)
        return null;
      return {
        timestamp,
        file: `${directory}/${entry.name}`,
      };
    })
    .filter(
      (candidate): candidate is { timestamp: number; file: string } =>
        candidate !== null,
    )
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp || left.file.localeCompare(right.file),
    );

  for (const candidate of candidates) {
    const tombstone = await readOptionalSdkFile(bb, source, candidate.file);
    if (!tombstone) continue;
    const current = await readOptionalSdkFile(bb, source, file);
    if (!current) {
      try {
        await move(bb, source, candidate.file, file);
      } catch (error) {
        if (!isPathExists(error) && !isMissingFile(error)) throw error;
      }
      continue;
    }
    if (current.sha256 === tombstone.sha256) {
      await removeIfPresent(bb, source, candidate.file);
    }
  }
}

/**
 * Best-effort CAS deletion over the shipped move/read/remove primitives. The
 * daemon's no-replace move is not an atomic rename fence: a recreation race
 * therefore keeps both paths and returns an explicit conflict for compare.
 */
export async function casRemoveCanvasFile(
  bb: BbPluginApi,
  source: CanvasProjectSource,
  file: string,
  expectedSha256: string,
  options: { now?: number; token?: string } = {},
): Promise<CanvasRemoveOutcome> {
  const now = options.now ?? Date.now();
  await reclaimCanvasDeleteTombstones(bb, source, file, now);
  const token = options.token ?? randomBytes(8).toString("hex");
  const tombstone = `${dirname(file)}/${tombstoneName(file, now, token)}`;
  try {
    await move(bb, source, file, tombstone);
  } catch (error) {
    if (isMissingFile(error)) {
      return { outcome: "conflict", currentSha256: null, preservedFile: null };
    }
    throw error;
  }

  const moved = await readOptionalSdkFile(bb, source, tombstone);
  if (!moved) {
    throw new Error("Canvas CAS delete lost its rename-aside tombstone.");
  }
  if (moved.sha256 !== expectedSha256) {
    try {
      await move(bb, source, tombstone, file);
      return {
        outcome: "conflict",
        currentSha256: moved.sha256,
        preservedFile: null,
      };
    } catch (error) {
      if (!isPathExists(error)) throw error;
      return {
        outcome: "conflict",
        currentSha256: moved.sha256,
        preservedFile: tombstone,
      };
    }
  }

  const recreated = await readOptionalSdkFile(bb, source, file);
  if (recreated) {
    return {
      outcome: "conflict",
      currentSha256: recreated.sha256,
      preservedFile: tombstone,
    };
  }
  await removeIfPresent(bb, source, tombstone);
  return { outcome: "removed" };
}

export function canvasEntityFile(kind: CanvasEntityKind, slug: string): string {
  const entry = ENTITIES[kind];
  return `${entry.dir}/${slug}.yaml`;
}

export function serializeCanvasEntity(entity: ArchitectureYamlEntity): string {
  return createSerializer(entity.kind).toYaml(
    architectureEntityPayload(entity),
    {
      idToSlug() {
        return null;
      },
      onWarning(warning) {
        throw new Error(
          `Unresolved server identifier ${warning.remoteId} at ${warning.path} cannot be authored.`,
        );
      },
    },
  );
}

export function parseCanvasEntity(
  kind: CanvasEntityKind,
  content: string,
  file: string,
): ArchitectureYamlEntity {
  const payload = createSerializer(kind).fromYaml(content, file);
  return validateArchitecturePayload(kind, payload);
}

export function createSdkCanvasFileStore(
  bb: BbPluginApi,
  source: CanvasProjectSource,
  options: CanvasFileStoreOptions = {},
): CanvasFileStore {
  const shouldReclaim = options.reclaimTombstones ?? true;
  async function read(
    file: string,
    reclaim = shouldReclaim,
  ): Promise<StoredCanvasEntity | null> {
    if (reclaim) await reclaimCanvasDeleteTombstones(bb, source, file);
    const stored = await readCanvasTargetFile(bb, source, file);
    if (!stored) return null;
    const kind = CANVAS_KIND_BY_DIRECTORY.find((candidate) =>
      file.startsWith(`${ENTITIES[candidate].dir}/`),
    );
    if (!kind) throw new Error(`${file} is not an owned canvas entity path.`);
    let entity: ArchitectureYamlEntity;
    try {
      entity = parseCanvasEntity(kind, stored.content, file);
    } catch (error) {
      if (error instanceof RetiredComponentTypeValidationAdvisory) {
        if (canvasEntityFile("component", error.entity.slug) !== file) {
          throw new Error(
            `${file} declares slug ${error.entity.slug}; expected ${canvasEntityFile("component", error.entity.slug)}.`,
          );
        }
        throw new RetiredComponentTypeReadAdvisory(
          error.entity,
          file,
          stored.sha256,
          error.message,
        );
      }
      throw error;
    }
    if (canvasEntityFile(kind, entity.slug) !== file) {
      throw new Error(
        `${file} declares slug ${entity.slug}; expected ${canvasEntityFile(kind, entity.slug)}.`,
      );
    }
    return { entity, file, content: stored.content, sha256: stored.sha256 };
  }

  async function listWithDiagnostics(
    kind: CanvasEntityKind,
  ): Promise<CanvasFileListing> {
    const directory = ENTITIES[kind].dir;
    let listing;
    try {
      listing = await bb.sdk.files.list({
        hostId: source.hostId,
        path: absolutePath(source, directory),
        limit: 10_000,
      });
    } catch (error) {
      if (isMissingFile(error)) return { entities: [], diagnostics: [] };
      throw error;
    }
    if (listing.truncated) {
      throw new Error(`${directory} exceeds the 10,000-file safety bound.`);
    }
    const regular = new Set(
      listing.files
        .filter((entry) => /\.ya?ml$/iu.test(entry.name))
        .map((entry) =>
          isAbsolute(entry.path)
            ? entry.name
            : (entry.path.replaceAll("\\", "/").split("/").at(-1) ??
              entry.name),
        ),
    );
    const tombstoneTargets = listing.files.flatMap((entry) => {
      const target = tombstoneTargetName(entry.name);
      return target && /\.ya?ml$/iu.test(target) ? [target] : [];
    });
    if (shouldReclaim) {
      await Promise.all(
        [...new Set(tombstoneTargets)].map((name) =>
          reclaimCanvasDeleteTombstones(bb, source, `${directory}/${name}`),
        ),
      );
    }
    const files = [...new Set([...regular, ...tombstoneTargets])]
      .map((name) => `${directory}/${name}`)
      .sort();
    const documents = await Promise.all(
      files.map(async (file) => {
        try {
          return { entity: await read(file, false), diagnostic: null };
        } catch (error) {
          const name = basename(file).replace(/\.ya?ml$/iu, "");
          return {
            entity: null,
            diagnostic: {
              code: canvasFileDiagnosticCode(error),
              file,
              slug: name,
              value:
                error instanceof UnsupportedComponentTypeValidationAdvisory
                  ? error.value
                  : error instanceof RetiredComponentTypeReadAdvisory
                    ? error.entity.component_type
                    : null,
              message:
                error instanceof Error && error.message.length > 0
                  ? error.message
                  : "The working canvas YAML is invalid.",
            },
          };
        }
      }),
    );
    return {
      entities: documents.flatMap(({ entity }) => (entity ? [entity] : [])),
      diagnostics: documents.flatMap(({ diagnostic }) =>
        diagnostic ? [diagnostic] : [],
      ),
    };
  }

  return {
    read,
    async list(kind) {
      return (await listWithDiagnostics(kind)).entities;
    },
    listWithDiagnostics,
    async write(file, content, expectedSha256) {
      const result = await bb.sdk.files.write({
        hostId: source.hostId,
        path: absolutePath(source, file),
        rootPath: source.path,
        content,
        contentEncoding: "utf8",
        createParents: true,
        expectedSha256,
      });
      return result.outcome === "conflict"
        ? { outcome: "conflict", currentSha256: result.currentSha256 }
        : { outcome: "written", sha256: result.sha256 };
    },
    remove(file, expectedSha256) {
      return casRemoveCanvasFile(bb, source, file, expectedSha256);
    },
  };
}

const CANVAS_KIND_BY_DIRECTORY = [
  "component",
  "zone",
  "asset",
  "dataflow",
  "threat",
] as const satisfies readonly CanvasEntityKind[];

export function canonicalizeCanvasEntity(
  kind: CanvasEntityKind,
  payload: Record<string, unknown>,
): ArchitectureYamlEntity {
  return parseArchitectureEntity(kind, payload);
}

export type CanvasEditCommand =
  | { kind: "create"; entity: ArchitectureYamlEntity }
  | {
      kind: "update";
      entityKind: ArchitectureKind | "threat";
      slug: string;
      patch: Record<string, unknown>;
    }
  | {
      kind: "delete";
      entityKind: ArchitectureKind | "threat";
      slug: string;
      mode: "cascade" | "detach";
    };

export interface EditResult {
  file: string;
  operation: "create" | "update" | "delete";
  slug: string;
  changedFields: string[];
  beforeSha256: string | null;
  afterSha256: string | null;
}

export interface EditDeps {
  files: CanvasFileStore;
  slugWasUsed(kind: CanvasEntityKind, slug: string): Promise<boolean>;
  recordSlugUse(kind: CanvasEntityKind, slug: string): void | Promise<void>;
  referenceExists(
    kind: CanvasEntityKind | "mitigation",
    slug: string,
  ): Promise<boolean>;
  methodologyCategoryAllowed?(category: string): Promise<boolean>;
  deletionImpact(kind: CanvasEntityKind, slug: string): Promise<DeletionImpact>;
}

export class CanvasCasConflictError extends Error {
  constructor(
    readonly file: string,
    readonly expectedSha256: string | null,
    readonly currentSha256: string | null,
    readonly preservedFile: string | null = null,
  ) {
    super(
      `LOCAL_WRITE_CONFLICT: ${file} changed outside this editor. Reload and compare before retrying.`,
    );
    this.name = "CanvasCasConflictError";
  }
}

export class CanvasSlugReuseError extends Error {
  constructor(
    readonly entityKind: CanvasEntityKind,
    readonly slug: string,
  ) {
    super(
      `${entityKind} slug “${slug}” was already used and cannot be reused.`,
    );
    this.name = "CanvasSlugReuseError";
  }
}

function semanticChangedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  const fields = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  return [...fields]
    .filter((field) => {
      const beforePresent = before !== null && Object.hasOwn(before, field);
      const afterPresent = after !== null && Object.hasOwn(after, field);
      return (
        beforePresent !== afterPresent ||
        (beforePresent &&
          afterPresent &&
          canonicalJson(before[field]) !== canonicalJson(after[field]))
      );
    })
    .sort();
}

function mergePatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...current };
  for (const [field, value] of Object.entries(patch)) {
    if (value === null) delete merged[field];
    else merged[field] = value;
  }
  return merged;
}

async function validateCommandReferences(
  deps: EditDeps,
  entity: ArchitectureYamlEntity,
): Promise<void> {
  const results = await Promise.all(
    entityReferences(entity).map(async (reference) => ({
      reference,
      exists: await deps.referenceExists(reference.kind, reference.slug),
    })),
  );
  const accepted = new Set(
    results
      .filter((result) => result.exists)
      .map(
        (result) => `${result.reference.kind}\u0000${result.reference.slug}`,
      ),
  );
  validateEntityReferences(entity, {
    exists(kind, slug) {
      return accepted.has(`${kind}\u0000${slug}`);
    },
  });
  if (
    entity.kind === "threat" &&
    deps.methodologyCategoryAllowed &&
    !(await deps.methodologyCategoryAllowed(entity.category))
  ) {
    throw new CanvasEntityValidationError(
      "INVALID_METHODOLOGY_VOCABULARY",
      `threat.category “${entity.category}” is not in the accepted STRIDE methodology vocabulary.`,
      "category",
    );
  }
}

function expectedFence(
  observed: string,
  expectedSha256: string | undefined,
  file: string,
): string {
  if (expectedSha256 !== undefined && expectedSha256 !== observed) {
    throw new CanvasCasConflictError(file, expectedSha256, observed);
  }
  return observed;
}

export async function applyCanvasCommand(
  deps: EditDeps,
  command: CanvasEditCommand,
  expectedSha256?: string,
): Promise<EditResult> {
  if (command.kind === "create") {
    const entity = validateArchitecturePayload(
      command.entity.kind,
      architectureEntityPayload(command.entity),
    );
    const file = canvasEntityFile(entity.kind, entity.slug);
    if (
      (await deps.files.read(file)) !== null ||
      (await deps.slugWasUsed(entity.kind, entity.slug))
    ) {
      throw new CanvasSlugReuseError(entity.kind, entity.slug);
    }
    await validateCommandReferences(deps, entity);
    const content = serializeCanvasEntity(entity);
    const result = await deps.files.write(file, content, null);
    if (result.outcome === "conflict") {
      throw new CanvasCasConflictError(file, null, result.currentSha256);
    }
    await deps.recordSlugUse(entity.kind, entity.slug);
    return {
      file,
      operation: "create",
      slug: entity.slug,
      changedFields: semanticChangedFields(
        null,
        architectureEntityPayload(entity),
      ),
      beforeSha256: null,
      afterSha256: result.sha256,
    };
  }

  const file = canvasEntityFile(command.entityKind, command.slug);
  const current = await deps.files.read(file);
  if (!current) {
    throw new CanvasCasConflictError(file, expectedSha256 ?? null, null);
  }
  const fence = expectedFence(current.sha256, expectedSha256, file);

  if (command.kind === "update") {
    if (
      Object.hasOwn(command.patch, "slug") ||
      Object.hasOwn(command.patch, "kind")
    ) {
      throw new CanvasEntityValidationError(
        "IMMUTABLE_SLUG",
        "Entity kind and slug are immutable. Create a new entity instead.",
        "slug",
      );
    }
    const before = architectureEntityPayload(current.entity);
    const entity = validateArchitecturePayload(
      command.entityKind,
      mergePatch(before, command.patch),
    );
    await validateCommandReferences(deps, entity);
    const fields = semanticChangedFields(
      before,
      architectureEntityPayload(entity),
    );
    if (fields.length === 0) {
      return {
        file,
        operation: "update",
        slug: command.slug,
        changedFields: [],
        beforeSha256: current.sha256,
        afterSha256: current.sha256,
      };
    }
    const content = serializeCanvasEntity(entity);
    const result = await deps.files.write(file, content, fence);
    if (result.outcome === "conflict") {
      throw new CanvasCasConflictError(file, fence, result.currentSha256);
    }
    return {
      file,
      operation: "update",
      slug: command.slug,
      changedFields: fields,
      beforeSha256: current.sha256,
      afterSha256: result.sha256,
    };
  }

  const impact = await deps.deletionImpact(command.entityKind, command.slug);
  if (!impact.allowedActions.includes(command.mode)) {
    throw new CanvasEntityValidationError(
      "DELETE_MODE_NOT_ALLOWED",
      `${command.mode} is not allowed for ${command.entityKind} “${command.slug}”.`,
    );
  }
  const result = await deps.files.remove(file, fence);
  if (result.outcome === "conflict") {
    throw new CanvasCasConflictError(
      file,
      fence,
      result.currentSha256,
      result.preservedFile,
    );
  }
  return {
    file,
    operation: "delete",
    slug: command.slug,
    changedFields: semanticChangedFields(
      architectureEntityPayload(current.entity),
      null,
    ),
    beforeSha256: current.sha256,
    afterSha256: null,
  };
}
