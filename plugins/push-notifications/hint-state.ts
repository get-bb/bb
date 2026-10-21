import { randomUUID } from "node:crypto";
import type {
  BbPluginApi,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import {
  NOTIFICATIONS_HINT_TAG,
  notificationsHintStateSchema,
  type NotificationsHintEligibility,
  type NotificationsHintState,
} from "./contract.js";

const HINT_STATE_KEY = "notifications-hint";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1_000;
const LONG_TURN_MS = 60_000;
type HintThread = PluginThreadEventPayloads["thread.active"]["thread"];

function initialState(): NotificationsHintState {
  return {
    dismissCount: 0,
    snoozedUntil: null,
    accepted: false,
    suggestion: null,
  };
}

export function createNotificationsHint(
  bb: BbPluginApi,
  options: {
    now?: () => number;
    getChannelEnabled: (channel: "web" | "desktop") => Promise<boolean>;
  },
) {
  const now = options.now ?? Date.now;
  let mutationQueue: Promise<void> = Promise.resolve();

  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function read(): Promise<NotificationsHintState> {
    const stored = await bb.storage.kv.get<unknown>(HINT_STATE_KEY);
    return stored === undefined || stored === null
      ? initialState()
      : notificationsHintStateSchema.parse(stored);
  }

  async function save(state: NotificationsHintState): Promise<void> {
    await bb.storage.kv.set(HINT_STATE_KEY, state);
    bb.rpc.experimental_invalidate([NOTIFICATIONS_HINT_TAG]);
  }

  function available(state: NotificationsHintState): boolean {
    return (
      !state.accepted &&
      state.dismissCount < 2 &&
      (state.snoozedUntil === null || state.snoozedUntil <= now())
    );
  }

  async function record(
    event: Parameters<
      BbPluginApi["sdk"]["system"]["experimental_recordTelemetryEvent"]
    >[0],
  ): Promise<void> {
    try {
      await bb.sdk.system.experimental_recordTelemetryEvent(event);
    } catch {
      bb.log.warn("Notification Hint telemetry could not be recorded");
    }
  }

  function visibleThread(thread: HintThread): boolean {
    return (
      thread.status !== "pending" &&
      thread.archivedAt === null &&
      thread.deletedAt === null &&
      thread.visibility === "visible"
    );
  }

  async function qualification(
    thread: HintThread,
    waiting: boolean,
  ): Promise<{ qualified: boolean; nextCheckAt: number | null }> {
    const events = await bb.sdk.threads.events.list({
      threadId: thread.id,
      types: [
        "client/thread/start",
        "client/turn/start",
        "turn/started",
        "turn/completed",
        "system/thread/interrupted",
      ],
      order: "desc",
      limit: "2",
    });
    const latest = events[0];
    if (latest === undefined) return { qualified: false, nextCheckAt: null };
    if (waiting) return { qualified: true, nextCheckAt: null };
    if (latest.type === "turn/started" && thread.status === "active") {
      const nextCheckAt = latest.createdAt + LONG_TURN_MS + 1;
      return now() < nextCheckAt
        ? { qualified: false, nextCheckAt }
        : { qualified: true, nextCheckAt: null };
    }
    const previous = events[1];
    if (
      latest.type === "turn/completed" &&
      previous?.type === "turn/started" &&
      latest.scope.kind === "turn" &&
      previous.scope.kind === "turn" &&
      latest.scope.turnId === previous.scope.turnId &&
      latest.createdAt - previous.createdAt > LONG_TURN_MS
    ) {
      return { qualified: true, nextCheckAt: null };
    }
    return {
      qualified: false,
      nextCheckAt: thread.status === "active" ? now() + LONG_TURN_MS + 1 : null,
    };
  }

  async function createSuggestion(state: NotificationsHintState) {
    const suggestion = { id: randomUUID(), shown: false };
    await save({ ...state, snoozedUntil: null, suggestion });
    return { id: suggestion.id };
  }

  return {
    state() {
      return mutate(read);
    },
    reset() {
      return mutate(async () => {
        const state = initialState();
        await save(state);
        return state;
      });
    },
    eligibility(input: {
      threadId: string;
      channel: "web" | "desktop";
    }): Promise<NotificationsHintEligibility> {
      return mutate(async () => {
        const state = await read();
        if (state.accepted || state.dismissCount === 2) {
          return { suggestion: null, nextCheckAt: null };
        }
        if (!(await options.getChannelEnabled(input.channel))) {
          return { suggestion: null, nextCheckAt: null };
        }
        const thread = await bb.sdk.threads.get({ threadId: input.threadId });
        if (!visibleThread(thread)) {
          return { suggestion: null, nextCheckAt: null };
        }
        if (!available(state)) {
          return { suggestion: null, nextCheckAt: state.snoozedUntil };
        }
        if (state.suggestion !== null) {
          return { suggestion: { id: state.suggestion.id }, nextCheckAt: null };
        }
        if (state.dismissCount === 0) {
          const interactions = await bb.sdk.threads.interactions.list({
            threadId: input.threadId,
          });
          const result = await qualification(
            thread,
            interactions.some(
              (interaction) => interaction.status === "pending",
            ),
          );
          if (!result.qualified) {
            return { suggestion: null, nextCheckAt: result.nextCheckAt };
          }
        }
        return { suggestion: await createSuggestion(state), nextCheckAt: null };
      });
    },
    observe(thread: HintThread, waiting: boolean) {
      return mutate(async () => {
        if (!visibleThread(thread)) return;
        const state = await read();
        if (!available(state) || state.suggestion !== null) return;
        const result = await qualification(thread, waiting);
        if (result.qualified) await createSuggestion(state);
      });
    },
    shown(id: string) {
      return mutate(async () => {
        const state = await read();
        if (
          !available(state) ||
          state.suggestion?.id !== id ||
          state.suggestion.shown
        ) {
          return state;
        }
        const next = { ...state, suggestion: { id, shown: true } };
        await save(next);
        await record({
          name: "suggestion_shown",
          properties: {
            surface: "hint",
            kind: "notifications",
            trigger: "event",
            suggestion_analytics_id: id,
          },
        });
        return next;
      });
    },
    accept(id: string) {
      return mutate(async () => {
        const state = await read();
        if (!available(state) || state.suggestion?.id !== id) return state;
        const next = { ...state, accepted: true, suggestion: null };
        await save(next);
        await record({
          name: "suggestion_accepted",
          properties: {
            surface: "hint",
            kind: "notifications",
            suggestion_analytics_id: id,
          },
        });
        return next;
      });
    },
    dismiss(id: string) {
      return mutate(async () => {
        const state = await read();
        if (!available(state) || state.suggestion?.id !== id) return state;
        const dismissCount = state.dismissCount === 0 ? 1 : 2;
        const next: NotificationsHintState = {
          ...state,
          dismissCount,
          snoozedUntil: dismissCount === 1 ? now() + SNOOZE_MS : null,
          suggestion: null,
        };
        await save(next);
        await record({
          name: "suggestion_dismissed",
          properties: {
            surface: "hint",
            kind: "notifications",
            suggestion_analytics_id: id,
            dismiss: dismissCount === 1 ? "not_now" : "never",
          },
        });
        return next;
      });
    },
  };
}
