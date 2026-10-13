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
  ComposerSubmitOptions,
  ComposerView,
  JsonValue,
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
  submit?(
    options: ComposerSubmitOptions,
    pluginSubmission: { pluginId: string; data: JsonValue } | undefined,
  ): Promise<void>;
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
  text: string;
  attachmentCount: number;
  isRunning: boolean;
  isSubmitting: boolean;
}

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

export type PluginComposerStaticView = Omit<ComposerView, "draft">;

const PluginComposerStaticViewContext = createContext<
  PluginComposerStaticView | undefined
>(undefined);

const PluginComposerDraftViewContext = createContext<
  ComposerView["draft"] | undefined
>(undefined);

export function PluginComposerViewProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ComposerView;
}) {
  const { isRunning, isSubmitting } = value.run;
  const staticView = useMemo<PluginComposerStaticView>(
    () => ({
      scope: value.scope,
      layout: value.layout,
      run: { isRunning, isSubmitting },
    }),
    [isRunning, isSubmitting, value.layout, value.scope],
  );
  return (
    <PluginComposerStaticViewContext.Provider value={staticView}>
      <PluginComposerDraftViewContext.Provider value={value.draft}>
        {children}
      </PluginComposerDraftViewContext.Provider>
    </PluginComposerStaticViewContext.Provider>
  );
}

export function useOptionalPluginComposerStaticView():
  | PluginComposerStaticView
  | undefined {
  return useContext(PluginComposerStaticViewContext);
}

export function useOptionalPluginComposerView(): ComposerView | undefined {
  const staticView = useContext(PluginComposerStaticViewContext);
  const draft = useContext(PluginComposerDraftViewContext);
  return useMemo(
    () =>
      staticView === undefined || draft === undefined
        ? undefined
        : { ...staticView, draft },
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
