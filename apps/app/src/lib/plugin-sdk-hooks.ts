import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import type { PromptTextMention } from "@bb/domain";
import type {
  BbContext,
  BbNavigate,
  ComposerView,
  PluginComposerApi,
  PluginComposerMention,
  PluginRealtimeConnectionState,
  PluginRpcContract,
  PluginRpcClient,
  PluginSettingsState,
} from "@get-bb/plugin-sdk";
import {
  PluginSlotOwnershipContext,
  usePluginId,
} from "@/components/plugin/plugin-context";
import { usePluginThreadPanelOpenHandler } from "@/components/plugin/plugin-thread-panel-navigation";
import {
  PluginComposerViewContext,
  usePluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import { sdk } from "@/lib/sdk";
import { requestComposerFocus } from "@/lib/composer-focus-requests";
import { setComposerTextEffect } from "@/lib/composer-text-effects";
import {
  usePromptDraftStorage,
  type PromptDraftScope,
} from "@/hooks/usePromptDraftStorage";
import {
  appendQuoteAndAttachmentsToDraft,
  isPromptDraftEmpty,
} from "@/lib/prompt-draft";
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

/**
 * Host implementations of the `@get-bb/plugin-sdk/app` hooks (plugin design
 * §5.2). Every hook requires the PluginContext provider that PluginSlotMount
 * wraps around mounted slot components; the fetch-backed parts are split
 * into pure functions taking an injected `fetch` so tests can exercise the
 * response mapping without a server.
 */

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

/**
 * Runtime-only compatibility for bundles built against SDK 0.4.1 before the
 * composer-scoped status API was withdrawn. Keep this unadvertised no-op until
 * those bundles are outside the supported upgrade window.
 */
const legacySetThreadRowStatus = (_status: unknown): void => {};
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

/**
 * POST /api/v1/plugins/:id/rpc/:method. Resolves with the handler's result;
 * throws an Error carrying the server's message on `{ ok: false }` or
 * non-JSON/HTTP failures.
 */
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

/**
 * GET /api/v1/plugins/:id/settings, reduced to the plugin-visible values:
 * secrets arrive as `{ set: boolean }` markers and are excluded by shape, so
 * a secret value can never reach plugin frontend code. Returns null when
 * settings are unavailable (plugin not running, experiment off).
 */
export async function fetchPluginSdkSettings(
  fetchImpl: FetchLike,
  pluginId: string,
): Promise<Record<string, string | boolean> | null> {
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
  const values: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(body.values)) {
    if (typeof value === "string" || typeof value === "boolean") {
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
  // The runtime transport is contract-agnostic; the plugin supplies Contract
  // from its type-only backend import and the server enforces its schemas.
  return client as PluginRpcClient<Contract>;
}

export function useRealtime(
  channel: string,
  handler: (payload: unknown) => void,
): void {
  const pluginId = usePluginId();
  // Keep the latest handler without resubscribing per render.
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

/** Exposes the lifecycle of the same socket that backs `useRealtime`. */
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

export function useBbContext(): BbContext {
  const { projectId, threadId } = useRouteState();
  return useMemo(
    () => ({ projectId: projectId ?? null, threadId: threadId ?? null }),
    [projectId, threadId],
  );
}

export function useBbNavigate(): BbNavigate {
  const pluginId = usePluginId();
  const location = useLocation();
  const openThreadPanelHandler = usePluginThreadPanelOpenHandler();
  const navigate = useNavigate();
  const toThread = useCallback(
    (threadId: string) => {
      // The canonical thread path carries the owning project, which the
      // plugin does not know — resolve it, falling back to the projectless
      // path when the lookup fails.
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
      // RootComposeView reads `focusPrompt`/`initialPrompt` off the location
      // state to seed and focus the composer (single-use, cleared after read).
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
  return useMemo(
    () => ({
      toThread,
      toProject,
      toPluginPanel,
      toCompose,
      openThreadPanel,
    }),
    [toThread, toProject, toPluginPanel, toCompose, openThreadPanel],
  );
}

function reconcileComposerMentions(
  currentText: string,
  nextText: string,
  mentions: readonly PromptTextMention[],
): PromptTextMention[] {
  if (currentText === nextText) return [...mentions];

  let unchangedPrefixLength = 0;
  const maximumPrefixLength = Math.min(currentText.length, nextText.length);
  while (
    unchangedPrefixLength < maximumPrefixLength &&
    currentText[unchangedPrefixLength] === nextText[unchangedPrefixLength]
  ) {
    unchangedPrefixLength += 1;
  }

  let unchangedSuffixLength = 0;
  while (
    unchangedSuffixLength < currentText.length - unchangedPrefixLength &&
    unchangedSuffixLength < nextText.length - unchangedPrefixLength &&
    currentText[currentText.length - unchangedSuffixLength - 1] ===
      nextText[nextText.length - unchangedSuffixLength - 1]
  ) {
    unchangedSuffixLength += 1;
  }

  const replacedCurrentEnd = currentText.length - unchangedSuffixLength;
  const replacementDelta = nextText.length - currentText.length;
  return mentions.flatMap((mention) => {
    if (mention.end <= unchangedPrefixLength) return [mention];
    if (mention.start >= replacedCurrentEnd) {
      return [
        {
          ...mention,
          start: mention.start + replacementDelta,
          end: mention.end + replacementDelta,
        },
      ];
    }
    return [];
  });
}

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
const inputLockListenersByStorageKey = new Map<
  string,
  Set<ComposerInputLockListener>
>();

function notifyComposerInputLock(storageKey: string): void {
  const listeners = inputLockListenersByStorageKey.get(storageKey);
  if (!listeners) return;
  for (const listener of [...listeners]) listener();
}

/** Read whether any plugin currently owns an input lock for this composer. */
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
    notifyComposerInputLock(storageKey);
  }
}

export function subscribeComposerInputLock(
  storageKey: string | null,
  listener: ComposerInputLockListener,
): () => void {
  if (storageKey === null) return () => {};
  let listeners = inputLockListenersByStorageKey.get(storageKey);
  if (!listeners) {
    listeners = new Set();
    inputLockListenersByStorageKey.set(storageKey, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) inputLockListenersByStorageKey.delete(storageKey);
  };
}

/** Subscribe a prompt-box host to plugin-owned input locks for its draft key. */
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

/** Reactive read-side of the active composer, with a route-backed fallback. */
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
  const draft = composerHost?.draft ?? routeDraft;
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

/**
 * Programmatic composer-draft access (plugin design §5.2): the same shared
 * localStorage-backed draft store the built-in "Add to chat" affordances
 * write to. A transient host takes precedence while a queued message is being
 * edited; otherwise thread context targets that thread's draft and every
 * other surface targets the new-thread draft. Focus requests ride the
 * composer-focus bus when the active composer does not provide its own focus
 * primitive.
 */
export function useComposer(): PluginComposerApi {
  const pluginId = usePluginId();
  const slotOwnershipRegistry = useContext(PluginSlotOwnershipContext);
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
  const getCurrent = composerHost?.getCurrent ?? routeDraft.getCurrent;
  const setDraft = composerHost?.setDraft ?? routeDraft.setDraft;
  const textEffectKey = composerHost?.textEffectKey ?? routeDraft.storageKey;
  const hostFocus = composerHost?.focus;
  const focusActiveComposer = useCallback(() => {
    if (hostFocus) {
      hostFocus();
      return;
    }
    requestComposerFocus(routeDraft.storageKey);
  }, [hostFocus, routeDraft.storageKey]);

  const replaceText = useCallback(
    (current: ReturnType<typeof getCurrent>, nextText: string) => {
      if (nextText === current.text) return;
      setDraft({
        ...current,
        text: nextText,
        mentions: reconcileComposerMentions(
          current.text,
          nextText,
          current.mentions,
        ),
      });
    },
    [setDraft],
  );

  const setText = useCallback(
    (next: string) => {
      replaceText(getCurrent(), next);
    },
    [getCurrent, replaceText],
  );

  const updateText = useCallback(
    (updater: (current: string) => string) => {
      const current = getCurrent();
      replaceText(current, updater(current.text));
    },
    [getCurrent, replaceText],
  );

  const clear = useCallback(() => {
    setText("");
  }, [setText]);

  const composerScope = composerHost?.scope;
  const composerOwnershipScopeKey =
    composerScope?.kind === "queued-message"
      ? `queued-message:${composerScope.threadId}:${composerScope.queuedMessageId}`
      : composerScope?.kind === "side-chat"
        ? `side-chat:${composerScope.projectId}:${composerScope.parentThreadId}:${composerScope.tabId}:${composerScope.childThreadId ?? ""}`
        : composerScope?.kind === "thread"
          ? `thread:${composerScope.threadId}`
          : composerScope?.kind === "new-thread"
            ? `new-thread:${composerScope.projectId ?? "null"}`
            : threadId !== undefined
              ? `thread:${threadId}`
              : `new-thread:${projectId ?? "null"}`;
  const scopeOwnershipKey = [
    pluginId,
    composerOwnershipScopeKey,
    textEffectKey ?? "null",
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
    (effect: Parameters<PluginComposerApi["setTextEffect"]>[0]) => {
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

  const addQuote = useCallback(
    (text: string) => {
      const current = getCurrent();
      const next = appendQuoteAndAttachmentsToDraft(current, text, []);
      if (next !== current) {
        setDraft(next);
      }
      focusActiveComposer();
    },
    [focusActiveComposer, getCurrent, setDraft],
  );

  const insertMention = useCallback(
    (mention: PluginComposerMention) => {
      const provider = mention.provider.trim();
      const label = mention.label.trim() || mention.id;
      if (provider.length === 0 || provider.includes(":")) {
        // Provider ids exclude ":" (enforced at registration) — a bad id
        // would corrupt the composite itemId the server splits at send.
        console.warn(
          `[plugin:${pluginId}] useComposer().insertMention: invalid provider id "${mention.provider}"`,
        );
        return;
      }
      const current = getCurrent();
      // Append at the END so existing mention offsets stay valid (the same
      // invariant addQuote relies on).
      const separator =
        current.text.length === 0 || /\s$/u.test(current.text) ? "" : " ";
      const start = current.text.length + separator.length;
      const end = start + label.length;
      setDraft({
        ...current,
        text: `${current.text}${separator}${label} `,
        mentions: [
          ...current.mentions,
          {
            start,
            end,
            resource: {
              kind: "plugin",
              pluginId,
              icon: null,
              itemId: `${provider}:${mention.id}`,
              label,
            },
          },
        ],
      });
      focusActiveComposer();
    },
    [focusActiveComposer, getCurrent, pluginId, setDraft],
  );

  const focus = focusActiveComposer;
  const composerText = composerHost?.draft.text ?? routeDraft.text;

  return useMemo(
    () => ({
      scope:
        composerScope ??
        (threadId !== undefined
          ? { kind: "thread", threadId }
          : { kind: "new-thread", projectId: projectId ?? null }),
      text: composerText,
      setText,
      updateText,
      clear,
      setTextEffect,
      setInputLock,
      setThreadRowStatus: legacySetThreadRowStatus,
      addQuote,
      insertMention,
      focus,
    }),
    [
      addQuote,
      clear,
      composerScope,
      composerText,
      focus,
      insertMention,
      projectId,
      setText,
      setTextEffect,
      setInputLock,
      threadId,
      updateText,
    ],
  );
}
