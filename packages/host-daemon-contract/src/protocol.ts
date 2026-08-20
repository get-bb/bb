// Version 146 adds the lightweight `host.list_branch_options` RPC so branch
// pickers can read cached refs while the daemon refreshes remotes in the
// background. Older daemons cannot parse or serve that command.
//
// Version 145 adds provider-owned static options and installation capability
// metadata to bridge launches, forwards typed installation requirements, and
// removes the core `known_acp_agents.status` RPC. Older daemons reject the new
// launch fields and cannot safely interpret the provider-owned behavior.
//
// Version 144 moves provider installation status and execution plans into the
// provider bridge contract. The server now sends provider-scoped
// `provider.installation.*` commands with bridge launch metadata; older
// daemons only understand the removed hard-coded `provider_cli.*` commands.
//
// Version 143 lets daemons from before session-open's `localApiPort` field
// reach the protocol-version check by defaulting that field at the server
// boundary. Without it, those daemons receive `invalid_request` instead of
// `protocol_version_mismatch`, so their protocol self-updater never runs.
//
// Version 142 ships Pi context-window usage after every SDK turn ends, once
// its assistant response and tool results are both reflected in the session.
// Older bundled bridges report only after the full agent run ends, leaving the
// meter stale throughout multi-tool turns.
//
// Version 141 extends the consumed-not-queued acceptance rule to the remaining
// providers. Pi reports `input.accepted` for a turn only once it read the
// input: a prompt pi queues behind a live run stays unaccepted, and the
// queue-time settle report that used to accompany it is gone, so it can no
// longer complete an empty turn for a message pi has not answered. ACP reports
// acceptance once the `session/prompt` request carrying the input goes out, so
// a steer the turn drops is no longer reported as accepted. Older daemons emit
// the queue-time semantics and produce those phantom turns.
//
// Version 140 reports each daemon's browser-local editor helper port during
// session open. The server uses those ports to let a remote browser discover
// the helper on its own machine instead of assuming every machine uses the
// primary server host's port.
//
// Version 139 keeps a resumed Claude session's provider-owned task-notification
// result from claiming a newly accepted human input, and delays turn/start
// acceptance until Claude's SDK prompt iterator consumes the input. Older
// daemons can still make a sent message appear to complete immediately while
// its real response continues under a second, unaccepted turn.
//
// Version 138 removes the `workspace.discover_repos` command. It existed only
// for the first-run onboarding flow's project step, which is deleted; no server
// sends it any more. A newer daemon no longer answers it, so an older server
// paired with a new daemon would fail that command instead of returning repos.
// It also adds generic provider.health, changes provider.usage from one
// fixed three-provider result into a provider-targeted bridge query, and makes
// provider registration authoritative for whether a bridge implements either
// method. Older daemons cannot parse the new command shapes and would still
// gate the requests on initialize results, silently suppressing calls to new
// bridges that no longer advertise the methods there.
//
// Version 137 removes the `claudeCodeMockCliTraffic` runtime option and the
// Claude Code mock CLI traffic experiment behind it. Current servers no longer
// send the field, and current bridges no longer accept it.
//
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
export const HOST_DAEMON_PROTOCOL_VERSION = 146 as const;

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
