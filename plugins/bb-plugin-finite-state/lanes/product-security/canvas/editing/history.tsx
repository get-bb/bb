import type {
  ArchitectureYamlEntity,
  CanvasEntityKind,
} from "./schema.js";

export interface CanvasHistoryEntry {
  kind: CanvasEntityKind;
  slug: string;
  before: ArchitectureYamlEntity | null;
  after: ArchitectureYamlEntity | null;
  currentSha256: string | null;
  deleteMode: "cascade" | "detach";
}

export interface CanvasHistoryTransition {
  kind: CanvasEntityKind;
  slug: string;
  from: ArchitectureYamlEntity | null;
  to: ArchitectureYamlEntity | null;
  expectedSha256: string | null;
  deleteMode: "cascade" | "detach";
}

export interface CanvasHistoryTransitionResult {
  afterSha256: string | null;
}

export interface CanvasHistoryState {
  canUndo: boolean;
  canRedo: boolean;
  invalidatedEntities: readonly string[];
}

export type CanvasHistoryExecutor = (
  transition: CanvasHistoryTransition,
) => Promise<CanvasHistoryTransitionResult>;

function entityIdentity(kind: CanvasEntityKind, slug: string): string {
  return `${kind}/${slug}`;
}

function snapshotMatchesIdentity(
  snapshot: ArchitectureYamlEntity | null,
  entry: CanvasHistoryEntry,
): boolean {
  return (
    snapshot === null ||
    (snapshot.kind === entry.kind && snapshot.slug === entry.slug)
  );
}

export class CanvasEditHistory {
  readonly #undo: CanvasHistoryEntry[] = [];
  readonly #redo: CanvasHistoryEntry[] = [];
  readonly #invalidated = new Set<string>();

  constructor(
    private readonly executeTransition: CanvasHistoryExecutor,
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

  record(entry: CanvasHistoryEntry): void {
    if (entry.before === null && entry.after === null) {
      throw new Error("Canvas history entry has no semantic state.");
    }
    if (
      !snapshotMatchesIdentity(entry.before, entry) ||
      !snapshotMatchesIdentity(entry.after, entry)
    ) {
      throw new Error("Canvas history snapshot identity does not match its entry.");
    }
    this.#undo.push({ ...entry });
    if (this.#undo.length > this.limit) this.#undo.shift();
    this.#redo.length = 0;
    this.#invalidated.delete(entityIdentity(entry.kind, entry.slug));
  }

  invalidate(kind: CanvasEntityKind, slug: string): void {
    const identity = entityIdentity(kind, slug);
    this.#invalidated.add(identity);
    const keepOtherEntity = (candidate: CanvasHistoryEntry) =>
      entityIdentity(candidate.kind, candidate.slug) !== identity;
    const nextUndo = this.#undo.filter(keepOtherEntity);
    const nextRedo = this.#redo.filter(keepOtherEntity);
    this.#undo.splice(0, this.#undo.length, ...nextUndo);
    this.#redo.splice(0, this.#redo.length, ...nextRedo);
  }

  undo(): Promise<CanvasHistoryTransitionResult | null> {
    return this.#move(this.#undo, this.#redo, "undo");
  }

  redo(): Promise<CanvasHistoryTransitionResult | null> {
    return this.#move(this.#redo, this.#undo, "redo");
  }

  async #move(
    source: CanvasHistoryEntry[],
    destination: CanvasHistoryEntry[],
    direction: "undo" | "redo",
  ): Promise<CanvasHistoryTransitionResult | null> {
    const entry = source.at(-1);
    if (!entry) return null;
    const from = direction === "undo" ? entry.after : entry.before;
    const to = direction === "undo" ? entry.before : entry.after;
    try {
      const result = await this.executeTransition({
        kind: entry.kind,
        slug: entry.slug,
        from,
        to,
        expectedSha256: entry.currentSha256,
        deleteMode: entry.deleteMode,
      });
      source.pop();
      entry.currentSha256 = result.afterSha256;
      destination.push(entry);
      return result;
    } catch (error) {
      // The RPC boundary cannot reliably classify every host-side CAS failure.
      // Conservatively require reload/compare after any failed inverse command.
      this.invalidate(entry.kind, entry.slug);
      throw error;
    }
  }
}
