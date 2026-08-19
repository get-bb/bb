// Version 136 carries the narrow-grammar provider bridge protocol (bridge
// protocol v2): the provider bridge artifacts a server serves to daemons now
// speak `thread/delta` only — the `thread/event` lane is gone. An old daemon's
// runtime would ignore the delta notifications and render empty timelines, and
// old runtimes predate the bridge-handshake version check, so this daemon
// protocol version is the only gate that forces those daemons to update.
//
// Version 135 adds the `compaction-skipped` provider warning category. The Pi
// bridge now reports a refused manual compaction ("Nothing to compact") as
// that warning plus a completed turn instead of a failed turn. An older daemon
// still sends the failed turn, so the server would move the thread to error.
//
// Version 134 keeps replayed Codex usage snapshots off unknown turn ids: the
// Codex bridge drops the turn-only token usage that codex replays on
// thread/resume and thread/fork and emits the replayed context-window usage
// thread-scoped, instead of naming a turn id bb never stored a turn/started
// for. Older daemons still send those orphan snapshots and the server drops
// them, so enrolled machines must update for the replayed context usage to
// land.
//
// Version 133 carries Claude's terminal-failure drain suppression through the
// provider bridge. Older daemons can otherwise keep translating trailing SDK
// output under the prior event semantics after the server has accepted the
// failed turn as retryable.
//
// Version 132 prevents exact duplicate Codex terminal-item notifications from
// crossing the daemon boundary as duplicate lifecycle events. Version 131
// preserves Pi's provider identity when a bridge resumes a persisted session.
//
// Version 130 makes every provider plugin-declared on the wire. Two changes,
// both of which an older daemon rejects outright:
//
//   - A REQUIRED `bridgeLaunch` field sits beside every `acpLaunchSpec` site
//     (thread.start, the resume contexts, thread.goal.clear, thread.archive,
//     thread.unarchive, provider.list_models). It names the bridge's delivery
//     path explicitly — a content-addressed `artifact` or a `daemon-bundled`
//     id — rather than leaving the daemon to infer it from an absent field,
//     and carries the server-validated capabilities the daemon enforces before
//     a command reaches the bridge. It also names the owning `pluginId`,
//     because a provider bridge is now a consumer of that plugin's `bb.host`
//     artifact: the artifact variant carries the plugin host artifact's own
//     `digest` vocabulary and is fetched from the plugin host artifact route,
//     and the plugin id scopes the bridge process's directories on the host.
//     The command schemas are strict, so an old daemon cannot parse a payload
//     carrying the new field.
//   - `host.delete_skill`'s per-provider scopes (`claude-user`,
//     `codex-project`, …) collapse to `provider-user` / `provider-project`.
//     The daemon only ever distinguished bb roots from a server-supplied
//     provider `rootPath`, and the old vocabulary could not name a plugin
//     provider. An old daemon rejects the new scope values.
//
// The version mismatch is what triggers the enrolled daemon's automatic update
// instead of an `invalid-message` reconnect loop.
export const HOST_DAEMON_PROTOCOL_VERSION = 136 as const;

/**
 * Absolute ceiling for any executable artifact delivered to a host daemon —
 * a plugin host bundle or a provider bridge bundle alike. The daemon buffers
 * an artifact whole to hash-verify it before executing it, so an unbounded
 * bundle is unbounded daemon memory. The largest first-party bridge is ~2.5 MB
 * and the largest shape ever built (a fully inlined pi) was ~15 MB, so one
 * generous cap covers both delivery paths with two orders of magnitude to
 * spare. Enforced twice per path: the server refuses to record a bigger
 * artifact, and the wire schema refuses to carry one.
 */
export const HOST_ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Provider ids whose bridge ships inside the daemon bundle rather than as a
 * plugin artifact. Pi is the only one left: its agent tree cannot be inlined
 * into a relocatable artifact (see the graduation plan's pi verdict). The
 * daemon refuses artifact routing for these ids, and the server needs the same
 * list to know that a declaration for one of them has an implementation even
 * with no artifact behind it — so it lives on the contract both sides read
 * rather than in two places that can drift.
 *
 * Zod-free like the byte ceiling above: a plain constant both the schemas and
 * the runtime read without pulling the validation layer in.
 */
export const DAEMON_BUNDLED_PROVIDER_BRIDGE_IDS: readonly string[] = ["pi"];
