/**
 * Facts about providers the daemon still holds locally.
 *
 * Provider metadata is declared server-side by plugins and rides every
 * bridge-bound command on `bridgeLaunch`, so almost nothing belongs here. What
 * remains is the pre-first-result session-restore seed and the ACP id shape —
 * the same role `acp-launch-specs.ts` plays for ACP launch data.
 */

/** Whether an id belongs to the dynamic ACP tier. */
export function isAcpProviderId(value: string): boolean {
  return value.startsWith("acp-");
}

/**
 * Whether a stopped session of this provider can resume from its persisted id.
 * The runtime stamps it into the thread's shell environment. This is only a
 * pre-first-result seed: every bridge reports its real answer per session on
 * `thread/start`, which is the sole source for a graduated provider.
 */
const SESSION_RESTORABLE_BY_PROVIDER_ID: Readonly<Record<string, boolean>> = {
  pi: true,
};

/** Whether a stopped session of this provider resumes from its persisted id. */
export function isSessionRestorableProvider(providerId: string): boolean {
  return SESSION_RESTORABLE_BY_PROVIDER_ID[providerId] ?? false;
}

