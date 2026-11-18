import type {
  PluginThreadEventName,
  PluginThreadEventPayloads,
} from "../backend-contract.js";

export interface ThreadEventThread {
  threadId: string;
  createdAt: number | null;
}

export interface ThreadEventSubject {
  threadId: string;
  createdAt(): number | null;
}

export interface ThreadEventGate {
  track<T>(call: () => Promise<T>): Promise<T>;
  deliver(subject: ThreadEventSubject | null, deliver: () => void): void;
}

type ThreadOfEvent = {
  [E in PluginThreadEventName]: (
    payload: PluginThreadEventPayloads[E],
  ) => ThreadEventThread | null;
};

function fromThread(thread: {
  id: string;
  createdAt: number;
}): ThreadEventThread {
  return { threadId: thread.id, createdAt: thread.createdAt };
}

function fromThreadId(threadId: string): ThreadEventThread {
  return { threadId, createdAt: null };
}

const THREAD_OF_EVENT: ThreadOfEvent = {
  "experimental_environment.removed": () => null,
  "experimental_thread.events": ({ thread }) => fromThread(thread),
  "experimental_thread.parentChanged": ({ thread }) => fromThread(thread),
  "experimental_thread.read": ({ thread }) => fromThread(thread),
  "experimental_terminal.input": () => null,
  "experimental_host.deleted": () => null,
  "thread.created": ({ thread }) => fromThread(thread),
  "thread.active": ({ thread }) => fromThread(thread),
  "thread.idle": ({ thread }) => fromThread(thread),
  "thread.failed": ({ thread }) => fromThread(thread),
  "thread.archived": ({ thread }) => fromThread(thread),
  "thread.unarchived": ({ thread }) => fromThread(thread),
  "thread.deleted": ({ thread }) => fromThread(thread),
  "interaction.pending": ({ thread }) => fromThread(thread),
  "message.queued": ({ entry }) => fromThreadId(entry.threadId),
  "message.dispatched": ({ entry }) => fromThreadId(entry.threadId),
  "message.cancelled": ({ entry }) => fromThreadId(entry.threadId),
  "turn.failed": ({ threadId }) => fromThreadId(threadId),
  "experimental_thread.settled": ({ thread }) => fromThread(thread),
};

export function threadOfEvent<E extends PluginThreadEventName>(
  event: E,
  payload: PluginThreadEventPayloads[E],
): ThreadEventThread | null {
  const extract: (
    payload: PluginThreadEventPayloads[E],
  ) => ThreadEventThread | null = THREAD_OF_EVENT[event];
  return extract(payload);
}

interface HeldDelivery {
  threadId: string;
  createdAt: number | null;
  deliver: () => void;
}

export function createThreadEventGate(
  options: {
    now?: () => number;
    schedule?: (run: () => void) => void;
  } = {},
): ThreadEventGate {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((run) => void setImmediate(run));
  const callsStartedAt = new Map<symbol, number>();
  let held: HeldDelivery[] = [];

  function createdDuringCall(createdAt: number | null): boolean {
    if (createdAt === null) return false;
    for (const startedAt of callsStartedAt.values()) {
      if (startedAt <= createdAt) return true;
    }
    return false;
  }

  function release(): void {
    const pending = held;
    held = [];
    const stillHeld = new Set<string>();
    for (const entry of pending) {
      if (stillHeld.has(entry.threadId) || createdDuringCall(entry.createdAt)) {
        stillHeld.add(entry.threadId);
        held.push(entry);
        continue;
      }
      entry.deliver();
    }
  }

  return {
    async track(call) {
      const token = Symbol("thread-creating-call");
      callsStartedAt.set(token, now());
      try {
        return await call();
      } finally {
        callsStartedAt.delete(token);
        schedule(release);
      }
    },
    deliver(subject, deliver) {
      if (subject === null) {
        deliver();
        return;
      }
      const threadId = subject.threadId;
      if (held.some((entry) => entry.threadId === threadId)) {
        held.push({ threadId, createdAt: null, deliver });
        return;
      }
      if (callsStartedAt.size === 0) {
        deliver();
        return;
      }
      const createdAt = subject.createdAt();
      if (!createdDuringCall(createdAt)) {
        deliver();
        return;
      }
      held.push({ threadId, createdAt, deliver });
    },
  };
}
