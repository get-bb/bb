/**
 * The bb Provider Bridge Protocol version.
 *
 * Negotiated in both directions during `initialize`. Bump only for changes an
 * older bridge or runtime cannot tolerate: removing a method, changing the
 * meaning of an existing field, or tightening a previously lenient parse.
 * Additive changes (new optional capability, new method a bridge may not
 * implement, new notification the runtime may not understand) do NOT bump the
 * version — unknown methods answer -32601, unknown notifications are ignored,
 * and unknown capability fields pass through. That tolerance is the point of
 * the protocol: bridges version with their plugin, not with the daemon.
 *
 * Version history:
 * - 2 (2026-08): the narrow-grammar cutover. `thread/event` is gone; the
 *   timeline rides `thread/delta` exclusively and the runtime assembles
 *   canonical events. A version-1 bridge still emits `thread/event`
 *   notifications the runtime no longer understands, so the runtime rejects
 *   a mismatched handshake instead of silently showing an empty timeline.
 * - 1: the original dialect — bridges emitted finished `ThreadEvent`s on
 *   `thread/event`.
 */
export const PROVIDER_BRIDGE_PROTOCOL_VERSION = 2 as const;
