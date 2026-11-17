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
import type {
  ComposerSelection,
  ComposerView,
  PluginComposerScope,
} from "@get-bb/plugin-sdk";
import { isComposerDraftEmpty } from "@get-bb/plugin-sdk/internal/composer-view";
import type { PromptDraftState } from "@bb/client-core";

export interface PluginComposerHost {
  scope: PluginComposerScope;
  textEffectKey: string;
  getCurrent(): PromptDraftState;
  subscribeDraft(listener: () => void): () => void;
  getSelection?(): ComposerSelection;
  subscribeSelection?(listener: () => void): () => void;
  setDraft(next: PromptDraftState): void;
  isAvailable?(): boolean;
  focus(): void;
  sendsOnEnter?: boolean;
  setSelection?(selection: ComposerSelection): Promise<ComposerSelection>;
}

export function composerScopeIdentity(scope: PluginComposerScope): string {
  switch (scope.kind) {
    case "thread":
      return `thread/${scope.threadId}`;
    case "queued-message":
      return `queued-message/${scope.threadId}/${scope.queuedMessageId}`;
    case "new-thread":
      return `new-thread/${scope.projectId ?? "unresolved"}`;
  }
}

export type ComposerDraftStore = Pick<
  PluginComposerHost,
  "getCurrent" | "subscribeDraft" | "setDraft"
>;

export type ComposerDraftSource = Pick<
  PluginComposerHost,
  "getCurrent" | "subscribeDraft"
>;

export function createComposerDraftStore(
  initial: PromptDraftState,
): ComposerDraftStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    getCurrent: () => current,
    subscribeDraft: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setDraft: (next) => {
      if (next === current) return;
      current = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

function cachedDraftSelection<T>(
  source: ComposerDraftSource,
  select: (draft: PromptDraftState) => T,
): () => T {
  let cache: { draft: PromptDraftState; value: T } | null = null;
  return () => {
    const draft = source.getCurrent();
    if (cache?.draft !== draft) cache = { draft, value: select(draft) };
    return cache.value;
  };
}

export function useComposerDraftSelector<T>(
  source: ComposerDraftSource,
  select: (draft: PromptDraftState) => T,
): T {
  const getSnapshot = useMemo(
    () => cachedDraftSelection(source, select),
    [select, source],
  );
  return useSyncExternalStore(source.subscribeDraft, getSnapshot, getSnapshot);
}

const subscribeToNoDraft = () => () => {};
const getNoDraft = () => null;

export function usePluginComposerHostDraft(
  host: PluginComposerHost | null,
): PromptDraftState | null {
  const subscribe = host?.subscribeDraft ?? subscribeToNoDraft;
  const getSnapshot = host?.getCurrent ?? getNoDraft;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

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

function createComposerSelectionStore(key: string, initial: ComposerSelection) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    key,
    getSelection: () => current,
    subscribeSelection: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish: (next: ComposerSelection) => {
      if (current === next) return;
      current = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

export function useComposerHostSelection(
  key: string,
  selection: ComposerSelection,
): Required<Pick<PluginComposerHost, "getSelection" | "subscribeSelection">> {
  const [binding, setBinding] = useState(() =>
    createComposerSelectionStore(key, selection),
  );
  let store = binding;
  if (binding.key !== key) {
    store = createComposerSelectionStore(key, selection);
    setBinding(store);
  }
  useLayoutEffect(() => {
    store.publish(selection);
  }, [selection, store]);
  return store;
}

interface PluginComposerViewModelInput {
  scope: PluginComposerScope;
  layout: ComposerView["layout"];
  isRunning: boolean;
  isSubmitting: boolean;
}

export type PluginComposerStaticView = Omit<ComposerView, "draft">;

export function usePluginComposerStaticViewModel({
  scope,
  layout,
  isRunning,
  isSubmitting,
}: PluginComposerViewModelInput): PluginComposerStaticView {
  return useMemo(
    () => ({ scope, layout, run: { isRunning, isSubmitting } }),
    [isRunning, isSubmitting, layout, scope],
  );
}

export function composerViewDraft(
  draft: PromptDraftState,
): ComposerView["draft"] {
  return {
    text: draft.text,
    isEmpty: isComposerDraftEmpty(draft.text, draft.attachments.length),
    attachmentCount: draft.attachments.length,
  };
}

const PluginComposerHostContext = createContext<
  PluginComposerHost | null | undefined
>(undefined);

interface PluginComposerViewSource {
  view: PluginComposerStaticView;
  draft: ComposerDraftSource;
}

const PluginComposerViewContext = createContext<
  PluginComposerViewSource | undefined
>(undefined);

export function PluginComposerViewProvider({
  children,
  draft,
  view,
}: {
  children: ReactNode;
  draft: ComposerDraftSource;
  view: PluginComposerStaticView;
}) {
  const source = useMemo(() => ({ view, draft }), [draft, view]);
  return (
    <PluginComposerViewContext.Provider value={source}>
      {children}
    </PluginComposerViewContext.Provider>
  );
}

export function useOptionalPluginComposerStaticView():
  | PluginComposerStaticView
  | undefined {
  return useContext(PluginComposerViewContext)?.view;
}

const EMPTY_VIEW_DRAFT: PromptDraftState = {
  text: "",
  mentions: [],
  attachments: [],
};
const NO_DRAFT_SOURCE: ComposerDraftSource = {
  getCurrent: () => EMPTY_VIEW_DRAFT,
  subscribeDraft: () => () => {},
};

export function useOptionalPluginComposerView(): ComposerView | undefined {
  const source = useContext(PluginComposerViewContext);
  const draft = useComposerDraftSelector(
    source?.draft ?? NO_DRAFT_SOURCE,
    composerViewDraft,
  );
  const staticView = source?.view;
  return useMemo(
    () => (staticView === undefined ? undefined : { ...staticView, draft }),
    [draft, staticView],
  );
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
