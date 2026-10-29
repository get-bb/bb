import { experimental_PluginRpcCallError } from "@get-bb/plugin-sdk";
import {
  createRpcQueryHooks,
  type RpcQueryHost,
} from "@get-bb/plugin-sdk/internal/rpc-query-host";
import { subscribeComposerSubmitted } from "./composer-submissions";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  BbContext,
  ComposerView,
  PluginComposerApi,
  PluginComposerScope,
  PluginComposerTextEffect,
  PluginRealtimeConnectionState,
  PluginRpcContract,
  PluginRpcClient,
  PluginEnvironmentProvider,
  PluginEnvironmentProvidersState,
  PluginProvidersState,
  PluginSettingsState,
  ExperimentalPanelController,
  ExperimentalFixedTabTargetState,
  ExperimentalPluginFixedTabReference,
  JsonValue,
} from "@get-bb/plugin-sdk";
import {
  PluginContext,
  PluginSlotOwnershipContext,
  usePluginId,
} from "@/components/plugin/plugin-context";
import {
  composerScopeIdentity,
  useOptionalPluginComposerView,
  usePluginComposerHost,
  type PluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import {
  getComposerEditorBridges,
  subscribeComposerEditorBridges,
  useComposerEditorBridge,
} from "@/lib/composer-editor-registry";
import { createComposerHandleBinding } from "@get-bb/plugin-sdk/internal/composer-handle";
import {
  composerHandleController,
  listedComposerHandles,
  type ComposerSource,
} from "@/lib/plugin-composer-handle";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { useSystemEnvironmentProviders } from "@/hooks/queries/environment-provider-queries";
import { requestComposerFocus } from "@/lib/composer-focus-requests";
import { setComposerTextEffect } from "@/lib/composer-text-effects";
import { createKeyedListeners } from "@/lib/keyed-listeners";
import {
  usePromptDraftController,
  usePromptDraftSnapshot,
  type PromptDraftController,
  type PromptDraftScope,
} from "@/hooks/usePromptDraftStorage";
import { emptyPromptDraftState, isPromptDraftEmpty } from "@bb/client-core";
import { useRouteState } from "@/hooks/useRouteState";
import { useServerConnectionState } from "@/hooks/useServerConnectionState";
import { wsManager } from "@/lib/ws";
import { pluginSdkSettingsQueryKey } from "@/hooks/queries/query-keys";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import {
  createPluginPanelController,
  withRetiredAppPanelMembers,
} from "@/lib/plugin-panel-controller";
import {
  getThreadFixedTabOwnerId,
  getPluginFixedTabOwnerId,
  useAppFixedTabTarget,
} from "@/lib/app-fixed-tab-navigation";
export {
  isAutomationEditRoutePath,
  useSdk,
  useBbNavigate,
  usePluginCanOpenFileExternally,
} from "./plugin-navigation-hooks";
type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

const subscribeToNoComposerSelection = () => () => {};
const getNoComposerSelection = () => null;

function serializePluginRpcInput(value: unknown): string {
  const ancestors = new Set<object>();
  function assertJson(current: unknown, path: string): void {
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new Error(`rpc input at ${path} contains a non-finite number`);
      }
      return;
    }
    if (typeof current !== "object") {
      throw new Error(`rpc input at ${path} is not a JSON value`);
    }
    if (ancestors.has(current)) {
      throw new Error(`rpc input at ${path} is cyclic`);
    }
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        current.forEach((item, index) => assertJson(item, `${path}[${index}]`));
        return;
      }
      const prototype = Object.getPrototypeOf(current) as object | null;
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(`rpc input at ${path} must be a plain JSON object`);
      }
      for (const key of Reflect.ownKeys(current)) {
        if (typeof key === "symbol") {
          throw new Error(`rpc input at ${path} contains a symbol key`);
        }
      }
      for (const [key, child] of Object.entries(current)) {
        assertJson(child, `${path}.${key}`);
      }
    } finally {
      ancestors.delete(current);
    }
  }
  assertJson(value, "$input");
  return JSON.stringify(value);
}

