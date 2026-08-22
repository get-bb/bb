import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ComposerView, PluginComposerScope } from "@get-bb/plugin-sdk";
import { isComposerDraftEmpty } from "@get-bb/plugin-sdk/internal/composer-view";
import type { PromptDraftState } from "@bb/client-core";

/**
 * Binds plugin composer hooks to the exact composer owned by a pane. This is
 * authoritative even when the route points at another split pane and also
 * carries host-only state such as root-project selection or an inline queued
 * message editor.
 *
 * A host must stay referentially stable while the user types: it is published
 * to the pane scope (and provided via context) where large non-draft
 * subscribers such as the secondary-panel layout hold it, so a per-keystroke
 * identity would re-render the whole thread shell per character. The live
 * draft is therefore exposed as `getCurrent` + `subscribeDraft` instead of a
 * value field; draft consumers read it via `usePluginComposerHostDraft`.
 */
export interface PluginComposerHost {
  scope: PluginComposerScope;
  textEffectKey: string;
  getCurrent(): PromptDraftState;
  /**
   * Subscribes to changes of `getCurrent()`'s committed result. Returns an
   * unsubscribe function. Must be identity-stable for the host's lifetime.
   */
  subscribeDraft(listener: () => void): () => void;
  setDraft(next: PromptDraftState): void;
  focus(): void;
}

export function composerScopeIdentity(scope: PluginComposerScope): string {
  switch (scope.kind) {
    case "thread":
      return `thread/${scope.threadId}`;
    case "queued-message":
      return `queued-message/${scope.threadId}/${scope.queuedMessageId}`;
    case "side-chat":
      return `side-chat/${scope.projectId}/${scope.parentThreadId}/${scope.tabId}/${scope.childThreadId ?? "draft"}`;
    case "new-thread":
      return `new-thread/${scope.projectId ?? "unresolved"}`;
  }
}

const subscribeToNoDraft = () => () => {};
const getNoDraft = () => null;

/**
 * The live draft of a composer host. This is the only reactive read of a
 * host's draft: the host object itself stays identity-stable across
 * keystrokes, so components that hold a host without calling this hook do not
 * re-render while the user types.
 */
export function usePluginComposerHostDraft(
  host: PluginComposerHost | null,
): PromptDraftState | null {
  const subscribe = host?.subscribeDraft ?? subscribeToNoDraft;
  const getSnapshot = host?.getCurrent ?? getNoDraft;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * `subscribeDraft` for hosts whose draft lives in React state (the inline
 * queued-message and sent-message editors) rather than in the prompt-draft
 * store. Returns a stable subscribe function; listeners fire in a layout
 * effect after a render committed a different `draft` identity, by which point
 * the host's ref-backed `getCurrent` already returns the new value (edit
 * commits write their ref synchronously, `useLatestRef` writes during render).
 * Pass null while the corresponding editor is closed.
 */
export function useComposerHostDraftNotifier(
  draft: PromptDraftState | null,
): (listener: () => void) => () => void {
  const [store] = useState(() => {
    const listeners = new Set<() => void>();
    return {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      notify: () => {
        for (const listener of [...listeners]) listener();
      },
    };
  });
  const previousDraftRef = useRef(draft);
  useLayoutEffect(() => {
    if (previousDraftRef.current === draft) return;
    previousDraftRef.current = draft;
    store.notify();
  }, [draft, store]);
  return store.subscribe;
}

interface PluginComposerViewModelInput {
  scope: PluginComposerScope;
  layout: ComposerView["layout"];
  text: string;
  attachmentCount: number;
  isRunning: boolean;
  isSubmitting: boolean;
}

/** The single model builder shared by concrete composer shells and the editor. */
export function usePluginComposerViewModel({
  scope,
  layout,
  text,
  attachmentCount,
  isRunning,
  isSubmitting,
}: PluginComposerViewModelInput): ComposerView {
  return useMemo(
    () => ({
      scope,
      layout,
      draft: {
        text,
        isEmpty: isComposerDraftEmpty(text, attachmentCount),
        attachmentCount,
      },
      run: { isRunning, isSubmitting },
    }),
    [attachmentCount, isRunning, isSubmitting, layout, scope, text],
  );
}

const PluginComposerHostContext = createContext<
  PluginComposerHost | null | undefined
>(undefined);

/** Reactive composer state supplied by the concrete prompt-box host. */
export const PluginComposerViewContext = createContext<
  ComposerView | undefined
>(undefined);

export function PluginComposerViewProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ComposerView;
}) {
  return (
    <PluginComposerViewContext.Provider value={value}>
      {children}
    </PluginComposerViewContext.Provider>
  );
}

export function useOptionalPluginComposerView(): ComposerView | undefined {
  return useContext(PluginComposerViewContext);
}

interface PluginComposerHostStore {
  getSnapshot(): PluginComposerHost | null;
  subscribe(listener: () => void): () => void;
  publish(owner: symbol, host: PluginComposerHost | null): void;
  clear(owner: symbol): void;
}

function createPluginComposerHostStore(): PluginComposerHostStore {
  let current: { owner: symbol; host: PluginComposerHost | null } | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    getSnapshot: () => current?.host ?? null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish: (owner, host) => {
      if (current?.owner === owner && current.host === host) return;
      current = { owner, host };
      notify();
    },
    clear: (owner) => {
      if (current?.owner !== owner) return;
      current = null;
      notify();
    },
  };
}

const PluginComposerHostStoreContext =
  createContext<PluginComposerHostStore | null>(null);
const subscribeToNoHost = () => () => {};
const getNoHost = () => null;

export function PluginComposerHostProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: PluginComposerHost | null;
}) {
  return (
    <PluginComposerHostContext.Provider value={value}>
      {children}
    </PluginComposerHostContext.Provider>
  );
}

/**
 * Shares an active composer host with sibling plugin surfaces in one compose
 * pane without forcing the pane owner to lift the transient draft state.
 */
export function PluginComposerHostScopeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [store] = useState(createPluginComposerHostStore);
  return (
    <PluginComposerHostStoreContext.Provider value={store}>
      {children}
    </PluginComposerHostStoreContext.Provider>
  );
}

/** Publishes a nested composer's current host to its enclosing pane scope. */
export function usePublishPluginComposerHost(
  host: PluginComposerHost | null,
): void {
  const store = useContext(PluginComposerHostStoreContext);
  const [owner] = useState(() => Symbol("plugin-composer-host"));

  useLayoutEffect(() => {
    store?.publish(owner, host);
  }, [host, owner, store]);

  useEffect(
    () => () => {
      store?.clear(owner);
    },
    [owner, store],
  );
}

export function usePluginComposerHost(): PluginComposerHost | null {
  const directHost = useContext(PluginComposerHostContext);
  const store = useContext(PluginComposerHostStoreContext);
  const subscribe = useCallback(
    (listener: () => void) => store?.subscribe(listener) ?? subscribeToNoHost(),
    [store],
  );
  const getSnapshot = useCallback(
    () => store?.getSnapshot() ?? getNoHost(),
    [store],
  );
  const publishedHost = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
  return directHost !== undefined ? directHost : publishedHost;
}
