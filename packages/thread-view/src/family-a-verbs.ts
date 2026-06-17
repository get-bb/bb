/**
 * Family-A operation-row verb affixes — the single source of truth shared by the
 * flat-title builders (`parse-operation-message.ts`) and the App-side title
 * splitter (`timeline-row-title.ts`). Operation-row `title` stays a flat string
 * on the wire; the App re-splits it around these affixes to compose the linked
 * thread-name segment. Keeping the literals here means a verb copy-edit lands in
 * both the builder and the splitter at once — the two can't desync and silently
 * drop the thread name from the title.
 */

/** Leading verb for the active provisioning row: `"{verb} {thread}"`. */
export const PROVISIONING_LEADING_VERB = "Provisioning";

/**
 * Suffix verbs for the terminal/post-active provisioning rows:
 * `"{thread} {verb}"`. Includes the post-hoc-override verb
 * (`provisioning interrupted`) that `interruptOperationMessage` writes.
 */
export const PROVISIONING_SUFFIX_VERBS = [
  "provisioned",
  "failed to provision",
  "provisioning stopped",
  "provisioning interrupted",
] as const;

/** Suffix verbs for `thread-interrupted` rows: `"{thread} {verb}"`. */
export const THREAD_INTERRUPTED_SUFFIX_VERBS = [
  "stopped manually",
  "stopped — host daemon restarted",
  "stopped — provider turn stopped responding",
] as const;

/**
 * Ownership-change (parent-change) verbs by action. The flat title reads
 * `"{thread} {verb} {parent}"`; the splitter slices on `" {verb} "` to recover
 * the thread name (the parent comes from the row's `parentChange` ids/titles).
 */
export const OWNERSHIP_CHANGE_VERBS = {
  assign: "assigned to",
  release: "released from",
  transfer: "transferred to",
} as const;
