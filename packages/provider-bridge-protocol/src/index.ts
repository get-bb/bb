/**
 * The bb Provider Bridge Protocol: the one JSON-RPC contract between the
 * agent runtime and every provider bridge process. Schemas here are the
 * source of truth for both sides; the event grammar (turn lifecycle, item
 * lifecycle, id minting, ordering guarantees) is documented in
 * docs/provider-bridge-protocol.md and enforced by the conformance kit.
 *
 * Parsing discipline: lenient at the edges (all wire schemas are
 * passthrough; unknown fields and unknown capabilities tolerate forward
 * skew), strict at the core (a `thread/delta` payload must be a valid
 * delta; malformed requests are answered with INVALID_PARAMS, never
 * dropped).
 */
export * from "./version.js";
export * from "./handshake.js";
export * from "./execution-options.js";
export * from "./provider-maintenance.js";
export * from "./requests.js";
export * from "./notifications.js";
export * from "./bridge-requests.js";
export * from "./errors.js";
export * from "./thread-event-grammar.js";
export * from "./thread-delta.js";