export async function callPluginRpc(
  fetchImpl: FetchLike,
  pluginId: string,
  method: string,
  input?: unknown,
): Promise<unknown> {
  try {
    let serializedInput: string;
    try {
      serializedInput = serializePluginRpcInput(input ?? null);
    } catch (error) {
      throw experimental_PluginRpcCallError.from(error, "invalid_input");
    }
    const response = await fetchImpl(
      `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/${encodeURIComponent(method)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: serializedInput,
      },
    );
    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
      result?: unknown;
      error?: unknown;
    } | null;
    if (!response.ok || body?.ok !== true) {
      const structured =
        typeof body?.error === "object" && body.error !== null
          ? body.error
          : null;
      const message =
        structured !== null &&
        typeof Reflect.get(structured, "message") === "string"
          ? String(Reflect.get(structured, "message"))
          : typeof body?.error === "string"
            ? body.error
            : `rpc "${method}" failed (HTTP ${response.status})`;
      const error = new Error(message);
      Reflect.set(error, "status", response.status);
      if (structured !== null) {
        const code = Reflect.get(structured, "code");
        const issues = Reflect.get(structured, "issues");
        if (typeof code === "string") Reflect.set(error, "code", code);
        if (Array.isArray(issues)) Reflect.set(error, "issues", issues);
      }
      throw experimental_PluginRpcCallError.from(
        error,
        response.ok ? "invalid_response" : "handler_error",
      );
    }
    return body.result;
  } catch (error) {
    throw experimental_PluginRpcCallError.from(error);
  }
}

export async function fetchPluginSdkSettings(
  fetchImpl: FetchLike,
  pluginId: string,
): Promise<Record<string, string | number | boolean> | null> {
  const response = await fetchImpl(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/settings`,
  );
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    ok?: unknown;
    values?: unknown;
  } | null;
  if (
    body?.ok !== true ||
    typeof body.values !== "object" ||
    body.values === null
  ) {
    return null;
  }
  const values: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(body.values)) {
    if (
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value)) ||
      typeof value === "boolean"
    ) {
      values[key] = value;
    }
  }
  return values;
}

export function useRpc<
  Contract extends PluginRpcContract = PluginRpcContract,
>(): PluginRpcClient<Contract> {
  const pluginId = usePluginId();
  const client = useMemo(
    () => ({
      call: (method: string, input?: unknown) =>
        callPluginRpc(fetch, pluginId, method, input),
    }),
    [pluginId],
  );
  return client as PluginRpcClient<Contract>;
}

export function useRealtime(
  channel: string,
  handler: (payload: unknown) => void,
): void {
  const pluginId = usePluginId();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  useEffect(
    () =>
      wsManager.onPluginSignal((signal) => {
        if (signal.pluginId !== pluginId || signal.channel !== channel) return;
        handlerRef.current(signal.payload);
      }),
    [pluginId, channel],
  );
}

export function useRealtimeConnectionState(): PluginRealtimeConnectionState {
  return useServerConnectionState();
}

export function useSettings(): PluginSettingsState {
  const pluginId = usePluginId();
  const query = useQuery({
    queryKey: pluginSdkSettingsQueryKey(pluginId),
    queryFn: () => fetchPluginSdkSettings(fetch, pluginId),
    staleTime: 30_000,
  });
  return {
    values: query.data ?? undefined,
    isLoading: query.isLoading,
  };
}

const EMPTY_PROVIDERS: readonly never[] = [];

export function useProviders(): PluginProvidersState {
  const query = useSystemProviders();
  const providers = query.data;
  return useMemo<PluginProvidersState>(
    () =>
      providers === undefined
        ? {
            status: query.isError ? "error" : "loading",
            providers: EMPTY_PROVIDERS,
          }
        : { status: "ready", providers },
    [providers, query.isError],
  );
}

const EMPTY_ENVIRONMENT_PROVIDERS: readonly PluginEnvironmentProvider[] = [];

