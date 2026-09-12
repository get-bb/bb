import type { ThreadEvent } from "./provider-event.js";

const BB_THREAD_NAME_PREFIX = "[bb] ";

export function toProviderExternalThreadName(title: string): string {
  return `${BB_THREAD_NAME_PREFIX}${title}`;
}

export function fromProviderExternalThreadName(name: string): string {
  if (!name.startsWith(BB_THREAD_NAME_PREFIX)) {
    return name;
  }
  return name.slice(BB_THREAD_NAME_PREFIX.length);
}

export function normalizeProviderThreadNameEvent(
  event: ThreadEvent,
): ThreadEvent {
  if (event.type !== "thread/name/updated") {
    return event;
  }
  return {
    ...event,
    threadName: fromProviderExternalThreadName(event.threadName),
  };
}
