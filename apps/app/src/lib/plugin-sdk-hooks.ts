import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type {
  BbContext,
  BbNavigate,
  PluginComposerApi,
  PluginComposerMention,
  PluginRpcClient,
  PluginSettingsState,
} from "@bb/plugin-sdk";
import { usePluginId } from "@/components/plugin/plugin-context";
import { getThread } from "@/lib/api";
import { requestComposerFocus } from "@/lib/composer-focus-requests";
import {
  usePromptDraftStorage,
  type PromptDraftScope,
} from "@/hooks/usePromptDraftStorage";
import {
  getPluginPanelRoutePath,
  getProjectComposeRoutePath,
  getRootComposeRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";
import { useRouteState } from "@/hooks/useRouteState";
import { wsManager } from "@/lib/ws";

/**
 * Host implementations of the `@bb/plugin-sdk/app` hooks (plugin design
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
  const response = await fetchImpl(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/${encodeURIComponent(method)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input ?? null),
    },
  );
  const body = (await response.json().catch(() => null)) as {
    ok?: unknown;
    result?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `rpc "${method}" failed (HTTP ${response.status})`,
    );
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
  if (body?.ok !== true || typeof body.values !== "object" || body.values === null) {
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

export function pluginSdkSettingsQueryKey(pluginId: string): QueryKey {
  return ["plugin-settings", pluginId];
}

/** Prefix the realtime `plugins-changed` broadcast invalidates. */
export function allPluginSettingsQueryKeyPrefix(): QueryKey {
  return ["plugin-settings"];
}

export function useRpc(): PluginRpcClient {
  const pluginId = usePluginId();
  return useMemo(
    () => ({
      call: (method: string, input?: unknown) =>
        callPluginRpc(fetch, pluginId, method, input),
    }),
    [pluginId],
  );
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
  const navigate = useNavigate();
  const toThread = useCallback(
    (threadId: string) => {
      // The canonical thread path carries the owning project, which the
      // plugin does not know — resolve it, falling back to the projectless
      // path when the lookup fails.
      void getThread(threadId)
        .then((thread) =>
          navigate(getThreadRoutePath({ projectId: thread.projectId, threadId })),
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
      void navigate(
        getPluginPanelRoutePath({
          pluginId,
          path,
          ...(options?.subPath !== undefined
            ? { subPath: options.subPath }
            : {}),
        }),
        options?.replace ? { replace: true } : undefined,
      );
    },
    [navigate, pluginId],
  );
  const toCompose = useCallback(
    (options?: { initialPrompt?: string; focusPrompt?: boolean }) => {
      // RootComposeView reads `focusPrompt`/`initialPrompt` off the location
      // state to seed and focus the composer (single-use, cleared after read).
      void navigate(getRootComposeRoutePath(), {
        state: {
          focusPrompt: options?.focusPrompt ?? false,
          initialPrompt: options?.initialPrompt ?? "",
        },
      });
    },
    [navigate],
  );
  return useMemo(
    () => ({ toThread, toProject, toPluginPanel, toCompose }),
    [toThread, toProject, toPluginPanel, toCompose],
  );
}

/**
 * Programmatic composer-draft access (plugin design §5.2): the same shared
 * localStorage-backed draft store the built-in "Add to chat" affordances
 * write to. Thread context → that thread's draft; anywhere else → the
 * new-thread draft. Focus requests ride the composer-focus bus, which the
 * composer hosts (ThreadDetailView / RootComposeView) subscribe to by
 * draft storage key.
 */
export function useComposer(): PluginComposerApi {
  const pluginId = usePluginId();
  const { projectId, threadId } = useRouteState();
  const scope: PromptDraftScope = useMemo(
    () =>
      threadId !== undefined && projectId !== undefined
        ? { kind: "thread", projectId, threadId }
        : { kind: "new-thread" },
    [projectId, threadId],
  );
  const draft = usePromptDraftStorage(scope);
  const { addQuote: addDraftQuote, getCurrent, setDraft, storageKey } = draft;

  const addQuote = useCallback(
    (text: string) => {
      addDraftQuote(text);
      requestComposerFocus(storageKey);
    },
    [addDraftQuote, storageKey],
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
              itemId: `${provider}:${mention.id}`,
              label,
            },
          },
        ],
      });
      requestComposerFocus(storageKey);
    },
    [getCurrent, pluginId, setDraft, storageKey],
  );

  const focus = useCallback(() => {
    requestComposerFocus(storageKey);
  }, [storageKey]);

  return useMemo(
    () => ({
      scope:
        threadId !== undefined
          ? { kind: "thread", threadId }
          : { kind: "new-thread", projectId: projectId ?? null },
      addQuote,
      insertMention,
      focus,
    }),
    [addQuote, focus, insertMention, projectId, threadId],
  );
}
