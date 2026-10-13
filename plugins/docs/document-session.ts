import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { docsRpcContract } from "./server.js";
import { isRecord } from "./markdown-document.js";
import type { Proposal } from "./proposals.js";

type Rpc = ReturnType<typeof useRpc<typeof docsRpcContract>>;
type Document = {
  content: string;
  sha256: string;
  previewBaseUrl: string;
  previewPath: string;
  proposal: Proposal | null;
};
type Action = "accept" | "reject" | "undo" | "redo";
export type DocumentIO = {
  read(previewBaseUrl: string): Promise<Document>;
  write(
    content: string,
    expectedSha256: string | null,
  ): Promise<{ outcome: "written"; sha256: string } | { outcome: "conflict" }>;
  afterSave?(): Promise<void>;
  proposals?: {
    update(content: string, version: number): Promise<Proposal>;
    resolve(
      action: Action,
      version: number,
    ): Promise<Pick<Document, "content" | "sha256" | "proposal">>;
  };
  delay: number;
};
type DocumentState = Document & {
  loaded: boolean;
  initialContent: string;
  draft: string;
  dirty: boolean;
  saving: boolean;
  busy: boolean;
  conflict: boolean;
  error: string | null;
};
class DocumentConflict extends Error {
  constructor() {
    super(
      "This document changed elsewhere. Your edits are preserved; copy them before reloading.",
    );
  }
}

function createSession(io: DocumentIO) {
  let state: DocumentState = {
    loaded: false,
    content: "",
    initialContent: "",
    sha256: "",
    draft: "",
    proposal: null,
    previewBaseUrl: "",
    previewPath: "",
    dirty: false,
    saving: false,
    busy: false,
    conflict: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let operations = Promise.resolve();
  let refreshing: Promise<void> | null = null;
  let saving: Promise<void> | null = null;
  let refreshAgain = false;
  const savedDraft = () =>
    state.proposal?.status === "pending"
      ? state.proposal.content
      : state.content;
  const set = (patch: Partial<DocumentState>) => {
    state = { ...state, ...patch };
    state.dirty = state.draft !== savedDraft();
    for (const listener of listeners) listener();
  };
  const run = (work: () => Promise<void>) => {
    const result = operations.then(work);
    operations = result.catch((error: unknown) => {
      set({
        error: error instanceof Error ? error.message : String(error),
        conflict: error instanceof DocumentConflict,
      });
    });
    return result;
  };
  const refresh = (): Promise<void> => {
    refreshAgain = true;
    if (refreshing) return refreshing;
    refreshing = run(async () => {
      do {
        refreshAgain = false;
        const file = await io.read(state.previewBaseUrl);
        const proposal = file.proposal;
        if (state.busy) continue;
        if (state.dirty) {
          if (
            file.sha256 !== state.sha256 ||
            proposal?.version !== state.proposal?.version
          )
            throw new DocumentConflict();
        } else {
          set({
            ...file,
            loaded: true,
            initialContent: file.content,
            draft:
              proposal?.status === "pending" ? proposal.content : file.content,
            error: null,
            conflict: false,
          });
        }
      } while (refreshAgain);
    })
      .catch(() => undefined)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  };
  const save = async (force = false) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!state.loaded || (!state.dirty && !force)) return;
    set({ saving: true, error: null });
    try {
      while (state.dirty || force) {
        const content = state.draft;
        if (state.proposal?.status === "pending" && io.proposals) {
          const proposal = await io.proposals.update(
            content,
            state.proposal.version,
          );
          set({ proposal });
        } else {
          const result = await io.write(content, force ? null : state.sha256);
          if (result.outcome === "conflict") throw new DocumentConflict();
          set({ content, sha256: result.sha256, conflict: false });
          await io.afterSave?.();
        }
        force = false;
      }
    } finally {
      set({ saving: false });
    }
  };
  const flush = (force = false) => {
    saving ??= run(() => save(force)).finally(() => {
      saving = null;
    });
    return saving;
  };
  const edit = (draft: string) => {
    if (state.busy) return;
    set({ draft });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void flush().catch(() => undefined);
    }, io.delay);
  };
  const resolve = async (action: Action) => {
    if (state.busy) return;
    set({ busy: true, error: null });
    const pendingSave = saving;
    await run(async () => {
      await pendingSave;
      await save();
      if (state.proposal && io.proposals) {
        const file = await io.proposals.resolve(action, state.proposal.version);
        set({
          ...file,
          draft:
            file.proposal?.status === "pending"
              ? file.proposal.content
              : file.content,
        });
      }
    })
      .catch(() => undefined)
      .finally(() => set({ busy: false }));
  };
  return {
    initialize: (content: string) => set({ content, draft: content }),
    reload: async () => {
      if (timer) clearTimeout(timer);
      timer = null;
      await operations;
      set({ draft: savedDraft() });
      return refresh();
    },
    getSnapshot: () => state,
    hasSubscribers: () => listeners.size > 0,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    flush,
    edit,
    resolve,
  };
}

