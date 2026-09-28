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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import type {
  BbContext,
  BbNavigate,
  ComposerView,
  PluginComposerApi,
  PluginComposerScope,
  PluginComposerTextEffect,
  PluginRealtimeConnectionState,
  PluginRpcContract,
  PluginRpcClient,
  PluginBrowserBbSdk,
  PluginEnvironmentProvider,
  PluginEnvironmentProvidersState,
  PluginProvidersState,
  PluginSettingsState,
  ExperimentalAppPanel,
  ExperimentalFixedTabTargetState,
  ExperimentalPluginFixedTabReference,
  JsonValue,
} from "@get-bb/plugin-sdk";
import { jsonValueSchema } from "@bb/domain";
import {
  PluginSlotOwnershipContext,
  usePluginId,
} from "@/components/plugin/plugin-context";
import { usePluginThreadPanelOpenHandler } from "@/components/plugin/plugin-thread-panel-navigation";
import {
  composerScopeIdentity,
  PluginComposerViewContext,
  usePluginComposerHost,
  usePluginComposerHostDraft,
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
import { sdk } from "@/lib/sdk";
import { getPluginBoundSdk } from "@/lib/plugin-bound-sdk";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { useSystemEnvironmentProviders } from "@/hooks/queries/environment-provider-queries";
import { requestComposerFocus } from "@/lib/composer-focus-requests";
import { setComposerTextEffect } from "@/lib/composer-text-effects";
import { createKeyedListeners } from "@/lib/keyed-listeners";
import {
  usePromptDraftStorage,
  type PromptDraftScope,
} from "@/hooks/usePromptDraftStorage";
import { isPromptDraftEmpty } from "@bb/client-core";
import {
  AUTOMATIONS_PLUGIN_ID,
  getPluginPanelRoutePath,
  getProjectComposeRoutePath,
  getRootComposeRoutePath,
  getThreadRoutePath,
  AUTOMATION_EDIT_ROUTE_PATH,
} from "@/lib/route-paths";
import { useRouteState } from "@/hooks/useRouteState";
import { useServerConnectionState } from "@/hooks/useServerConnectionState";
import { wsManager } from "@/lib/ws";
import { pluginSdkSettingsQueryKey } from "@/hooks/queries/query-keys";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { normalizeExperimentalFileOpenOptions } from "@/lib/live-file-navigation";
import { deprecatedAlias } from "@/lib/plugin-sdk-deprecated-aliases";
import {
  getPluginFixedTabOwnerId,
  useAppFixedTabTarget,
} from "@/lib/app-fixed-tab-navigation";

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export function isAutomationEditRoutePath(pathname: string): boolean {
  return (
    matchPath({ path: AUTOMATION_EDIT_ROUTE_PATH, end: true }, pathname) !==
    null
  );
}

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
  const serializedInput = serializePluginRpcInput(input ?? null);
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
    if (structured !== null) {
      const code = Reflect.get(structured, "code");
      const issues = Reflect.get(structured, "issues");
      if (typeof code === "string") Reflect.set(error, "code", code);
      if (Array.isArray(issues)) Reflect.set(error, "issues", issues);
    }
    throw error;
  }
  return body.result;
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

