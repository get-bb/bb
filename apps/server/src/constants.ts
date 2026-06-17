export const COMMAND_TIMEOUT_MS = 30_000;
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const LEASE_TIMEOUT_MS = 30_000;
export const DAEMON_DISCONNECT_GRACE_MS = 5_000;
export const DAEMON_ACTIVE_WORK_DISCONNECT_GRACE_MS = LEASE_TIMEOUT_MS;
export const WORKSPACE_DIFF_MAX_DIFF_BYTES = 2 * 1024 * 1024;
export const WORKSPACE_DIFF_MAX_FILE_LIST_BYTES = 256 * 1024;

/**
 * Per-file diff tiering thresholds (in changed lines = additions + deletions).
 * Files at or under the auto threshold load their patch eagerly; files over it
 * (or binary files) load on demand; files over the too-large threshold are not
 * offered a patch at all. The server owns this product policy and stamps each
 * `DiffFileEntry.loadMode` from it.
 */
export const DIFF_FILE_AUTO_LOAD_MAX_CHANGED_LINES = 500;
export const DIFF_FILE_TOO_LARGE_CHANGED_LINES = 20_000;
/** Per-file byte budget for an on-demand patch; the daemon tail-cuts beyond it. */
export const DIFF_FILE_PATCH_MAX_BYTES = 512 * 1024;
/** Hard ceiling on table-of-contents entries; beyond this the TOC is not_applicable. */
export const DIFF_FILES_MAX_COUNT = 5000;
/**
 * Diffs with at most this many files get ALL their `auto`-tier patches shipped
 * inline with the TOC (`/diff/files` → `initialPatches`), so a small diff paints
 * in one round-trip. Larger diffs ship none: their cards auto-collapse on the
 * client (mirrors the frontend's auto-collapse threshold), so inline patches
 * would not render, and the extra patch pass would not be worth its cost. Those
 * load on demand as rows expand/scroll.
 */
export const DIFF_FILES_INLINE_PATCH_MAX_FILES = 10;
