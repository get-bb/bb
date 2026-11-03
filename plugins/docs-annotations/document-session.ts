import { useEffect, useSyncExternalStore } from "react";
import type { Proposal } from "./proposals.js";

export interface DocumentSnapshot {
  content: string;
  sha256: string;
  proposal: Proposal | null;
  previewBaseUrl: string;
  previewPath: string;
}

export type ProposalAction = "accept" | "reject" | "undo" | "redo";

export interface DocumentWriter {
  renamesToTitle: boolean;
  save(
    path: string,
    content: string,
    expectedSha256: string,
    renameToTitle: boolean,
  ): Promise<{ path: string; sha256: string }>;
  updateProposal?(
    path: string,
    content: string,
    version: number,
  ): Promise<Proposal>;
  resolveProposal?(
    path: string,
    action: ProposalAction,
    version: number,
  ): Promise<Proposal>;
  refetch(): Promise<void>;
}

export interface DocumentState {
  loaded: boolean;
  path: string;
  base: DocumentSnapshot | null;
  draft: string;
  dirty: boolean;
  saving: boolean;
  busy: boolean;
  conflict: DocumentSnapshot | null;
  missing: boolean;
  error: string | null;
}

const RESOLVE_TIMEOUT_MS = 5_000;
let nextSessionId = 0;

function identity(snapshot: DocumentSnapshot): string {
  return JSON.stringify([
    snapshot.sha256,
    snapshot.proposal?.version ?? null,
    snapshot.proposal?.status ?? null,
  ]);
}

function isMissingError(message: string): boolean {
  return /\bENOENT\b|path does not exist|not found|no such file|unknown vault/i.test(
    message,
  );
}

export function createDocumentSession(options: {
  path: string;
  showsProposals: boolean;
  delay: number;
  onRename?(from: string, to: string): void;
}) {
  let state: DocumentState = {
    loaded: false,
    path: options.path,
    base: null,
    draft: "",
    dirty: false,
    saving: false,
    busy: false,
    conflict: null,
    missing: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  const superseded = new Set<string>();
  let writer: DocumentWriter | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> | null = null;
  let inFlight: string | null = null;
  let awaitingVersion: number | null = null;
  let awaitTimer: ReturnType<typeof setTimeout> | null = null;
  let held: DocumentSnapshot | null = null;

  const shown = (snapshot: DocumentSnapshot) =>
    options.showsProposals && snapshot.proposal?.status === "pending"
      ? snapshot.proposal.content
      : snapshot.content;
  const set = (patch: Partial<DocumentState>) => {
    state = { ...state, ...patch };
    state.dirty = state.base !== null && state.draft !== shown(state.base);
    for (const listener of listeners) listener();
  };
  const replaceBase = (next: DocumentSnapshot) => {
    if (state.base) superseded.add(identity(state.base));
    superseded.delete(identity(next));
  };
  const adopt = (snapshot: DocumentSnapshot) => {
    replaceBase(snapshot);
    set({
      loaded: true,
      base: snapshot,
      draft: shown(snapshot),
      conflict: null,
      missing: false,
      error: null,
    });
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush(false);
    }, options.delay);
  };

  const receive = (snapshot: DocumentSnapshot) => {
    const base = state.base;
    if (base === null) return adopt(snapshot);
    if (identity(snapshot) === identity(base)) {
      if (
        snapshot.previewBaseUrl !== base.previewBaseUrl ||
        state.missing ||
        state.error
      )
        set({
          base: { ...base, previewBaseUrl: snapshot.previewBaseUrl },
          missing: false,
          error: null,
        });
      return;
    }
    if (superseded.has(identity(snapshot))) return;
    if (awaitingVersion !== null) {
      if ((snapshot.proposal?.version ?? 0) < awaitingVersion) return;
      awaitingVersion = null;
      if (awaitTimer) clearTimeout(awaitTimer);
      awaitTimer = null;
      adopt(snapshot);
      set({ busy: false });
      return;
    }
    if (state.busy) {
      held = snapshot;
      return;
    }
    if (inFlight !== null && shown(snapshot) === inFlight) return;
    if (
      (!state.dirty && !state.saving && state.conflict === null) ||
      shown(snapshot) === state.draft
    )
      return adopt(snapshot);
    set({ conflict: snapshot, missing: false, error: null });
  };

  const receiveError = (message: string | null) => {
    if (message === null) {
      if (state.missing || state.error) set({ missing: false, error: null });
      return;
    }
    if (isMissingError(message)) {
      if (timer) clearTimeout(timer);
      timer = null;
      set({
        missing: true,
        error: /unknown vault/i.test(message) ? message : null,
      });
    } else set({ error: message });
  };

  const save = async (drain: boolean) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!writer || !state.loaded || state.busy) return;
    set({ saving: true });
    try {
      while (
        state.dirty &&
        state.base !== null &&
        state.conflict === null &&
        !state.missing
      ) {
        const base = state.base;
        const content = state.draft;
        inFlight = content;
        const pending =
          options.showsProposals && base.proposal?.status === "pending"
            ? base.proposal
            : null;
        try {
          if (pending && writer.updateProposal) {
            const proposal = await writer.updateProposal(
              state.path,
              content,
              pending.version,
            );
            const next = { ...base, proposal };
            replaceBase(next);
            set({ base: next, error: null });
            if (!drain && state.dirty) {
              schedule();
              return;
            }
          } else {
            const result = await writer.save(
              state.path,
              content,
              base.sha256,
              writer.renamesToTitle,
            );
            const next = {
              ...base,
              content,
              sha256: result.sha256,
              previewPath: result.path,
            };
            replaceBase(next);
            const from = state.path;
            set({ base: next, path: result.path, error: null });
            if (result.path !== from) options.onRename?.(from, result.path);
            if (!drain && state.dirty) {
              schedule();
              return;
            }
          }
        } catch (error) {
          if (state.base !== base) continue;
          if (state.conflict !== null) return;
          set({
            error: error instanceof Error ? error.message : String(error),
          });
          void writer.refetch();
          return;
        }
      }
    } finally {
      inFlight = null;
      set({ saving: false });
    }
  };

  const flush = (drain = true): Promise<void> => {
    if (saving)
      return drain
        ? saving.then(() => (state.dirty ? flush(true) : undefined))
        : saving;
    saving = save(drain).finally(() => {
      saving = null;
    });
    return saving;
  };

  return {
    id: `document-${(nextSessionId += 1)}`,
    getSnapshot: () => state,
    hasSubscribers: () => listeners.size > 0,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect(next: DocumentWriter) {
      writer = next;
    },
    receive,
    receiveError,
    flush,
    edit(draft: string) {
      if (state.busy || state.missing || draft === state.draft) return;
      set({ draft });
      if (state.conflict === null) schedule();
    },
    keepMine() {
      const theirs = state.conflict;
      if (!theirs) return;
      replaceBase(theirs);
      set({ base: theirs, conflict: null });
      return flush();
    },
    useTheirs() {
      const theirs = state.conflict;
      if (theirs) adopt(theirs);
    },
    retry() {
      set({ error: null });
      void writer?.refetch();
      return flush();
    },
    async resolve(action: ProposalAction) {
      if (state.busy || !writer?.resolveProposal) return;
      await flush();
      const proposal = state.base?.proposal;
      if (!proposal || state.conflict || state.dirty) return;
      set({ busy: true, error: null });
      try {
        const result = await writer.resolveProposal(
          state.path,
          action,
          proposal.version,
        );
        awaitingVersion = result.version;
        if (held && (held.proposal?.version ?? 0) >= result.version) {
          const latest = held;
          held = null;
          receive(latest);
          return;
        }
        awaitTimer = setTimeout(() => {
          awaitTimer = null;
          void writer?.refetch();
        }, RESOLVE_TIMEOUT_MS);
      } catch (error) {
        set({
          busy: false,
          error: error instanceof Error ? error.message : String(error),
        });
        const latest = held;
        held = null;
        if (latest) receive(latest);
      }
    },
  };
}

