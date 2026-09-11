import type { QueryClient } from "@tanstack/react-query";
import {
  draftContentSchema,
  draftIdSchema,
  type Draft,
  type DraftContent,
  type DraftContentInput,
  type DraftSubmitResponse,
} from "@bb/server-contract";
import { isPromptDraftEmpty } from "@bb/client-core";
import { allDraftQueryKeyPrefix } from "@/hooks/queries/query-keys";
import { HttpError } from "../api";
import {
  draftResourceQueryKey,
  isDraftGoneError,
  type DraftResourceApi,
} from "./resource-api";
import {
  DRAFT_RECOVERY_PREFIX,
  readDraftRecoveries,
  removeUnchangedRecovery,
  type DraftRecovery,
  type DraftRecoveryStorage,
  type StoredDraftRecovery,
} from "./recovery";

export type DraftResourceStatus =
  | "loading"
  | "saving"
  | "saved"
  | "error"
  | "conflict"
  | "deleted";

export interface DraftResourceSnapshot {
  id: string;
  content: DraftContent | null;
  status: DraftResourceStatus;
  error: Error | null;
  persistenceError: Error | null;
  recoveryCopies: readonly DraftContent[];
}

export interface RecoverableDraftSnapshot {
  id: string;
  content: DraftContent;
  updatedAt: number;
  status: "saving" | "error" | "conflict" | "deleted";
  error: Error | null;
  persistenceError: Error | null;
}

export type DraftResourceSubmitResult = DraftSubmitResponse & {
  recoveryDraftId: string | null;
};

interface Entry {
  id: string;
  buffer: DraftRecovery | null;
  sources: StoredDraftRecovery[];
  alternatives: StoredDraftRecovery[];
  persistenceError: Error | null;
  error: Error | null;
  deleted: boolean;
  busy: Promise<unknown> | null;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<() => void>;
  snapshot: DraftResourceSnapshot;
}

const EMPTY_CONTENT = draftContentSchema.parse({});

function sameContent(left: DraftContent, right: DraftContent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("Draft request failed. Your changes have been retained.");
}

export class DraftResourceStore {
  private readonly entries = new Map<string, Entry>();
  private readonly writerId = crypto.randomUUID();
  private readonly listeners = new Set<() => void>();
  private recoverable: readonly RecoverableDraftSnapshot[] = [];
  private resumed = false;
  private disposed = false;
  private readonly unsubscribeCache: () => void;

