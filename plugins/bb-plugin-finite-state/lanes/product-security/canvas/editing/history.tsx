import {
  applyCanvasCommand,
  CanvasCasConflictError,
  type CanvasEditCommand,
  type EditDeps,
  type EditResult,
} from "./commands.js";
import type { ArchitectureYamlEntity, CanvasEntityKind } from "./schema.js";
import { canvasEntityFile, serializeCanvasEntity } from "./writer.js";

interface HistorySnapshot {
  entity: ArchitectureYamlEntity;
  sha256: string;
}

interface HistoryEntry {
  command: CanvasEditCommand;
  entityKind: CanvasEntityKind;
  slug: string;
  file: string;
  before: HistorySnapshot | null;
  after: HistorySnapshot | null;
  changedFields: string[];
}

export interface CanvasHistoryState {
  canUndo: boolean;
  canRedo: boolean;
  invalidatedEntities: readonly string[];
}

function commandIdentity(command: CanvasEditCommand): {
  kind: CanvasEntityKind;
  slug: string;
} {
  return command.kind === "create"
    ? { kind: command.entity.kind, slug: command.entity.slug }
    : { kind: command.entityKind, slug: command.slug };
}

function entityIdentity(kind: CanvasEntityKind, slug: string): string {
  return `${kind}/${slug}`;
}

export class CanvasEditHistory {
  readonly #undo: HistoryEntry[] = [];
  readonly #redo: HistoryEntry[] = [];
  readonly #invalidated = new Set<string>();

  constructor(
    private readonly deps: EditDeps,
    private readonly limit = 50,
  ) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Canvas history limit must be an integer from 1 to 500.");
    }
  }

  state(): CanvasHistoryState {
    return {
      canUndo: this.#undo.length > 0,
      canRedo: this.#redo.length > 0,
      invalidatedEntities: [...this.#invalidated].sort(),
    };
  }

  clearInvalidation(kind: CanvasEntityKind, slug: string): void {
    this.#invalidated.delete(entityIdentity(kind, slug));
  }

  async execute(
    command: CanvasEditCommand,
    expectedSha256?: string,
  ): Promise<EditResult> {
    const identity = commandIdentity(command);
    const file = canvasEntityFile(identity.kind, identity.slug);
    const beforeStored = await this.deps.files.read(file);
    const result = await applyCanvasCommand(this.deps, command, expectedSha256);
    const afterStored = await this.deps.files.read(file);
    this.#undo.push({
      command,
      entityKind: identity.kind,
      slug: identity.slug,
      file,
      before: beforeStored
        ? { entity: beforeStored.entity, sha256: beforeStored.sha256 }
        : null,
      after: afterStored
        ? { entity: afterStored.entity, sha256: afterStored.sha256 }
        : null,
      changedFields: result.changedFields,
    });
    if (this.#undo.length > this.limit) this.#undo.shift();
    this.#redo.length = 0;
    this.#invalidated.delete(entityIdentity(identity.kind, identity.slug));
    return result;
  }

  async undo(): Promise<EditResult | null> {
    const entry = this.#undo.at(-1);
    if (!entry) return null;
    try {
      const result = await this.#transition(entry.after, entry.before, entry);
      this.#undo.pop();
      this.#redo.push(entry);
      return result;
    } catch (error) {
      if (error instanceof CanvasCasConflictError) this.#invalidate(entry);
      throw error;
    }
  }

  async redo(): Promise<EditResult | null> {
    const entry = this.#redo.at(-1);
    if (!entry) return null;
    try {
      const result = await this.#transition(entry.before, entry.after, entry);
      this.#redo.pop();
      this.#undo.push(entry);
      return result;
    } catch (error) {
      if (error instanceof CanvasCasConflictError) this.#invalidate(entry);
      throw error;
    }
  }

  #invalidate(entry: HistoryEntry): void {
    const identity = entityIdentity(entry.entityKind, entry.slug);
    this.#invalidated.add(identity);
    const keepOtherEntity = (candidate: HistoryEntry) =>
      entityIdentity(candidate.entityKind, candidate.slug) !== identity;
    const nextUndo = this.#undo.filter(keepOtherEntity);
    const nextRedo = this.#redo.filter(keepOtherEntity);
    this.#undo.splice(0, this.#undo.length, ...nextUndo);
    this.#redo.splice(0, this.#redo.length, ...nextRedo);
  }

  async #transition(
    from: HistorySnapshot | null,
    to: HistorySnapshot | null,
    entry: HistoryEntry,
  ): Promise<EditResult> {
    if (from === null && to === null) {
      throw new Error("Canvas history entry has no before or after snapshot.");
    }
    if (from === null && to !== null) {
      const result = await this.deps.files.write(
        entry.file,
        serializeCanvasEntity(to.entity),
        null,
      );
      if (result.outcome === "conflict") {
        throw new CanvasCasConflictError(
          entry.file,
          null,
          result.currentSha256,
        );
      }
      return {
        file: entry.file,
        operation: "create",
        slug: entry.slug,
        changedFields: entry.changedFields,
        beforeSha256: null,
        afterSha256: result.sha256,
      };
    }
    if (from !== null && to === null) {
      const result = await this.deps.files.remove(entry.file, from.sha256);
      if (result.outcome === "conflict") {
        throw new CanvasCasConflictError(
          entry.file,
          from.sha256,
          result.currentSha256,
          result.preservedFile,
        );
      }
      return {
        file: entry.file,
        operation: "delete",
        slug: entry.slug,
        changedFields: entry.changedFields,
        beforeSha256: from.sha256,
        afterSha256: null,
      };
    }
    if (from === null || to === null) {
      throw new Error("Canvas history transition is incomplete.");
    }
    const result = await this.deps.files.write(
      entry.file,
      serializeCanvasEntity(to.entity),
      from.sha256,
    );
    if (result.outcome === "conflict") {
      throw new CanvasCasConflictError(
        entry.file,
        from.sha256,
        result.currentSha256,
      );
    }
    return {
      file: entry.file,
      operation: "update",
      slug: entry.slug,
      changedFields: entry.changedFields,
      beforeSha256: from.sha256,
      afterSha256: result.sha256,
    };
  }
}