export type DocumentSession = ReturnType<typeof createDocumentSession>;

const sessions = new Map<string, DocumentSession>();
const renamedFrom = new Map<
  string,
  { session: DocumentSession; until: number }
>();
const MAX_IDLE_SESSIONS = 20;
const RENAME_ALIAS_MS = 10_000;

export function documentSession(
  key: (path: string) => string,
  path: string,
  options: { showsProposals: boolean; delay: number },
): DocumentSession {
  const existing = sessions.get(key(path));
  if (existing) {
    for (const [alias, entry] of renamedFrom)
      if (entry.session === existing) renamedFrom.delete(alias);
    sessions.delete(key(path));
    sessions.set(key(path), existing);
    return existing;
  }
  const alias = renamedFrom.get(key(path));
  if (alias && alias.until > Date.now()) return alias.session;
  renamedFrom.delete(key(path));
  const session = createDocumentSession({
    ...options,
    path,
    onRename(from, to) {
      if (sessions.get(key(from)) === session) sessions.delete(key(from));
      sessions.set(key(to), session);
      renamedFrom.set(key(from), {
        session,
        until: Date.now() + RENAME_ALIAS_MS,
      });
    },
  });
  sessions.set(key(path), session);
  for (const [cachedKey, cached] of sessions) {
    if (sessions.size <= MAX_IDLE_SESSIONS) break;
    const cachedState = cached.getSnapshot();
    if (
      cached !== session &&
      !cached.hasSubscribers() &&
      !cachedState.dirty &&
      !cachedState.saving
    )
      sessions.delete(cachedKey);
  }
  return session;
}

export function useDocumentSession(
  session: DocumentSession,
  sources: {
    snapshot: DocumentSnapshot | undefined;
    error: string | null;
    writer: DocumentWriter;
  },
): DocumentState {
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  session.connect(sources.writer);
  const { snapshot, error } = sources;
  useEffect(() => {
    if (snapshot) session.receive(snapshot);
  }, [session, snapshot]);
  useEffect(() => {
    session.receiveError(error);
  }, [session, error]);
  useEffect(
    () => () => {
      void session.flush();
    },
    [session],
  );
  return state;
}
