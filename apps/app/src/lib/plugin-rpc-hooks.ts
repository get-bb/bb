import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  experimental_PluginRpcCallError,
  type PluginRpcContract,
  type PluginRpcClient,
} from "@get-bb/plugin-sdk";
import { createRpcQueryHooks } from "@get-bb/plugin-sdk/internal/rpc-query-host";
import { usePluginId } from "@/components/plugin/plugin-context";
import { wsManager } from "./ws";

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

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
  envelope = false,
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
    return envelope ? body : body.result;
  } catch (error) {
    throw experimental_PluginRpcCallError.from(error);
  }
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

export const {
  experimental_useRpcQuery: usePluginRpcQuery,
  experimental_useRpcKeyedQuery,
  experimental_useRpcMutation,
  experimental_useRpcRefresh,
} = createRpcQueryHooks(() => {
  const pluginId = usePluginId();
  const queryClient = useQueryClient();
  return useMemo(
    () => ({
      pluginId,
      queryClient,
      call: (
        id: string,
        method: string,
        input: import("@bb/domain").JsonValue,
      ) => callPluginRpc(fetch, id, method, input, true),
      mutationMeta: { showErrorToast: false },
      watch: (
        id: string,
        method: string,
        read: { input: import("@bb/domain").JsonValue } | { key: string },
      ) => {
        const target = {
          kind: "plugin-read",
          pluginId: id,
          method,
          read,
        } as const;
        wsManager.subscribe(target);
        return () => wsManager.unsubscribe(target);
      },
      subscribe: (id: string) => {
        const target = { kind: "plugin", pluginId: id } as const;
        wsManager.subscribe(target);
        return () => wsManager.unsubscribe(target);
      },
    }),
    [pluginId, queryClient],
  );
});

export { usePluginRpcQuery as experimental_useRpcQuery };