export function useSdk(): PluginBrowserBbSdk {
  const pluginId = usePluginId();
  const queryClient = useQueryClient();
  return getPluginBoundSdk(sdk, pluginId, queryClient);
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

interface BbNavigateWithDeprecatedAliases extends BbNavigate {
  experimental_openUrl: BbNavigate["openUrl"];
}

export function useBbNavigate(): BbNavigate {
  const pluginId = usePluginId();
  const location = useLocation();
  const openThreadPanelHandler = usePluginThreadPanelOpenHandler();
  const navigate = useNavigate();
  const appNavigation = useAppNavigationHost();
  const toThread = useCallback(
    (threadId: string) => {
      void sdk.threads
        .get({ threadId })
        .then((thread) =>
          navigate(
            getThreadRoutePath({ projectId: thread.projectId, threadId }),
          ),
        )
        .catch(() => navigate(`/threads/${threadId}`));
    },
    [navigate],
  );
  const toProject = useCallback(
    (projectId: string) => {
      void navigate(getProjectComposeRoutePath(projectId));
    },
    [navigate],
  );
  const toPluginPanel = useCallback(
    (path: string, options?: { subPath?: string; replace?: boolean }) => {
      const route = getPluginPanelRoutePath({
        pluginId,
        path,
        ...(options?.subPath !== undefined ? { subPath: options.subPath } : {}),
      });
      void navigate(route, options?.replace ? { replace: true } : undefined);
    },
    [navigate, pluginId],
  );
  const toCompose = useCallback(
    (options?: { initialPrompt?: string; focusPrompt?: boolean }) => {
      const replacesAutomationEditRoute =
        pluginId === AUTOMATIONS_PLUGIN_ID &&
        isAutomationEditRoutePath(location.pathname);
      void navigate(getRootComposeRoutePath(), {
        ...(replacesAutomationEditRoute ? { replace: true } : {}),
        state: {
          focusPrompt: options?.focusPrompt ?? false,
          initialPrompt: options?.initialPrompt ?? "",
          ...(replacesAutomationEditRoute
            ? { replaceInitialPrompt: true }
            : {}),
        },
      });
    },
    [location.pathname, navigate, pluginId],
  );
  const openThreadPanel = useCallback<BbNavigate["openThreadPanel"]>(
    (options) => openThreadPanelHandler?.({ ...options, pluginId }) ?? false,
    [openThreadPanelHandler, pluginId],
  );
  const openUrl = useCallback<BbNavigate["openUrl"]>(
    (url) => appNavigation.openUrl({ url }),
    [appNavigation],
  );
  const experimental_openFilePreview = useCallback<
    BbNavigate["experimental_openFilePreview"]
  >(
    (options) => {
      const normalized = normalizeExperimentalFileOpenOptions(options);
      return normalized !== null && appNavigation.openFilePreview(normalized);
    },
    [appNavigation],
  );
  const experimental_openFileExternally = useCallback<
    BbNavigate["experimental_openFileExternally"]
  >(
    (options) => {
      const normalized = normalizeExperimentalFileOpenOptions(options);
      return (
        normalized !== null && appNavigation.openFileExternally(normalized)
      );
    },
    [appNavigation],
  );
  return useMemo<BbNavigateWithDeprecatedAliases>(
    () => ({
      toThread,
      toProject,
      toPluginPanel,
      toCompose,
      openThreadPanel,
      experimental_openFileExternally,
      experimental_openFilePreview,
      openUrl,
      experimental_openUrl: deprecatedAlias(
        "experimental_openUrl",
        "openUrl",
        openUrl,
      ),
    }),
    [
      toThread,
      toProject,
      toPluginPanel,
      toCompose,
      openThreadPanel,
      experimental_openFileExternally,
      experimental_openFilePreview,
      openUrl,
    ],
  );
}

function useExperimentalAppPanel(): ExperimentalAppPanel {
  const pluginId = usePluginId();
  const appNavigation = useAppNavigationHost();
  const openFixedTab = useCallback<ExperimentalAppPanel["openFixedTab"]>(
    (options) => {
      const targetResult =
        options.target === undefined
          ? null
          : jsonValueSchema.safeParse(options.target);
      if (targetResult !== null && !targetResult.success) return false;
      return appNavigation.openFixedTab({
        surface: options.surface,
        tab: {
          ownerId: getPluginFixedTabOwnerId(pluginId, options.tab.panelId),
          tabId: options.tab.id,
        },
        ...(targetResult?.success === true
          ? { target: targetResult.data }
          : {}),
      });
    },
    [appNavigation, pluginId],
  );
  return useMemo(() => ({ openFixedTab }), [openFixedTab]);
}

function useExperimentalFixedTabTarget<Target extends JsonValue>(
  tab: ExperimentalPluginFixedTabReference<Target>,
): ExperimentalFixedTabTargetState<Target> | null {
  const pluginId = usePluginId();
  const state = useAppFixedTabTarget(
    getPluginFixedTabOwnerId(pluginId, tab.panelId),
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

export function useComposerView(): ComposerView {
  const providedView = useContext(PluginComposerViewContext);
  const composerHost = usePluginComposerHost();
  const { projectId, threadId } = useRouteState();
  const routeScope: PromptDraftScope = useMemo(
    () =>
      threadId !== undefined && projectId !== undefined
        ? { kind: "thread", projectId, threadId }
        : { kind: "new-thread" },
    [projectId, threadId],
  );
  const routeDraft = usePromptDraftStorage(routeScope);
  const hostDraft = usePluginComposerHostDraft(composerHost);
  const draft = hostDraft ?? routeDraft;
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
  usePluginComposerHostDraft(composerHost);
  const { projectId, threadId } = useRouteState();
  const routeScope: PromptDraftScope = useMemo(
    () =>
      threadId !== undefined && projectId !== undefined
        ? { kind: "thread", projectId, threadId }
        : { kind: "new-thread" },
    [projectId, threadId],
  );
  const routeDraft = usePromptDraftStorage(routeScope);
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
    [scope],
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
  return currentBinding.handle;
}

function createComposerDraftsStore(hosts: readonly PluginComposerHost[]) {
  let snapshot = hosts.map((host) => host.getCurrent());
  return {
    subscribe(listener: () => void): () => void {
      const unsubscribes = hosts.map((host) => host.subscribeDraft(listener));
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
      };
    },
    getSnapshot() {
      const next = hosts.map((host) => host.getCurrent());
      if (next.some((draft, index) => draft !== snapshot[index])) {
        snapshot = next;
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
