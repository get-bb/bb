import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { docsRpcContract } from "./server.js";
import type { Proposal } from "./proposals.js";

type Rpc = ReturnType<typeof useRpc<typeof docsRpcContract>>;
type DocumentState = {
  loaded: boolean;
  content: string;
  sha256: string;
  draft: string;
  proposal: Proposal | null;
  previewBaseUrl: string;
  dirty: boolean;
  saving: boolean;
  busy: boolean;
  error: string | null;
};

export function createDocumentSession(rpc: Rpc, vaultId: string, path: string) {
  let state: DocumentState = {
    loaded: false,
    content: "",
    sha256: "",
    draft: "",
    proposal: null,
    previewBaseUrl: "",
    dirty: false,
    saving: false,
    busy: false,
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
      set({ error: error instanceof Error ? error.message : String(error) });
    });
    return result;
  };
  const conflict = () =>
    new Error(
      "This document changed elsewhere. Your edits are preserved; copy them before reloading.",
    );
  const load = async (proposal: Proposal | null) => {
    const file = await rpc.call("readNote", { vaultId, path });
    set({
      content: file.content,
      sha256: file.sha256,
      proposal,
      draft: proposal?.status === "pending" ? proposal.content : file.content,
    });
  };
  const refresh = (): Promise<void> => {
    refreshAgain = true;
    if (refreshing) return refreshing;
    refreshing = run(async () => {
      do {
        refreshAgain = false;
        const [file, proposal, preview] = await Promise.all([
          rpc.call("readNote", { vaultId, path }),
          rpc.call("readProposal", { vaultId, path }),
          state.previewBaseUrl
            ? Promise.resolve({ baseUrl: state.previewBaseUrl })
            : rpc.call("preparePreview", { vaultId, path }),
        ]);
        if (state.busy) continue;
        if (state.dirty) {
          if (
            file.sha256 !== state.sha256 ||
            proposal?.version !== state.proposal?.version
          )
            throw conflict();
        } else {
          set({
            loaded: true,
            content: file.content,
            sha256: file.sha256,
            proposal,
            draft:
              proposal?.status === "pending" ? proposal.content : file.content,
            previewBaseUrl: preview.baseUrl,
            error: null,
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
  const save = async () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!state.loaded || !state.dirty) return;
    set({ saving: true, error: null });
    try {
      while (state.dirty) {
        const content = state.draft;
        if (state.proposal?.status === "pending") {
          const proposal = await rpc.call("updateProposal", {
            vaultId,
            path,
            content,
            expectedVersion: state.proposal.version,
          });
          set({ proposal });
        } else {
          const result = await rpc.call("saveNote", {
            vaultId,
            path,
            content,
            expectedSha256: state.sha256,
          });
          if (result.outcome === "conflict") throw conflict();
          set({ content, sha256: result.sha256 });
        }
      }
    } finally {
      set({ saving: false });
    }
  };
  const flush = () => {
    saving ??= run(save).finally(() => {
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
    }, 500);
  };
  const resolve = async (action: "accept" | "reject" | "undo" | "redo") => {
    if (state.busy) return;
    set({ busy: true, error: null });
    const pendingSave = saving;
    await run(async () => {
      await pendingSave;
      await save();
      if (state.proposal)
        await load(
          await rpc.call("resolveProposal", {
            vaultId,
            path,
            action,
            expectedVersion: state.proposal.version,
          }),
        );
    })
      .catch(() => undefined)
      .finally(() => set({ busy: false }));
  };
  return {
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

const sessions = new Map<string, ReturnType<typeof createDocumentSession>>();

export function useDocumentSession(vaultId: string, path: string) {
  const rpc = useRpc<typeof docsRpcContract>();
  const key = JSON.stringify([vaultId, path]);
  const session =
    sessions.get(key) ?? createDocumentSession(rpc, vaultId, path);
  sessions.set(key, session);
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  useEffect(() => {
    void session.refresh();
    return () => {
      void session
        .flush()
        .catch(() => undefined)
        .finally(() => {
          if (
            !session.hasSubscribers() &&
            !session.getSnapshot().dirty &&
            sessions.get(key) === session
          )
            sessions.delete(key);
        });
    };
  }, [session, key]);
  const changed = useCallback(() => {
    void session.refresh();
  }, [session]);
  useRealtime("vault-changed", changed);
  useRealtime("proposal-changed", changed);
  return { state, session };
}
