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
