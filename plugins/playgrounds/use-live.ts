import { useCallback, useEffect, useRef, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server.js";
import { COMMAND_CHANNEL, MAX_STATE_LENGTH, STATE_CHANNEL } from "./model.js";

export type LiveSnapshot = { state: unknown; version: number };
type Options = {
  id: string;
  threadId: string;
  initial: LiveSnapshot;
  actions: string[];
  onRemoteState: (state: unknown, version: number) => void;
  onCommand: (action: string, args: unknown[]) => Promise<unknown>;
};
const SAVE_DELAY_MS = 300;
const HEARTBEAT_MS = 10_000;
const AGENT_BADGE_MS = 3200;
const isPrimitive = (value: unknown) =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";
const describe = (action: string, args: unknown[]) => {
  const first = args[0];
  const detail =
    first && typeof first === "object" && !Array.isArray(first)
      ? Object.values(first).every(isPrimitive)
        ? Object.entries(first)
            .slice(0, 2)
            .flatMap(([key, value]) => [key, String(value)])
        : []
      : args
          .filter((a) => typeof a === "string" || typeof a === "number")
          .slice(0, 2)
          .map(String);
  return [action, ...detail].join(" ").slice(0, 40);
};

export function useLiveAnswer({
  id,
  threadId,
  initial,
  actions,
  onRemoteState,
  onCommand,
}: Options) {
  const rpc = useRpc<typeof rpcContract>();
  const [clientId] = useState(() => crypto.randomUUID());
  const version = useRef(initial.version);
  const pending = useRef<{ state: unknown } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handlers = useRef({ onRemoteState, onCommand });
  handlers.current = { onRemoteState, onCommand };
  const [agent, setAgent] = useState<{ label: string; key: number } | null>(
    null,
  );
  const showAgent = (label: string) =>
    setAgent((current) => ({ label, key: (current?.key ?? 0) + 1 }));
  useEffect(() => {
    if (!agent) return;
    const t = setTimeout(() => setAgent(null), AGENT_BADGE_MS);
    return () => clearTimeout(t);
  }, [agent]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    void rpc
      .call("setState", { id, threadId, clientId, state: next.state })
      .then(
        (r) => {
          version.current = Math.max(version.current, r.version);
        },
        () => {},
      );
  }, [rpc, id, threadId, clientId]);
  useEffect(() => {
    if (pending.current) flush();
    return flush;
  }, [flush]);
  const save = useCallback(
    (state: unknown) => {
      if (JSON.stringify(state ?? null).length > MAX_STATE_LENGTH) return;
      pending.current = { state: state ?? null };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  const refresh = useCallback(async () => {
    const next = await rpc.call("getState", { id, threadId });
    if (next.version > version.current && !pending.current) {
      version.current = next.version;
      handlers.current.onRemoteState(next.state, next.version);
    }
  }, [rpc, id, threadId]);
  useRealtime(STATE_CHANNEL, (payload) => {
    const p = payload as {
      id?: unknown;
      threadId?: unknown;
      version?: unknown;
      by?: unknown;
    };
    if (
      p.id !== id ||
      p.threadId !== threadId ||
      p.by === clientId ||
      typeof p.version !== "number" ||
      p.version <= version.current
    )
      return;
    if (p.by === "agent") showAgent("updated");
    refresh().catch(() => {});
  });

  const actionsKey = actions.join("\n");
  const ping = useCallback(
    (active: boolean, closed?: boolean) => {
      rpc
        .call("presence", {
          id,
          threadId,
          clientId,
          actions: actionsKey ? actionsKey.split("\n") : [],
          active,
          ...(closed ? { closed } : {}),
        })
        .catch(() => {});
    },
    [rpc, id, threadId, clientId, actionsKey],
  );
  useEffect(() => {
    ping(false);
    const t = setInterval(() => ping(false), HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [ping]);
  useEffect(() => () => ping(false, true), [rpc, id, threadId, clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  const connection = useRealtimeConnectionState();
  const connected = useRef(connection === "connected");
  useEffect(() => {
    if (connection === "connected" && !connected.current) {
      ping(false);
      refresh().catch(() => {});
    }
    connected.current = connection === "connected";
  }, [connection, ping, refresh]);

  useRealtime(COMMAND_CHANNEL, (payload) => {
    const p = payload as {
      cmdId?: unknown;
      id?: unknown;
      clientId?: unknown;
      action?: unknown;
      args?: unknown;
    };
    if (
      p.clientId !== clientId ||
      p.id !== id ||
      typeof p.cmdId !== "string" ||
      typeof p.action !== "string"
    )
      return;
    const cmdId = p.cmdId;
    showAgent(describe(p.action, Array.isArray(p.args) ? p.args : []));
    const reply = (outcome: {
      ok: boolean;
      value?: unknown;
      error?: string;
    }) => {
      rpc.call("result", { cmdId, clientId, ...outcome }).catch(() => {});
    };
    handlers.current
      .onCommand(p.action, Array.isArray(p.args) ? p.args : [])
      .then(
        (value) => reply({ ok: true, value: value ?? null }),
        (error: unknown) =>
          reply({
            ok: false,
            error: (error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, 2000),
          }),
      );
  });

  return {
    clientId,
    agent,
    save,
    active: useCallback(() => ping(true), [ping]),
    emit: useCallback(
      (name: string, data: unknown) => {
        rpc
          .call("event", { id, threadId, clientId, name, data: data ?? null })
          .catch(() => {});
      },
      [rpc, id, threadId, clientId],
    ),
  };
}
