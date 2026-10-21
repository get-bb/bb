import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { HeldDay2ResultMarker } from "./contract.js";

const STATE_KEY = "day2-delivery";
const MAX_TIMER_MS = 2_147_483_647;
const heldResultSchema = z
  .object({
    automationId: z.string().min(1),
    threadId: z.string().min(1),
    acceptedAt: z.number().int().nonnegative(),
    deliverAt: z.number().int().nonnegative(),
    eventAt: z.number().int().nonnegative(),
    kind: z.enum(["day2_result", "thread-error"]),
    body: z.string(),
  })
  .strict();
const stateSchema = z
  .object({
    lastOpenedAt: z.number().int().nonnegative().nullable(),
    held: z.array(heldResultSchema),
    consumed: z.array(z.string()),
    cancelled: z.array(z.string()),
  })
  .strict();
export type HeldDay2Result = z.infer<typeof heldResultSchema>;

export function createDay2Delivery(args: {
  bb: BbPluginApi;
  now: () => number;
  deliver: (result: HeldDay2Result) => Promise<void>;
}) {
  let state: z.infer<typeof stateSchema> | null = null;
  let queue: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function load() {
    if (state === null) {
      const stored = await args.bb.storage.kv.get<unknown>(STATE_KEY);
      state =
        stored === undefined || stored === null
          ? { lastOpenedAt: null, held: [], consumed: [], cancelled: [] }
          : stateSchema.parse(stored);
    }
    return state;
  }

  async function save() {
    await args.bb.storage.kv.set(STATE_KEY, await load());
  }

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  async function drain(): Promise<void> {
    clearTimer();
    const current = await load();
    if (!running) return;
    for (const result of [...current.held]) {
      if (!running) break;
      if (
        result.deliverAt > args.now() &&
        (current.lastOpenedAt === null ||
          current.lastOpenedAt <= result.acceptedAt)
      )
        continue;
      current.held = current.held.filter(
        (entry) => entry.automationId !== result.automationId,
      );
      if (!current.consumed.includes(result.automationId))
        current.consumed.push(result.automationId);
      await save();
      if (!current.cancelled.includes(result.automationId)) {
        try {
          await args.deliver(result);
        } catch (error) {
          args.bb.log.error(
            `Held result delivery failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    if (!running || current.held.length === 0) return;
    const next = Math.min(...current.held.map((result) => result.deliverAt));
    timer = setTimeout(
      () => {
        timer = null;
        void serialize(drain).catch((error: unknown) => {
          args.bb.log.error(
            `Held result delivery failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      },
      Math.min(MAX_TIMER_MS, Math.max(1, next - args.now())),
    );
    timer.unref?.();
  }

  return {
    hold(input: {
      marker: HeldDay2ResultMarker;
      threadId: string;
      eventAt: number;
      kind: HeldDay2Result["kind"];
      body: string;
      consumeMarker: () => Promise<unknown>;
    }): Promise<void> {
      return serialize(async () => {
        const current = await load();
        const id = input.marker.automationId;
        if (
          !current.cancelled.includes(id) &&
          !current.consumed.includes(id) &&
          !current.held.some((result) => result.automationId === id)
        ) {
          current.held.push({
            automationId: id,
            acceptedAt: input.marker.acceptedAt,
            deliverAt: input.marker.deliverAt,
            threadId: input.threadId,
            eventAt: input.eventAt,
            kind: input.kind,
            body: input.body,
          });
        }
        await save();
        await input.consumeMarker();
        await drain();
      });
    },
    hasHeldThread(threadId: string): Promise<boolean> {
      return serialize(async () =>
        (await load()).held.some((result) => result.threadId === threadId),
      );
    },
    onAppOpened(): Promise<void> {
      return serialize(async () => {
        const current = await load();
        current.lastOpenedAt = args.now();
        await save();
        await drain();
      });
    },
    cancel(automationId: string): Promise<void> {
      return serialize(async () => {
        const current = await load();
        if (!current.cancelled.includes(automationId))
          current.cancelled.push(automationId);
        current.held = current.held.filter(
          (result) => result.automationId !== automationId,
        );
        await save();
        await drain();
      });
    },
    start(): Promise<void> {
      return serialize(async () => {
        await load();
        running = true;
        await drain();
      });
    },
    async stop(): Promise<void> {
      running = false;
      clearTimer();
      await queue;
    },
  };
}
