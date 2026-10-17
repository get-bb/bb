import { useEffect, useMemo, useSyncExternalStore, useState } from "react";
import { experimental_useRpcQuery, useRpc } from "@get-bb/plugin-sdk/app";
import type { docsRpcContract } from "./server.js";
import { useDocsRpc } from "./rpc.js";
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
  afterSave?(content: string): Promise<void>;
  proposals?: {
    update(content: string, version: number): Promise<Proposal>;
    resolve(
      action: Action,
      version: number,
    ): Promise<Pick<Document, "content" | "sha256" | "proposal">>;
  };
  liveRead?: { vaultId: string; path: string };
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
  const receiveError = (error: Error) => set({ error: error.message });
  const receive = (file: Document) => {
    const proposal = file.proposal;
    if (state.saving || state.busy) return;
    set({ previewBaseUrl: file.previewBaseUrl, previewPath: file.previewPath });
    if (state.dirty) {
      if (
        file.sha256 !== state.sha256 ||
        proposal?.version !== state.proposal?.version
      ) {
        set({ error: new DocumentConflict().message, conflict: true });
        return;
      }
      set({ error: null, conflict: false });
    } else
      set({
        ...file,
        loaded: true,
        initialContent: state.loaded ? state.initialContent : file.content,
        draft: proposal?.status === "pending" ? proposal.content : file.content,
        error: null,
        conflict: false,
      });
  };
  const refresh = (): Promise<void> => {
    refreshAgain = true;
    if (refreshing) return refreshing;
    refreshing = run(async () => {
      do {
        refreshAgain = false;
        receive(await io.read(state.previewBaseUrl));
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
          await io.afterSave?.(content);
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
    receive,
    receiveError,
    discard: () => set({ draft: savedDraft() }),
    setPreview: (previewBaseUrl: string) => set({ previewBaseUrl }),
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

export function createDocumentSession(
  rpc: Rpc,
  vaultId: string,
  path: string,
  writes?: ReturnType<typeof useDocsRpc>,
) {
  return createSession({
    delay: 500,
    read: async () => {
      const file = await rpc.call("readDocument", { vaultId, path });
      return {
        content: file.content,
        sha256: file.sha256,
        proposal: file.proposal,
        previewBaseUrl: file.preview.baseUrl,
        previewPath: path,
      };
    },
    write: (content, expectedSha256) =>
      (writes?.saveNote ?? ((input) => rpc.call("saveNote", input)))({
        vaultId,
        path,
        content,
        expectedSha256,
      }),
    proposals: {
      update: (content, expectedVersion) =>
        (
          writes?.updateProposal ??
          ((input) => rpc.call("updateProposal", input))
        )({ vaultId, path, content, expectedVersion }),
      resolve: async (action, expectedVersion) => {
        const proposal = await (
          writes?.resolveProposal ??
          ((input) => rpc.call("resolveProposal", input))
        )({
          vaultId,
          path,
          action,
          expectedVersion,
        });
        const file = await rpc.call("readDocument", { vaultId, path });
        return { content: file.content, sha256: file.sha256, proposal };
      },
    },
  });
}

const sessions = new Map<string, ReturnType<typeof createSession>>();

function useSession(session: ReturnType<typeof createSession>, live = false) {
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  useEffect(() => {
    if (!live) void session.refresh();
    return () => {
      void session.flush().catch(() => undefined);
    };
  }, [session, live]);
  return { state, session };
}

function useLeaseUrl(
  lease: { baseUrl: string; expiresAtMs: number } | undefined,
) {
  const [now, setNow] = useState(Date.now);
  const expires = lease?.expiresAtMs;
  useEffect(() => {
    if (expires === undefined) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, expires - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expires]);
  return lease && lease.expiresAtMs > Math.max(now, Date.now())
    ? lease.baseUrl
    : "";
}

export function usePreviewLease(
  input: { vaultId: string; path: string },
  enabled = true,
) {
  const query = experimental_useRpcQuery<
    typeof docsRpcContract,
    "preparePreview"
  >({ method: "preparePreview", input, enabled });
  return { ...query, baseUrl: useLeaseUrl(query.data) };
}

function useLiveSession(
  session: ReturnType<typeof createSession>,
  input: { vaultId: string; path: string } | undefined,
  proposals: boolean,
) {
  const result = useSession(session, input !== undefined);
  const query = experimental_useRpcQuery<
    typeof docsRpcContract,
    "readDocument"
  >({
    method: "readDocument",
    input: input ?? { vaultId: "", path: "" },
    enabled: input !== undefined,
  });
  const previewBaseUrl = useLeaseUrl(query.data?.preview);
  const refetch = query.refetch;
  useEffect(() => {
    if (input !== undefined && query.data !== undefined) void refetch();
    // oxlint-disable-next-line react/exhaustive-deps
  }, [session, refetch]);
  useEffect(() => {
    if (input === undefined) return;
    session.setPreview(previewBaseUrl);
    const error = query.error;
    if (error) session.receiveError(error);
    else if (
      !query.isFetching &&
      query.data &&
      !result.state.saving &&
      !result.state.busy
    ) {
      session.receive({
        content: query.data.content,
        sha256: query.data.sha256,
        proposal: proposals ? query.data.proposal : null,
        previewBaseUrl,
        previewPath: input.path,
      });
    }
  }, [
    session,
    input,
    query.data,
    query.error,
    query.isFetching,
    previewBaseUrl,
    proposals,
    result.state.saving,
    result.state.busy,
  ]);
  const refresh = async () => {
    await query.refetch();
  };
  return input === undefined
    ? result
    : {
        ...result,
        session: {
          ...session,
          refresh,
          reload: async () => {
            session.discard();
            await refresh();
          },
        },
      };
}

export function useSavedDocument(io: DocumentIO) {
  const session = useMemo(() => createSession(io), [io]);
  return useLiveSession(session, io.liveRead, false);
}

export function useDocumentSession(vaultId: string, path: string) {
  const rpc = useDocsRpc();
  const key = JSON.stringify([vaultId, path]);
  const session =
    sessions.get(key) ?? createDocumentSession(rpc, vaultId, path, rpc);
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
  const input = useMemo(() => ({ vaultId, path }), [vaultId, path]);
  return useLiveSession(session, input, true);
}