export function useEnvironmentProviders(): PluginEnvironmentProvidersState {
  const { providers } = useSystemEnvironmentProviders();
  return useMemo<PluginEnvironmentProvidersState>(
    () =>
      providers === undefined
        ? { status: "loading", providers: EMPTY_ENVIRONMENT_PROVIDERS }
        : {
            status: "ready",
            providers: providers.map((provider) => ({
              id: provider.id,
              displayName: provider.displayName,
              description: provider.description,
              icon: provider.icon,
              logoUrl: provider.logoUrl,
              pluginId: provider.pluginId,
              machineProviderId: provider.machineProviderId,
            })),
          },
    [providers],
  );
}

export function useBbContext(): BbContext {
  const { projectId, threadId } = useRouteState();
  return useMemo(
    () => ({ projectId: projectId ?? null, threadId: threadId ?? null }),
    [projectId, threadId],
  );
}

function useExperimentalAppPanel(): ExperimentalPanelController {
  const pluginId = usePluginId();
  const { panel } = useAppNavigationHost();
  return useMemo(
    () =>
      withRetiredAppPanelMembers(
        createPluginPanelController(pluginId, () => panel),
      ),
    [panel, pluginId],
  );
}

function useExperimentalFixedTabTarget<Target extends JsonValue>(
  tab:
    | import("@get-bb/plugin-sdk").ExperimentalTabTargetReference<Target>
    | ExperimentalPluginFixedTabReference<Target>,
): ExperimentalFixedTabTargetState<Target> | null {
  const pluginId = usePluginId();
  const state = useAppFixedTabTarget(
    !("context" in tab)
      ? getPluginFixedTabOwnerId(pluginId, tab.panelId)
      : tab.context.kind === "thread"
        ? getThreadFixedTabOwnerId(pluginId)
        : getPluginFixedTabOwnerId(pluginId, tab.context.panelId),
    tab.id,
  );
  if (state === null || tab.experimental_target === undefined) return null;
  try {
    if (!tab.experimental_target.validate(state.target)) return null;
  } catch {
    return null;
  }
  return {
    clear: state.clear,
    sequence: state.sequence,
    target: state.target,
  };
}

export {
  useExperimentalAppPanel as experimental_useAppPanel,
  useExperimentalFixedTabTarget as experimental_useFixedTabTarget,
};

function createComposerScopeOwnership(scopeKey: string) {
  let active = true;
  return {
    scopeKey,
    activate() {
      active = true;
    },
    invalidate() {
      active = false;
    },
    isActive() {
      return active;
    },
  };
}

let composerVisualOwnerSequence = 0;

type ComposerInputLockListener = () => void;
type ComposerInputLockOwner = string | symbol;

const inputLocksByStorageKey = new Map<
  string,
  Map<ComposerInputLockOwner, string>
>();
const inputLockListeners = createKeyedListeners<string>();

export function getComposerInputLock(storageKey: string | null): boolean {
  if (storageKey === null) return false;
  return (inputLocksByStorageKey.get(storageKey)?.size ?? 0) > 0;
}

function setComposerInputLock(
  storageKey: string | null,
  pluginId: string,
  locked: boolean,
  owner: ComposerInputLockOwner,
): void {
  if (storageKey === null) return;
  const wasLocked = getComposerInputLock(storageKey);
  let owners = inputLocksByStorageKey.get(storageKey);
  if (locked) {
    if (!owners) {
      owners = new Map();
      inputLocksByStorageKey.set(storageKey, owners);
    }
    owners.set(owner, pluginId);
  } else {
    owners?.delete(owner);
    if (owners?.size === 0) inputLocksByStorageKey.delete(storageKey);
  }
  if (getComposerInputLock(storageKey) !== wasLocked) {
    inputLockListeners.notify(storageKey);
  }
}

function subscribeComposerInputLock(
  storageKey: string | null,
  listener: ComposerInputLockListener,
): () => void {
  if (storageKey === null) return () => {};
  return inputLockListeners.subscribe(storageKey, listener);
}

