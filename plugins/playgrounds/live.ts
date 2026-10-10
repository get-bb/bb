import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  COMMAND_CHANNEL,
  idSchema,
  MAX_STATE_LENGTH,
  STATE_CHANNEL,
  threadSchema,
} from "./model.js";

const PRESENCE_TTL_MS = 35_000;
const COMMAND_TIMEOUT_MS = 10_000;
const EVENTS_KEPT = 500;
const MAX_EVENT_LENGTH = 20_000;
const MAX_CLIENTS = 20;

const clientSchema = z.string().min(8).max(64);
const actionName = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z][\w.-]*$/);
const small = z
  .unknown()
  .refine(
    (value) => JSON.stringify(value ?? null).length <= MAX_EVENT_LENGTH,
    `Limited to ${MAX_EVENT_LENGTH} characters of JSON.`,
  );
export const liveRpc = {
  getState: {
    input: z.object({ id: idSchema, threadId: threadSchema }).strict(),
    output: z
      .object({ state: z.unknown(), version: z.number().int() })
      .strict(),
  },
  setState: {
    input: z
      .object({
        id: idSchema,
        threadId: threadSchema,
        clientId: clientSchema,
        state: z.unknown(),
      })
      .strict(),
    output: z.object({ version: z.number().int() }).strict(),
  },
  event: {
    input: z
      .object({
        id: idSchema,
        threadId: threadSchema,
        clientId: clientSchema,
        name: actionName,
        data: small,
      })
      .strict(),
    output: z.object({ seq: z.number().int() }).strict(),
  },
  presence: {
    input: z
      .object({
        id: idSchema,
        threadId: threadSchema,
        clientId: clientSchema,
        actions: z.array(actionName).max(50),
        active: z.boolean(),
        closed: z.boolean().optional(),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  share: {
    input: z
      .object({
        id: idSchema,
        threadId: threadSchema,
        clientId: clientSchema,
        label: z.string().trim().min(1).max(80),
        data: small,
      })
      .strict(),
    output: z.object({ itemId: z.string() }).strict(),
  },
  result: {
    input: z
      .object({
        cmdId: z.string().uuid(),
        clientId: clientSchema,
        ok: z.boolean(),
        value: small.optional(),
        error: z.string().max(2000).optional(),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
};

export type LiveEvent = {
  seq: number;
  kind: string;
  at: number;
  data: unknown;
};
type Client = {
  threadId: string;
  lastSeen: number;
  lastActive: number;
  actions: string[];
};

export function createLive(
  bb: BbPluginApi,
  db: ReturnType<BbPluginApi["storage"]["database"]>,
  assertAnswer: (threadId: string, id: string) => void,
) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const clients = new Map<string, Map<string, Client>>();
  const pending = new Map<
    string,
    {
      clientId: string;
      resolve: (v: { ok: boolean; value?: unknown; error?: string }) => void;
    }
  >();

  const keyOf = (threadId: string, id: string) => `${threadId}:${id}`;
  const log = (threadId: string, id: string, kind: string, data: unknown) => {
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO answer_events (answer_id, thread_id, kind, data, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, threadId, kind, JSON.stringify(data ?? null), Date.now());
    const seq = Number(lastInsertRowid);
    db.prepare(
      "DELETE FROM answer_events WHERE answer_id = ? AND thread_id = ? AND kind <> 'shared' AND seq <= (SELECT seq FROM answer_events WHERE answer_id = ? AND thread_id = ? AND kind <> 'shared' ORDER BY seq DESC LIMIT 1 OFFSET ?)",
    ).run(id, threadId, id, threadId, EVENTS_KEPT);
    emitter.emit(keyOf(threadId, id));
    return seq;
  };
  const getState = (threadId: string, id: string) => {
    assertAnswer(threadId, id);
    const row = db
      .prepare(
        "SELECT state, version, updated_at FROM answer_state WHERE id = ? AND thread_id = ?",
      )
      .get(id, threadId) as
      | { state: string; version: number; updated_at: number }
      | undefined;
    return row
      ? {
          state: JSON.parse(row.state) as unknown,
          version: row.version,
          updatedAt: row.updated_at,
        }
      : { state: null, version: 0, updatedAt: null };
  };
  const setState = (
    threadId: string,
    id: string,
    state: unknown,
    by: string,
  ) => {
    assertAnswer(threadId, id);
    const json = JSON.stringify(state ?? null);
    if (json.length > MAX_STATE_LENGTH)
      throw new Error(
        `Playground state is limited to ${MAX_STATE_LENGTH} characters.`,
      );
    const version = getState(threadId, id).version + 1;
    db.prepare(
      "INSERT INTO answer_state (id, thread_id, state, version, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id, thread_id) DO UPDATE SET state = excluded.state, version = excluded.version, updated_at = excluded.updated_at",
    ).run(id, threadId, json, version, Date.now());
    log(
      threadId,
      id,
      "state",
      json.length <= MAX_EVENT_LENGTH
        ? { by, version, state }
        : { by, version, size: json.length },
    );
    bb.realtime.publish(STATE_CHANNEL, { id, threadId, version, by });
    return version;
  };
  const events = (
    threadId: string,
    id: string,
    since: number,
    limit = 200,
  ): LiveEvent[] =>
    (
      db
        .prepare(
          since === 0
            ? "SELECT seq, kind, data, created_at FROM answer_events WHERE answer_id = ? AND thread_id = ? AND seq > ? ORDER BY seq DESC LIMIT ?"
            : "SELECT seq, kind, data, created_at FROM answer_events WHERE answer_id = ? AND thread_id = ? AND seq > ? ORDER BY seq LIMIT ?",
        )
        .all(id, threadId, since, limit) as {
        seq: number;
        kind: string;
        data: string;
        created_at: number;
      }[]
    )
      .sort((a, b) => a.seq - b.seq)
      .map((r) => ({
        seq: r.seq,
        kind: r.kind,
        at: r.created_at,
        data: JSON.parse(r.data) as unknown,
      }));
  const openClients = (threadId: string, id: string) => {
    const now = Date.now();
    return [...(clients.get(keyOf(threadId, id))?.entries() ?? [])]
      .filter(
        ([, c]) =>
          c.threadId === threadId && now - c.lastSeen < PRESENCE_TTL_MS,
      )
      .sort((a, b) => b[1].lastActive - a[1].lastActive)
      .map(([clientId, c]) => ({
        clientId,
        actions: c.actions,
        lastActive: c.lastActive,
      }));
  };

  return {
    getState,
    setState,
    events,
    openClients,
    event(
      threadId: string,
      id: string,
      clientId: string,
      name: string,
      data: unknown,
    ) {
      assertAnswer(threadId, id);
      return log(threadId, id, "event", { by: clientId, name, data });
    },
    share(
      threadId: string,
      id: string,
      clientId: string,
      label: string,
      data: unknown,
    ) {
      assertAnswer(threadId, id);
      return `${id}.${log(threadId, id, "shared", { by: clientId, label, data })}`;
    },
    shared(itemId: string) {
      const [id, seq] = itemId.split(".");
      const row = db
        .prepare(
          "SELECT thread_id, data FROM answer_events WHERE answer_id = ? AND seq = ? AND kind = 'shared'",
        )
        .get(id, Number(seq)) as
        | { thread_id: string; data: string }
        | undefined;
      if (!row)
        throw new Error(
          "This attachment is no longer available. Send it from the playground again.",
        );
      return {
        id,
        threadId: row.thread_id,
        ...(JSON.parse(row.data) as { label: string; data: unknown }),
      };
    },
    presence(
      threadId: string,
      id: string,
      clientId: string,
      actions: string[],
      active: boolean,
      closed = false,
    ) {
      assertAnswer(threadId, id);
      const answerKey = keyOf(threadId, id);
      const map = clients.get(answerKey) ?? new Map<string, Client>();
      clients.set(answerKey, map);
      const now = Date.now(),
        prev = map.get(clientId);
      for (const [key, c] of map)
        if (now - c.lastSeen >= PRESENCE_TTL_MS) map.delete(key);
      if (closed) {
        map.delete(clientId);
        if (!map.size) clients.delete(answerKey);
        return;
      }
      if (!prev && map.size >= MAX_CLIENTS)
        throw new Error("This playground is open in too many places.");
      map.set(clientId, {
        threadId,
        lastSeen: now,
        lastActive: active || !prev ? now : prev.lastActive,
        actions,
      });
    },
    result(
      cmdId: string,
      clientId: string,
      outcome: { ok: boolean; value?: unknown; error?: string },
    ) {
      const p = pending.get(cmdId);
      if (!p || p.clientId !== clientId) return;
      pending.delete(cmdId);
      p.resolve(outcome);
    },
    async watch(threadId: string, id: string, since: number, waitMs: number) {
      assertAnswer(threadId, id);
      const found = events(threadId, id, since);
      if (found.length || waitMs <= 0) return found;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(t);
          emitter.off(keyOf(threadId, id), done);
          resolve();
        };
        const t = setTimeout(done, waitMs);
        emitter.on(keyOf(threadId, id), done);
      });
      return events(threadId, id, since);
    },
    async command(
      threadId: string,
      id: string,
      action: string,
      args: unknown[],
    ) {
      assertAnswer(threadId, id);
      actionName.parse(action);
      small.parse(args);
      const open = openClients(threadId, id);
      if (!open.length)
        throw new Error(
          "This playground is not open anywhere. Open its thread in bb, then try again.",
        );
      const target = open.find((c) => c.actions.includes(action));
      if (!target)
        throw new Error(
          `Unknown action "${action}". Available: ${[...new Set(open.flatMap((c) => c.actions))].join(", ") || "none"}.`,
        );
      const cmdId = randomUUID();
      log(threadId, id, "command", { action, args, to: target.clientId });
      const outcome = await new Promise<{
        ok: boolean;
        value?: unknown;
        error?: string;
      }>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(cmdId);
          resolve({
            ok: false,
            error: "The playground did not respond in time.",
          });
        }, COMMAND_TIMEOUT_MS);
        pending.set(cmdId, {
          clientId: target.clientId,
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
        });
        bb.realtime.publish(COMMAND_CHANNEL, {
          cmdId,
          id,
          threadId,
          clientId: target.clientId,
          action,
          args,
        });
      });
      log(threadId, id, "result", { action, ...outcome });
      return outcome;
    },
    removeThread(threadId: string) {
      for (const [key, map] of clients)
        if (key.startsWith(`${threadId}:`)) clients.delete(key);
      db.prepare("DELETE FROM answer_state WHERE thread_id = ?").run(threadId);
      db.prepare("DELETE FROM answer_events WHERE thread_id = ?").run(threadId);
    },
  };
}
