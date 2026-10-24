export const DEFAULT_TURN_RETRY_REASON = "Retry";

export const THREAD_MENTION_RESOLVE_MAX_IDS = 32;

export const PLUGIN_THREAD_METADATA_LIST_MAX_IDS = 200;

export const THREAD_ANCESTORS_LIST_MAX_IDS = 200;

export const THREAD_DESCENDANTS_LIST_MAX_IDS = 200;

export const THREAD_CASCADE_LIST_MAX_IDS = 200;

export const THREAD_LIST_MAX_IDS = 200;

export function parseThreadListThreadIds(value: string): string[] {
  return value === "" ? [] : value.split(",");
}

export const THREAD_COUNT_ROOT_PARENT = "none";

export const THREAD_MESSAGE_CONTEXT_LIMIT = 20;