export function useComposerInputLock(storageKey: string | null): boolean {
  const subscribe = useCallback(
    (listener: ComposerInputLockListener) =>
      subscribeComposerInputLock(storageKey, listener),
    [storageKey],
  );
  const getSnapshot = useCallback(
    () => getComposerInputLock(storageKey),
    [storageKey],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

type ComposerDraftSource = Pick<
  PromptDraftController,
  "getCurrent" | "subscribe"
>;

const EMPTY_COMPOSER_DRAFT = emptyPromptDraftState();
const NO_COMPOSER_DRAFT_SOURCE: ComposerDraftSource = {
  getCurrent: () => EMPTY_COMPOSER_DRAFT,
  subscribe: () => () => {},
};

function useComposerDraftSource(
  composerHost: PluginComposerHost | null,
  routeDraft: PromptDraftController,
): ComposerDraftSource {
  const hostGetCurrent = composerHost?.getCurrent;
  const hostSubscribe = composerHost?.subscribeDraft;
  return useMemo(
    () =>
      hostGetCurrent !== undefined && hostSubscribe !== undefined
        ? { getCurrent: hostGetCurrent, subscribe: hostSubscribe }
        : routeDraft,
    [hostGetCurrent, hostSubscribe, routeDraft],
  );
}

export function useComposerView(): ComposerView {
  const providedView = useOptionalPluginComposerView();
  const composerHost = usePluginComposerHost();
  const { projectId, threadId } = useRouteState();
  const routeScope: PromptDraftScope = useMemo(
    () =>
      threadId !== undefined && projectId !== undefined
        ? { kind: "thread", projectId, threadId }
        : { kind: "new-thread" },
    [projectId, threadId],
  );
  const routeDraft = usePromptDraftController(routeScope);
  const draftSource = useComposerDraftSource(composerHost, routeDraft);
  const draft = usePromptDraftSnapshot(
    providedView === undefined ? draftSource : NO_COMPOSER_DRAFT_SOURCE,
  );
  const fallback = useMemo<ComposerView>(
    () => ({
      scope:
        composerHost?.scope ??
        (threadId !== undefined
          ? { kind: "thread", threadId }
          : { kind: "new-thread", projectId: projectId ?? null }),
      layout: "expanded",
      draft: {
        text: draft.text,
        isEmpty: isPromptDraftEmpty(draft),
        attachmentCount: draft.attachments.length,
      },
      run: { isRunning: false, isSubmitting: false },
    }),
    [composerHost?.scope, draft, projectId, threadId],
  );
  return providedView ?? fallback;
}

export function useComposer(): PluginComposerApi {
  const pluginId = usePluginId();
  const slotOwnershipRegistry = useContext(PluginSlotOwnershipContext);
  const composerHost = usePluginComposerHost();
  const tracksDraft = useRef(false);
  const tracksSelection = useRef(false);
  const { projectId, threadId } = useRouteState();
  const routeScope: PromptDraftScope = useMemo(
    () =>
      threadId !== undefined && projectId !== undefined
        ? { kind: "thread", projectId, threadId }
        : { kind: "new-thread" },
    [projectId, threadId],
  );
  const routeDraft = usePromptDraftController(routeScope);
  const draftSource = useComposerDraftSource(composerHost, routeDraft);
  const subscribeToReadDraft = useCallback(
    (onChange: () => void) =>
      draftSource.subscribe(() => {
        if (tracksDraft.current) onChange();
      }),
    [draftSource],
  );
  useSyncExternalStore(
    subscribeToReadDraft,
    draftSource.getCurrent,
    draftSource.getCurrent,
  );
  const subscribeSelection = composerHost?.subscribeSelection;
  const subscribeToReadSelection = useCallback(
    (onChange: () => void) =>
      subscribeSelection === undefined
        ? subscribeToNoComposerSelection()
        : subscribeSelection(() => {
            if (tracksSelection.current) onChange();
          }),
    [subscribeSelection],
  );
  const selectionSnapshot = useCallback(
    () => composerHost?.getSelection?.() ?? null,
    [composerHost],
  );
  useSyncExternalStore(
    subscribeToReadSelection,
    selectionSnapshot,
    getNoComposerSelection,
  );
  const textEffectKey = composerHost?.textEffectKey ?? routeDraft.storageKey;
  useComposerEditorBridge(textEffectKey);

  const composerScope = composerHost?.scope;
  const scope: PluginComposerScope = useMemo(
    () =>
      composerScope ??
      (threadId !== undefined
        ? { kind: "thread", threadId }
        : { kind: "new-thread", projectId: projectId ?? null }),
    [composerScope, projectId, threadId],
  );
  const scopeOwnershipKey = [
    pluginId,
    composerScopeIdentity(scope),
    textEffectKey,
  ].join("\u0000");
  const scopeOwnership = useMemo(
    () => createComposerScopeOwnership(scopeOwnershipKey),
    [scopeOwnershipKey],
  );
  const { visualStateOwner, visualStateOwnerOrder } = useMemo(
    () => ({
      visualStateOwner: Symbol(`${pluginId}:${scopeOwnershipKey}`),
      visualStateOwnerOrder: composerVisualOwnerSequence++,
    }),
    [pluginId, scopeOwnershipKey],
  );
  const releaseVisualState = useCallback(() => {
    scopeOwnership.invalidate();
    setComposerTextEffect(textEffectKey, pluginId, null, visualStateOwner);
    setComposerInputLock(textEffectKey, pluginId, false, visualStateOwner);
  }, [pluginId, scopeOwnership, textEffectKey, visualStateOwner]);
  const registerVisualStateOwner = useCallback(() => {
    slotOwnershipRegistry?.register(visualStateOwner, releaseVisualState);
  }, [releaseVisualState, slotOwnershipRegistry, visualStateOwner]);
  const setTextEffect = useCallback(
    (effect: PluginComposerTextEffect | null) => {
      if (!scopeOwnership.isActive()) return;
      if (effect !== null) registerVisualStateOwner();
      setComposerTextEffect(
        textEffectKey,
        pluginId,
        effect,
        visualStateOwner,
        visualStateOwnerOrder,
      );
    },
    [
      pluginId,
      registerVisualStateOwner,
      scopeOwnership,
      textEffectKey,
      visualStateOwner,
      visualStateOwnerOrder,
    ],
  );
  const setInputLock = useCallback(
    (locked: boolean) => {
      if (!scopeOwnership.isActive()) return;
      if (locked) registerVisualStateOwner();
      setComposerInputLock(textEffectKey, pluginId, locked, visualStateOwner);
    },
    [
      pluginId,
      registerVisualStateOwner,
      scopeOwnership,
      textEffectKey,
      visualStateOwner,
    ],
  );
  useEffect(() => {
    scopeOwnership.activate();
    return () => {
      releaseVisualState();
      slotOwnershipRegistry?.unregister(visualStateOwner);
    };
  }, [
    releaseVisualState,
    scopeOwnership,
    slotOwnershipRegistry,
    visualStateOwner,
  ]);

  const submissionSubscriptions = useRef(new Set<() => void>());
  useEffect(
    () => () => {
      for (const unsubscribe of submissionSubscriptions.current) unsubscribe();
      submissionSubscriptions.current.clear();
    },
    [],
  );
  const onSubmitted = useCallback(
    (listener: () => void) => {
      const unsubscribe = subscribeComposerSubmitted(scope, listener);
      submissionSubscriptions.current.add(unsubscribe);
      return () => {
        unsubscribe();
        submissionSubscriptions.current.delete(unsubscribe);
      };
    },
    [scope],
  );

  const source = useMemo<ComposerSource>(
    () =>
      composerHost ?? {
        scope,
        textEffectKey: routeDraft.storageKey,
        getCurrent: routeDraft.getCurrent,
        setDraft: routeDraft.setDraft,
        focus: () => requestComposerFocus(routeDraft.storageKey),
      },
    [
      composerHost,
      routeDraft.getCurrent,
      routeDraft.setDraft,
      routeDraft.storageKey,
      scope,
    ],
  );
  const controller = useMemo(
    () =>
      composerHandleController(pluginId, source, {
        setTextEffect,
        setInputLock,
        onSubmitted,
      }),
    [onSubmitted, pluginId, setInputLock, setTextEffect, source],
  );
  const [binding, setBinding] = useState(() =>
    createComposerHandleBinding(textEffectKey, controller),
  );
  let currentBinding = binding;
  if (binding.key !== textEffectKey) {
    currentBinding = createComposerHandleBinding(textEffectKey, controller);
    setBinding(currentBinding);
  }
  currentBinding.update(controller);
  return useMemo(
    () =>
      new Proxy(currentBinding.handle, {
        get(target, property, receiver) {
          if (
            property === "text" ||
            property === "draft" ||
            property === "isEmpty" ||
            property === "attachmentCount"
          ) {
            tracksDraft.current = true;
          }
          if (property === "selection") {
            tracksSelection.current = true;
          }
          return Reflect.get(target, property, receiver);
        },
      }),
    [currentBinding],
  );
}

function createComposerDraftsStore(hosts: readonly PluginComposerHost[]) {
  let snapshot = hosts.map((host) => host.getCurrent());
  let selections = hosts.map((host) => host.getSelection?.() ?? null);
  return {
    subscribe(listener: () => void): () => void {
      const unsubscribes = hosts.flatMap((host) => [
        host.subscribeDraft(listener),
        ...(host.subscribeSelection === undefined
          ? []
          : [host.subscribeSelection(listener)]),
      ]);
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
      };
    },
    getSnapshot() {
      const next = hosts.map((host) => host.getCurrent());
      const nextSelections = hosts.map((host) => host.getSelection?.() ?? null);
      if (
        next.some((draft, index) => draft !== snapshot[index]) ||
        nextSelections.some(
          (selection, index) => selection !== selections[index],
        )
      ) {
        snapshot = next;
        selections = nextSelections;
      }
      return snapshot;
    },
  };
}

export function useComposers(): readonly PluginComposerApi[] {
  const pluginId = usePluginId();
  const bridges = useSyncExternalStore(
    subscribeComposerEditorBridges,
    getComposerEditorBridges,
    getComposerEditorBridges,
  );
  const hosts = useMemo(
    () =>
      bridges
        .filter((bridge) => bridge.pluginCustomizable)
        .map((bridge) => bridge.host),
    [bridges],
  );
  const draftsStore = useMemo(() => createComposerDraftsStore(hosts), [hosts]);
  useSyncExternalStore(
    draftsStore.subscribe,
    draftsStore.getSnapshot,
    draftsStore.getSnapshot,
  );
  return useMemo(
    () => listedComposerHandles(pluginId, hosts),
    [hosts, pluginId],
  );
}

const rpcQueryHosts = new WeakMap<
  QueryClient,
  Map<string | null, RpcQueryHost>
>();

function rpcQueryHostFor(
  pluginId: string | null,
  queryClient: QueryClient,
): RpcQueryHost {
  let hosts = rpcQueryHosts.get(queryClient);
  if (hosts === undefined) {
    hosts = new Map();
    rpcQueryHosts.set(queryClient, hosts);
  }
  const cached = hosts.get(pluginId);
  if (cached !== undefined) return cached;
  const host: RpcQueryHost = {
    pluginId,
    queryClient,
    call: (id, method, input) => callPluginRpc(fetch, id, method, input),
    watch: (id, method, read) => {
      const target = {
        kind: "plugin-read",
        pluginId: id,
        method,
        read,
      } as const;
      wsManager.subscribe(target);
      return () => wsManager.unsubscribe(target);
    },
    subscribe: (id) => {
      const target = { kind: "plugin", pluginId: id } as const;
      wsManager.subscribe(target);
      return () => wsManager.unsubscribe(target);
    },
  };
  hosts.set(pluginId, host);
  return host;
}

export const {
  experimental_useRpcQuery,
  experimental_useRpcKeyedQuery,
  experimental_useRpcMutation,
  experimental_useRpcRefresh,
} = createRpcQueryHooks(() =>
  rpcQueryHostFor(useContext(PluginContext), useQueryClient()),
);
