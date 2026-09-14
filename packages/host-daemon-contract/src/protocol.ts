// bb-fork: upstream version + 1 while the fork carries wire deltas (see
// hostPlatformSchema "windows"); resolve merge conflicts as max(upstream) + 1.
export const HOST_DAEMON_PROTOCOL_VERSION = 208 as const;

export const HOST_ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;