  constructor(
    private readonly queryClient: QueryClient,
    private readonly api: DraftResourceApi,
    private readonly storage: DraftRecoveryStorage,
    private readonly debounceMs = 350,
  ) {
    const recovered = readDraftRecoveries(storage);
    for (const id of new Set(
      recovered.records.map((record) => record.value.id),
    )) {
      this.entry(id);
    }
    this.unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type !== "updated" ||
        (event.action.type !== "success" && event.action.type !== "error")
      )
        return;
      const key = event.query.queryKey;
      if (
        key[0] !== "drafts" ||
        key[1] !== "detail" ||
        typeof key[2] !== "string"
      )
        return;
      const entry = this.entries.get(key[2]);
      if (!entry || entry.busy) return;
      this.reconcile(entry);
      this.emit(entry);
    });
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.persistAll);
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      window.addEventListener("storage", this.onStorage);
    }
    this.refreshRecoverable();
  }

  private entry(id: string): Entry {
    draftIdSchema.parse(id);
    const existing = this.entries.get(id);
    if (existing) return existing;
    const recovered = readDraftRecoveries(this.storage, id);
    const selected = recovered.records[0] ?? null;
    const sources = recovered.records.filter(
      (record) =>
        selected !== null &&
        sameContent(record.value.content, selected.value.content) &&
        record.value.baseRevision === selected.value.baseRevision &&
        JSON.stringify(record.value.submission) ===
          JSON.stringify(selected.value.submission),
    );
    const alternatives = recovered.records.filter(
      (record) => !sources.includes(record),
    );
    const buffer = selected ? { ...selected.value } : null;
    if (buffer && alternatives.length > 0) buffer.blocked = "conflict";
    const entry: Entry = {
      id,
      buffer,
      sources,
      alternatives,
      persistenceError: recovered.error,
      error: null,
      deleted: buffer?.blocked === "deleted",
      busy: null,
      timer: null,
      listeners: new Set(),
      snapshot: {
        id,
        content: null,
        status: "loading",
        error: null,
        persistenceError: recovered.error,
        recoveryCopies: [],
      },
    };
    this.entries.set(id, entry);
    this.reconcile(entry);
    this.refreshSnapshot(entry);
    return entry;
  }

  private remote(id: string): Draft | null | undefined {
    return this.queryClient.getQueryData<Draft | null>(
      draftResourceQueryKey(id),
    );
  }

  private refreshSnapshot(entry: Entry): boolean {
    const remote = this.remote(entry.id);
    const blocked = entry.buffer?.blocked;
    const deleted = entry.deleted || entry.buffer?.deleteRequested === true;
    const error =
      entry.error ??
      this.queryClient.getQueryState<Draft | null, Error>(
        draftResourceQueryKey(entry.id),
      )?.error ??
      null;
    const status: DraftResourceStatus =
      blocked ??
      (deleted
        ? "deleted"
        : error || entry.persistenceError
          ? "error"
          : entry.buffer
            ? "saving"
            : remote === undefined
              ? "loading"
              : "saved");
    const next: DraftResourceSnapshot = {
      id: entry.id,
      content: deleted
        ? EMPTY_CONTENT
        : (entry.buffer?.content ?? remote?.content ?? null),
      status,
      error,
      persistenceError: entry.persistenceError,
      recoveryCopies: [
        ...(blocked && entry.buffer ? [entry.buffer.content] : []),
        ...entry.alternatives.map((record) => record.value.content),
      ],
    };
    const previous = entry.snapshot;
    if (
      (previous.content === next.content ||
        (previous.content !== null &&
          next.content !== null &&
          sameContent(previous.content, next.content))) &&
      previous.status === next.status &&
      previous.error === next.error &&
      previous.persistenceError === next.persistenceError &&
      previous.recoveryCopies.length === next.recoveryCopies.length &&
      previous.recoveryCopies.every((content, index) =>
        sameContent(content, next.recoveryCopies[index]!),
      )
    )
      return false;
    entry.snapshot = next;
    return true;
  }

  private refreshRecoverable(): void {
    const next = Array.from(this.entries.values()).flatMap(
      (entry): RecoverableDraftSnapshot[] => {
        const buffer = entry.buffer;
        if (!buffer || isPromptDraftEmpty(buffer.content.prompt)) return [];
        const status = entry.snapshot.status;
        return [
          {
            id: entry.id,
            content: buffer.content,
            updatedAt: buffer.updatedAt,
            status:
              status === "loading" || status === "saved" ? "saving" : status,
            error: entry.snapshot.error,
            persistenceError: entry.persistenceError,
          },
        ];
      },
    );
    if (
      this.recoverable.length === next.length &&
      this.recoverable.every((previous, index) => {
        const current = next[index]!;
        return (
          previous.id === current.id &&
          sameContent(previous.content, current.content) &&
          previous.updatedAt === current.updatedAt &&
          previous.status === current.status &&
          previous.error === current.error &&
          previous.persistenceError === current.persistenceError
        );
      })
    )
      return;
    this.recoverable = next;
    for (const listener of this.listeners) listener();
  }

  private emit(entry: Entry): void {
    if (this.refreshSnapshot(entry)) {
      for (const listener of entry.listeners) listener();
    }
    this.refreshRecoverable();
  }

  private persist(entry: Entry): void {
    try {
      const key = `${DRAFT_RECOVERY_PREFIX}${entry.id}:${this.writerId}`;
      if (entry.buffer) {
        this.storage.setItem(key, JSON.stringify(entry.buffer));
      } else {
        this.storage.removeItem(key);
        for (const source of entry.sources)
          removeUnchangedRecovery(this.storage, source);
        entry.sources = [];
      }
      entry.persistenceError = null;
    } catch {
      entry.persistenceError = new Error(
        "Could not save browser recovery data. Keep this page open and retry saving.",
      );
    }
  }

  private persistAll = (): void => {
    for (const entry of this.entries.values()) {
      if (!entry.buffer) continue;
      this.persist(entry);
      this.emit(entry);
    }
  };

  private onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") this.persistAll();
  };

  private onStorage = (event: StorageEvent): void => {
    if (!event.key?.startsWith(DRAFT_RECOVERY_PREFIX) || !event.newValue)
      return;
    const recovered = readDraftRecoveries(this.storage);
    for (const record of recovered.records) {
      const entry = this.entries.get(record.value.id);
      if (!entry) {
        this.entry(record.value.id);
        continue;
      }
      if (
        record.key.endsWith(`:${this.writerId}`) ||
        entry.sources.some(
          (item) => item.key === record.key && item.raw === record.raw,
        )
      )
        continue;
      const previous = entry.alternatives.findIndex(
        (item) => item.key === record.key,
      );
      if (previous >= 0) entry.alternatives.splice(previous, 1);
      if (!entry.buffer) {
        entry.buffer = { ...record.value, blocked: "conflict" };
        entry.sources = [record];
      } else if (!sameContent(entry.buffer.content, record.value.content)) {
        entry.alternatives.push(record);
        entry.buffer.blocked = "conflict";
        this.cancelTimer(entry);
        this.persist(entry);
      }
      this.emit(entry);
    }
    this.refreshRecoverable();
  };

  private cancelTimer(entry: Entry): void {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
  }

  private schedule(entry: Entry): void {
    this.cancelTimer(entry);
    if (
      entry.buffer?.blocked ||
      entry.buffer?.submission ||
      entry.buffer?.deleteRequested
    )
      return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.flush(entry.id).catch(() => {});
    }, this.debounceMs);
  }

  private reconcile(entry: Entry): void {
    if (entry.deleted) return;
    const remote = this.remote(entry.id);
    if (remote === undefined) return;
    const buffer = entry.buffer;
    if (!buffer) {
      entry.deleted = remote === null;
      return;
    }
    if (buffer.createContent || buffer.submission || buffer.blocked) return;
    if (remote === null) {
      entry.deleted = true;
      buffer.blocked = "deleted";
      this.cancelTimer(entry);
      this.persist(entry);
    } else if (remote.revision !== buffer.baseRevision) {
      if (
        sameContent(remote.content, buffer.content) &&
        !buffer.forceRevision &&
        !buffer.deleteRequested
      ) {
        entry.buffer = null;
      } else {
        buffer.blocked = "conflict";
        this.cancelTimer(entry);
      }
      this.persist(entry);
    }
  }

  getSnapshot = (id: string): DraftResourceSnapshot => this.entry(id).snapshot;

  subscribe = (id: string, listener: () => void): (() => void) => {
    const entry = this.entry(id);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  };

  getRecoverableSnapshot = (): readonly RecoverableDraftSnapshot[] =>
    this.recoverable;

  subscribeRecoverable = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  create(initial: DraftContentInput): string {
    const id = `drf_${crypto.randomUUID()}`;
    this.initialize(id, initial);
    return id;
  }

  initialize(id: string, initial: DraftContentInput): boolean {
    const content = draftContentSchema.parse(initial);
    const entry = this.entry(id);
    if (entry.buffer) {
      this.persist(entry);
      this.emit(entry);
      return entry.persistenceError === null;
    }
    if (this.remote(id) !== undefined || entry.deleted) return true;
    entry.buffer = {
      version: 1,
      id,
      content,
      createContent: content,
      baseRevision: null,
      submission: null,
      blocked: null,
      deleteRequested: false,
      forceRevision: false,
      updatedAt: Date.now(),
    };
    this.persist(entry);
    this.emit(entry);
    this.schedule(entry);
    return entry.persistenceError === null;
  }

  async load(id: string): Promise<void> {
    const entry = this.entry(id);
    try {
      await this.queryClient.fetchQuery({
        queryKey: draftResourceQueryKey(id),
        queryFn: ({ signal }) => this.api.get(id, signal),
        staleTime: 0,
      });
      entry.error = null;
      if (!entry.busy) this.reconcile(entry);
      this.emit(entry);
    } catch (error) {
      entry.error = asError(error);
      this.emit(entry);
      throw error;
    }
  }

  edit(
    id: string,
    updater: (content: DraftContent) => DraftContentInput,
  ): void {
    const entry = this.entry(id);
    if (entry.deleted || entry.buffer?.deleteRequested) return;
    const content = entry.buffer?.content ?? this.remote(id)?.content;
    if (!content)
      throw new Error("Wait for this draft to load before editing.");
    const next = draftContentSchema.parse(updater(content));
    if (sameContent(content, next)) return;
    entry.buffer = entry.buffer
      ? { ...entry.buffer, content: next, updatedAt: Date.now() }
      : {
          version: 1,
          id,
          content: next,
          createContent: null,
          baseRevision: this.remote(id)?.revision ?? null,
          submission: null,
          blocked: null,
          deleteRequested: false,
          forceRevision: false,
          updatedAt: Date.now(),
        };
    entry.error = null;
    this.persist(entry);
    this.emit(entry);
    this.schedule(entry);
  }

  private async exclusive<T>(entry: Entry, run: () => Promise<T>): Promise<T> {
    while (entry.busy) await entry.busy.catch(() => {});
    const task = Promise.resolve().then(run);
    entry.busy = task;
    this.emit(entry);
    try {
      return await task;
    } catch (error) {
      entry.error = asError(error);
      if (error instanceof HttpError && entry.buffer) {
        if (error.code === "draft_revision_conflict")
          entry.buffer.blocked = "conflict";
        if (
          isDraftGoneError(error) &&
          (!entry.buffer.submission || error.code === "draft_gone")
        ) {
          entry.buffer.submission = null;
          entry.buffer.blocked = "deleted";
          entry.deleted = true;
          await this.setRemote(entry.id, null);
        }
      }
      this.persist(entry);
      throw error;
    } finally {
      entry.busy = null;
      this.reconcile(entry);
      this.emit(entry);
    }
  }

  private async setRemote(id: string, draft: Draft | null): Promise<void> {
    await this.queryClient.cancelQueries({
      queryKey: draftResourceQueryKey(id),
      exact: true,
    });
    const current = this.remote(id);
    if (draft && current && current.revision > draft.revision) return;
    this.queryClient.setQueryData<Draft | null>(
      draftResourceQueryKey(id),
      draft,
    );
    void this.queryClient.invalidateQueries({
      queryKey: allDraftQueryKeyPrefix(),
      predicate: (query) => query.queryKey[1] !== "detail",
    });
  }

  private async save(entry: Entry, forDelete = false): Promise<Draft> {
    this.cancelTimer(entry);
    if (entry.deleted || entry.buffer?.blocked)
      throw new Error("This draft needs recovery before it can be saved.");
    if (entry.buffer?.submission)
      throw new Error(
        "Retry the pending submission before saving newer edits.",
      );
    while (entry.buffer && (!entry.buffer.deleteRequested || forDelete)) {
      const buffer = entry.buffer;
      if (buffer.blocked)
        throw new Error(
          "This draft changed elsewhere. Reload it or save your edits as a copy.",
        );
      const creating = buffer.createContent !== null;
      if (creating) {
        const original = buffer.createContent;
        if (original === null)
          throw new Error("Missing initial draft contents.");
        const response = await this.api.create(entry.id, original);
        await this.setRemote(entry.id, response.draft);
        if (!response.draft) {
          if (entry.buffer) entry.buffer.blocked = "deleted";
          entry.deleted = true;
          this.persist(entry);
          throw new Error(
            "This draft was already consumed or deleted. Save your local edits as a new copy.",
          );
        }
        const current = entry.buffer;
        if (!current) throw new Error("Draft recovery data is unavailable.");
        current.createContent = null;
        current.baseRevision = response.draft.revision;
        if (
          !sameContent(response.draft.content, original) &&
          !sameContent(response.draft.content, current.content)
        ) {
          current.blocked = "conflict";
          this.persist(entry);
          throw new Error(
            "This draft was changed elsewhere. Your edits are available as a recovery copy.",
          );
        }
        if (
          sameContent(response.draft.content, current.content) &&
          !current.forceRevision &&
          !current.deleteRequested &&
          !current.blocked
        )
          entry.buffer = null;
        this.persist(entry);
        if (forDelete) return response.draft;
        if (current.deleteRequested) return response.draft;
        continue;
      }
      const remote = this.remote(entry.id);
      if (!remote || buffer.baseRevision === null) {
        await this.load(entry.id);
        this.reconcile(entry);
        if (!this.remote(entry.id) || entry.buffer?.blocked)
          throw new Error(
            "This draft is no longer available. Recover your local edits as a copy.",
          );
        continue;
      }
      if (forDelete) return remote;
      const submittedContent = buffer.content;
      const saved = await this.api.update(
        entry.id,
        buffer.baseRevision,
        submittedContent,
      );
      await this.setRemote(entry.id, saved);
      const current = entry.buffer;
      if (current) {
        current.baseRevision = saved.revision;
        current.forceRevision = false;
        if (
          sameContent(current.content, submittedContent) &&
          !current.deleteRequested &&
          !current.blocked
        )
          entry.buffer = null;
      }
      entry.error = null;
      this.persist(entry);
      this.emit(entry);
    }
    const remote = this.remote(entry.id);
    if (!remote) throw new Error("This draft has not been saved.");
    return remote;
  }

  flush(id: string): Promise<Draft> {
    const entry = this.entry(id);
    return this.exclusive(entry, () => this.save(entry));
  }

  submit(id: string): Promise<DraftResourceSubmitResult> {
    const entry = this.entry(id);
    return this.exclusive(entry, async () => {
      if (entry.buffer?.deleteRequested)
        throw new Error("This draft is being deleted.");
      if (!entry.buffer?.submission) {
        const saved = await this.save(entry);
        if (entry.buffer?.deleteRequested)
          throw new Error("This draft is being deleted.");
        entry.buffer = {
          version: 1,
          id,
          content: saved.content,
          baseRevision: saved.revision,
          createContent: null,
          submission: { revision: saved.revision, content: saved.content },
          blocked: null,
          deleteRequested: false,
          forceRevision: false,
          updatedAt: Date.now(),
        };
        this.persist(entry);
        this.emit(entry);
      }
      const submitted = entry.buffer.submission;
      if (!submitted) throw new Error("Missing draft submission revision.");
      let result: DraftSubmitResponse;
      try {
        result = await this.api.submit(id, submitted.revision);
      } catch (error) {
        if (
          error instanceof HttpError &&
          error.status === 409 &&
          error.code === "draft_revision_conflict" &&
          entry.buffer
        ) {
          entry.buffer.submission = null;
        }
        if (
          error instanceof HttpError &&
          (error.code === "draft_submission_failed" ||
            error.code === "draft_not_ready")
        ) {
          if (entry.buffer) {
            entry.buffer.submission = null;
            entry.buffer.forceRevision = true;
          }
        }
        throw error;
      }
      await this.setRemote(id, result.draft);
      const current = entry.buffer;
      const hasNewerEdits =
        current !== null && !sameContent(current.content, submitted.content);
      let recoveryDraftId: string | null = null;
      if (result.draft === null) {
        if (hasNewerEdits && current && !current.deleteRequested)
          recoveryDraftId = this.create(current.content);
        if (
          recoveryDraftId &&
          this.entry(recoveryDraftId).persistenceError &&
          current
        ) {
          current.submission = null;
          current.blocked = "deleted";
        } else {
          entry.buffer = null;
        }
        entry.deleted = true;
      } else if (hasNewerEdits && current) {
        current.submission = null;
        if (
          result.draft.revision !== submitted.revision &&
          !sameContent(result.draft.content, current.content)
        ) {
          current.blocked = "conflict";
        } else {
          current.baseRevision = result.draft.revision;
          if (sameContent(result.draft.content, current.content))
            entry.buffer = null;
        }
      } else {
        entry.buffer = null;
      }
      entry.error = null;
      this.persist(entry);
      if (entry.buffer) this.schedule(entry);
      return { ...result, recoveryDraftId };
    });
  }

  async delete(id: string): Promise<void> {
    const entry = this.entry(id);
    const content = entry.buffer?.content ?? this.remote(id)?.content;
    if (!content) {
      await this.load(id);
      if (entry.deleted) return;
      return this.delete(id);
    }
    entry.buffer = entry.buffer ?? {
      version: 1,
      id,
      content,
      baseRevision: this.remote(id)?.revision ?? null,
      createContent: null,
      submission: null,
      blocked: null,
      deleteRequested: false,
      forceRevision: false,
      updatedAt: Date.now(),
    };
    entry.buffer.deleteRequested = true;
    this.cancelTimer(entry);
    this.persist(entry);
    this.emit(entry);
    await this.exclusive(entry, async () => {
      if (this.remote(id) === null && !entry.buffer?.createContent) {
        entry.buffer = null;
        entry.deleted = true;
        this.persist(entry);
        return;
      }
      const saved = await this.save(entry, true);
      await this.api.delete(id, entry.buffer?.baseRevision ?? saved.revision);
      entry.buffer = null;
      entry.deleted = true;
      entry.error = null;
      await this.setRemote(id, null);
      this.persist(entry);
    });
  }

  async retry(id: string): Promise<DraftResourceSubmitResult | null> {
    const entry = this.entry(id);
    this.persist(entry);
    if (entry.buffer?.submission) return this.submit(id);
    else if (entry.buffer?.deleteRequested) await this.delete(id);
    else if (entry.buffer) await this.flush(id);
    else await this.load(id);
    this.emit(entry);
    return null;
  }

  async reloadRemote(id: string): Promise<void> {
    const entry = this.entry(id);
    await this.exclusive(entry, async () => {
      if (entry.buffer?.submission)
        throw new Error(
          "Retry the pending submission before discarding recovery data.",
        );
      await this.load(id);
      this.cancelTimer(entry);
      entry.buffer = null;
      for (const alternative of entry.alternatives)
        removeUnchangedRecovery(this.storage, alternative);
      entry.alternatives = [];
      entry.deleted = this.remote(id) === null;
      entry.error = null;
      this.persist(entry);
    });
  }

  saveLocalAsCopy(id: string, index = 0): string {
    const entry = this.entry(id);
    const content =
      entry.snapshot.recoveryCopies[index] ?? entry.buffer?.content;
    if (!content) throw new Error("There are no local edits to recover.");
    return this.create(content);
  }

  resumeRecoveries = (): void => {
    if (this.resumed) return;
    this.resumed = true;
    for (const entry of this.entries.values()) {
      if (
        !entry.buffer ||
        entry.buffer.blocked ||
        entry.buffer.submission ||
        entry.buffer.deleteRequested
      )
        continue;
      void this.load(entry.id)
        .then(() => {
          if (!entry.buffer?.blocked) this.schedule(entry);
        })
        .catch(() => {});
    }
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.persistAll();
    this.unsubscribeCache();
    for (const entry of this.entries.values()) this.cancelTimer(entry);
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.persistAll);
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      window.removeEventListener("storage", this.onStorage);
    }
  }
}