export function createDocumentSession(rpc: Rpc, vaultId: string, path: string) {
  let previewExpiresAt = 0;
  return createSession({
    delay: 500,
    read: async (previewBaseUrl) => {
      const [file, proposal, preview] = await Promise.all([
        rpc.call("readNote", { vaultId, path }),
        rpc.call("readProposal", { vaultId, path }),
        previewBaseUrl && Date.now() < previewExpiresAt
          ? Promise.resolve({ baseUrl: previewBaseUrl })
          : rpc.call("preparePreview", { vaultId, path }).then((preview) => {
              previewExpiresAt = preview.expiresAtMs;
              return preview;
            }),
      ]);
      return {
        content: file.content,
        sha256: file.sha256,
        proposal,
        previewBaseUrl: preview.baseUrl,
        previewPath: path,
      };
    },
    write: (content, expectedSha256) =>
      rpc.call("saveNote", { vaultId, path, content, expectedSha256 }),
    proposals: {
      update: (content, expectedVersion) =>
        rpc.call("updateProposal", { vaultId, path, content, expectedVersion }),
      resolve: async (action, expectedVersion) => {
        const proposal = await rpc.call("resolveProposal", {
          vaultId,
          path,
          action,
          expectedVersion,
        });
        const file = await rpc.call("readNote", { vaultId, path });
        return { content: file.content, sha256: file.sha256, proposal };
      },
    },
  });
}

const sessions = new Map<string, ReturnType<typeof createSession>>();

function useSession(session: ReturnType<typeof createSession>) {
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  useEffect(() => {
    void session.refresh();
    return () => {
      void session.flush().catch(() => undefined);
    };
  }, [session]);
  return { state, session };
}

export function useSavedDocument(io: DocumentIO) {
  return useSession(useMemo(() => createSession(io), [io]));
}

export function useDocumentSession(vaultId: string, path: string) {
  const rpc = useRpc<typeof docsRpcContract>();
  const key = JSON.stringify([vaultId, path]);
  const session =
    sessions.get(key) ?? createDocumentSession(rpc, vaultId, path);
  sessions.delete(key);
  sessions.set(key, session);
  for (const [cachedKey, cachedSession] of sessions) {
    if (sessions.size <= 20) break;
    if (
      cachedKey !== key &&
      !cachedSession.hasSubscribers() &&
      !cachedSession.getSnapshot().dirty
    )
      sessions.delete(cachedKey);
  }
  const result = useSession(session);
  const changed = useCallback(
    (payload: unknown) => {
      if (!isRecord(payload)) return;
      if (typeof payload.vaultId === "string" && payload.vaultId !== vaultId)
        return;
      if (typeof payload.path === "string" && payload.path !== path) return;
      if (payload.proposalOnly === true) return;
      void session.refresh();
    },
    [session, vaultId, path],
  );
  useRealtime("vault-changed", changed);
  useRealtime("proposal-changed", changed);
  return result;
}
