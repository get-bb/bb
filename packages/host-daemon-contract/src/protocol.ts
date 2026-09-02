// Version 176 is this branch's single bump, on top of main's 175. The
// dispatch-queue rework stacked several branch-local bumps whose numbers had
// drifted into main's own, which mean unrelated things, and most of which
// narrated event types that no longer exist. They collapse into one bump
// covering the only thing a daemon can actually observe:
//
// `threadEventSchema` — which the daemon event batch parses (`session.ts`) —
// NARROWS by three event types: `system/dispatch-hold`, `system/queue-state`
// and `system/plugin-note` are deleted outright rather than kept decode-only.
// All three were emitted only on this branch, so no released build ever wrote
// one and no production row can contain one; the only stored rows are in dev
// databases, which are being wiped. A thread holding one no longer decodes.
// The server was the only writer and no daemon or bridge produced one, so the
// bytes on the wire are unchanged; the bump records that the server's
// acceptance rules narrowed (the version 164 precedent).
//
// The rework's queue surface needs no narration here: `system/queue-state` was
// the only thing carrying `queuedMessageWaitingOn` into `threadEventSchema`, so
// with that event gone the wait union (including its `host-offline` arm) is
// server-to-client only, and the `pending` thread status never crossed this
// wire at all.
//
// The version mismatch is what triggers the enrolled daemon's automatic update
// instead of an `invalid-message` reconnect loop.
export const HOST_DAEMON_PROTOCOL_VERSION = 176 as const;

export const HOST_ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;
