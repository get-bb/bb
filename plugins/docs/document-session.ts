import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { docsRpcContract } from "./server.js";

type Rpc = ReturnType<typeof useRpc<typeof docsRpcContract>>;
type ProposalState = Awaited<ReturnType<typeof readProposal>>;
function readProposal(rpc: Rpc, vaultId: string, path: string) {
  return rpc.call("readProposal", { vaultId, path });
}

type DocumentState = {
  loaded: boolean;
  content: string;
  sha256: string;
  draft: string;
  proposal: ProposalState;
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
  let saving: Promise<void> | null = null;
  let refreshing: Promise<void> | null = null;
  let refreshAgain = false;
  let generation = 0;
  const set = (patch: Partial<DocumentState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const draftFor = (content: string, proposal: ProposalState) =>
    proposal?.status === "pending" ? proposal.content : content;
  const refresh = (): Promise<void> => {
    if (saving || state.busy) {
      refreshAgain = true;
      return saving ?? Promise.resolve();
    }
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    const requestedGeneration = generation;
    const request = Promise.all([
      rpc.call("readNote", { vaultId, path }),
      readProposal(rpc, vaultId, path),
      state.previewBaseUrl
        ? Promise.resolve({ baseUrl: state.previewBaseUrl })
        : rpc.call("preparePreview", { vaultId, path }),
    ])
      .then(([file, proposal, preview]) => {
        if (requestedGeneration !== generation) {
          refreshAgain = true;
          return;
        }
        if (state.dirty) {
          if (
            file.sha256 !== state.sha256 ||
            proposal?.version !== state.proposal?.version
          ) {
            set({
              error:
                "This document changed elsewhere. Your edits are preserved; copy them before reloading.",
            });
          }
          return;
        }
        set({
          loaded: true,
          content: file.content,
          sha256: file.sha256,
          proposal,
          draft: draftFor(file.content, proposal),
          previewBaseUrl: preview.baseUrl,
          error: null,
        });
      })
      .catch((error: unknown) =>
        set({ error: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => {
        refreshing = null;
        if (refreshAgain) {
          refreshAgain = false;
          void refresh();
        }
      });
    refreshing = request;
    return request;
  };
  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (saving) return saving;
    if (!state.loaded || !state.dirty) return Promise.resolve();
    generation++;
    set({ saving: true, error: null });
    const request = (async () => {
      while (state.dirty) {
        const draft = state.draft;
        if (state.proposal?.status === "pending") {
          const proposal = await rpc.call("updateProposal", {
            vaultId,
            path,
            content: draft,
            expectedVersion: state.proposal.version,
          });
          set({ proposal, dirty: state.draft !== draft });
        } else {
          const result = await rpc.call("saveNote", {
            vaultId,
            path,
            content: draft,
            expectedSha256: state.sha256,
          });
          if (result.outcome === "conflict")
            throw new Error(
              "This document changed elsewhere. Your edits are preserved; copy them before reloading.",
            );
          set({
            content: draft,
            sha256: result.sha256,
            dirty: state.draft !== draft,
          });
        }
      }
    })()
      .catch((error: unknown) => {
        set({ error: error instanceof Error ? error.message : String(error) });
        throw error;
      })
      .finally(() => {
        saving = null;
        set({ saving: false });
        if (refreshAgain && !state.dirty && !state.busy) {
          refreshAgain = false;
          void refresh();
        }
      });
    saving = request;
    return request;
  };
  const edit = (draft: string) => {
    if (state.busy) return;
    generation++;
    set({ draft, dirty: draft !== draftFor(state.content, state.proposal) });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void flush().catch(() => undefined);
    }, 500);
  };
  const resolve = async (action: "accept" | "reject" | "undo" | "redo") => {
    if (state.busy) return;
    generation++;
    set({ busy: true, error: null });
    try {
      await flush();
      if (!state.proposal) return;
      const proposal = await rpc.call("resolveProposal", {
        vaultId,
        path,
        action,
        expectedVersion: state.proposal.version,
      });
      const file = await rpc.call("readNote", { vaultId, path });
      set({
        proposal,
        content: file.content,
        sha256: file.sha256,
        draft: draftFor(file.content, proposal),
        dirty: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: false });
      if (refreshAgain && !state.dirty) {
        refreshAgain = false;
        void refresh();
      }
    }
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
