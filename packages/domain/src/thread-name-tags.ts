import type { ThreadEvent } from "./provider-event.js";

export const BB_THREAD_NAME_TAG = "bb";

export interface TagThreadNameArgs {
  name: string;
  tag: string;
}

export interface UntagThreadNameArgs {
  name: string;
  tag: string;
}

function threadNameTagPrefix(tag: string): string {
  return `[${tag}] `;
}

/**
 * Adds exactly one leading tag to a thread name.
 *
 * This intentionally does not check whether the name already starts with the
 * same text. A user title such as `[bb] Literal` must remain round-trippable:
 * externally it becomes `[bb] [bb] Literal`, and removing one leading `bb` tag
 * restores the original title.
 */
export function tagThreadName(args: TagThreadNameArgs): string {
  return `${threadNameTagPrefix(args.tag)}${args.name}`;
}

/**
 * Removes exactly one leading tag from a thread name.
 */
export function untagThreadName(args: UntagThreadNameArgs): string {
  const prefix = threadNameTagPrefix(args.tag);
  if (!args.name.startsWith(prefix)) {
    return args.name;
  }
  return args.name.slice(prefix.length);
}

/**
 * bb keeps internal thread titles untagged. When bb explicitly forwards a
 * title to a provider through a rename command, the runtime tags the
 * provider-facing name with `[bb] ` so provider-native UIs can distinguish
 * bb-owned sessions. Provider-originated names, including Codex
 * `thread/started` previews, are normalized if they already carry this tag but
 * are not forcibly re-renamed by this helper.
 */
export function toProviderExternalThreadName(title: string): string {
  return tagThreadName({ name: title, tag: BB_THREAD_NAME_TAG });
}

export function fromProviderExternalThreadName(name: string): string {
  return untagThreadName({ name, tag: BB_THREAD_NAME_TAG });
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
