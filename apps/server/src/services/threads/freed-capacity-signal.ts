/**
 * "A thread stopped occupying capacity."
 *
 * A module-level bridge in the same shape, and for the same reason, as
 * `plugin-thread-events.ts`: the lifecycle choke points that know a thread just
 * went idle, failed, was archived or was deleted receive narrow
 * `{ db, hub, logger }` deps assembled long before the full server deps exist,
 * so createApp registers the one listener here instead of threading a drain
 * reference through every deps object. Unset — every isolated thread test that
 * never builds an app — the signal is a no-op.
 *
 * Deliberately importing nothing. It sits between the lifecycle fanout and the
 * queue drain, both of which already reach the plugin event emitter, and owning
 * no dependencies of its own is what keeps that from becoming an import cycle.
 */
let listener: (() => void) | undefined;

export function setFreedThreadCapacityListener(
  next: (() => void) | undefined,
): void {
  listener = next;
}

/**
 * Signals that a thread left the occupying set (`starting`/`active`). Whatever
 * slot it held — if it held one at all — is free now.
 *
 * Deliberately carries no thread id. A limit can be expressed over any
 * grouping and core does not know which one a plugin used, so "something
 * freed, re-ask everyone" is the only honest signal; the listener re-attempts
 * every plugin-queued row and the ones still blocked simply re-queue.
 */
export function noteThreadCapacityFreed(): void {
  listener?.();
}
