export const COMMAND_TIMEOUT_MS = 30_000;
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const LEASE_TIMEOUT_MS = 30_000;
export const DAEMON_DISCONNECT_GRACE_MS = 5_000;
export const DAEMON_ACTIVE_WORK_DISCONNECT_GRACE_MS = LEASE_TIMEOUT_MS;
/**
 * Grace window after the last live thread in a managed environment is archived
 * before its worktree is destroyed. The environment stays `retiring` (revivable
 * via unarchive → `retire.cancelled`, worktree intact) for this long so an
 * accidental archive can be undone losslessly. UI affordances may be
 * shorter-lived than this server-side recovery window. The destroy gate uses
 * the lifecycle-owned `retireRequestedAt` timestamp, so metadata updates cannot
 * move the clock and the window remains durable across restart.
 */
export const MANAGED_ENVIRONMENT_RETIRE_GRACE_MS = 5 * 60_000;
export const WORKSPACE_DIFF_MAX_DIFF_BYTES = 2 * 1024 * 1024;
export const WORKSPACE_DIFF_MAX_FILE_LIST_BYTES = 256 * 1024;
/**
 * User-facing status enriches ordinary untracked changes with exact line
 * counts. Both limits must admit the snapshot; larger sets keep their paths
 * and statuses but report incomplete line stats without reading contents.
 */
export const WORKSPACE_STATUS_MAX_UNTRACKED_LINE_STAT_FILES = 50;
export const WORKSPACE_STATUS_MAX_UNTRACKED_LINE_STAT_BYTES = 8 * 1024 * 1024;
/**
 * Shared hard ceiling for rich diff-file slices and untracked content reads.
 * At 500 files the daemon's conservative 16 KiB-per-file numstat budget stays
 * near 8 MiB; larger diffs return an exact leading slice without running stats
 * or content work beyond it. Keeping one policy also bounds alternate-index
 * work and the returned table of contents.
 */
export const WORKSPACE_DIFF_MAX_FILES = 500;

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
/**
 * Diffs with at most this many files get ALL their `auto`-tier patches shipped
 * inline with the TOC (`/diff/files` → `initialPatches`), so a small diff paints
 * in one round-trip. Larger diffs ship none: their cards auto-collapse on the
 * client (mirrors the frontend's auto-collapse threshold), so inline patches
 * would not render, and the extra patch pass would not be worth its cost. Those
 * load on demand as rows expand/scroll.
 */
export const DIFF_FILES_INLINE_PATCH_MAX_FILES = 10;
