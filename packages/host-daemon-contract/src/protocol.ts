// Version 164 stops the server accepting any interaction lifecycle record
// from a daemon event batch. `system/interaction/lifecycle` and the legacy
// `system/permissionGrant/lifecycle` / `system/userQuestion/lifecycle` are
// the server's own account of an interaction it registered; it writes one on
// registration and on every settle, and no daemon or bridge ever produced
// one. Until now the batch route kept a daemon-posted record whenever its
// interaction id was a real interaction on that thread, so a daemon could
// persist a fabricated "granted" or "answered" record — with its own content
// — for a still-pending interaction. The server now drops all three
// unconditionally (logged, never stored). No daemon sends them, so the bytes
// on the wire are unchanged; the bump records that the server's acceptance
// rules narrowed (the version 159 precedent).
//
// Version 163 removes the `absolute` side from the declared provider-native
// roots the server sends with `host.list_commands` and `host.list_skills`
// (`nativeRoots.skills` and `nativeRoots.commands` are `{ user, project }`).
// Version 157 added it for the pi plugin, which probed each connected host
// for the skills directories pi's `settings.json` names and re-registered
// the union across hosts as one global declaration. Pi now answers those
// directories per host through `resolveNativeRoots`, the plugin-host RPC
// every other provider plugin resolves its host-only roots with, so they
// arrive in `nativeRoots.resolved.skills` as user-origin roots and nothing
// populates the side. The roots schema is `.strict()`: an older daemon
// expects the key and rejects a root set without it, and a newer daemon
// rejects a server that still sends it, so the bump is what moves an
// enrolled machine onto a daemon that reads the two-sided shape.
//
// Version 161 (stabilization S2) renames the maintenance facts on the wire.
// Server → daemon: `bridgeLaunch.capabilities.experimental_providerInstallation`
// is now `providerInstallation` (the capabilities object is strict, so an older
// daemon rejects the new field name and a newer daemon rejects the old one).
// Server → clients: `ProviderInfo.maintenance { health, usage, installation }`
// is the stable shape. (An earlier draft also served the three
// `experimental_provider*` booleans beside it for one release; that window was
// withdrawn before release — see docs/api_to_audit.md.)
//
// Version 160 lets any bridge raise a plugin-defined request (WS5 layer 3)
// and changes the wire in both directions. Daemon → server: the
// interactive-request registration's `payload` accepts the request family's
// plugin member, `{ kind: "<pluginId>/<name>", title, data }`, beside the
// approval and the user question. Server → daemon: `interactive.resolve`
// carries the new `{ kind: "request_answer", value }` resolution, the form's
// submitted value on its way back to the bridge. An older daemon rejects the
// resolution it does not know, and an older server rejects the payload, so
// the bump is what moves an enrolled machine onto a daemon that speaks both.
//
// Version 159 adds `system/interaction/lifecycle` to `threadEventSchema`,
// which the daemon event batch parses. It is the one interaction-lifecycle
// event (WS5 layer 2): the server appends it on every status change of every
// interaction, carrying the interaction's record with the payload and the
// resolution paired by kind, and the per-shape
// `system/permissionGrant/lifecycle` / `system/userQuestion/lifecycle` events
// are legacy, converted at read time. The daemon never emits any of the three,
// so the bytes on the wire are unchanged; the bump records that the server's
// acceptance rules widened (the version 154 precedent) on a compatibility
// assumption this layer did not test. Version 164 closes that widening: the
// server drops all three from a daemon batch unconditionally.
//
// Version 158 removes the `codex.inference.complete` / `codex.voice.transcribe`
// commands: bb's AI services (helper inference, voice transcription) are
// served by a plugin's `bb.host` entry through the generic `plugin.host.call`
// command (`ai.inference.complete` / `ai.voice.transcribe` methods of the
// `@get-bb/plugin-sdk/ai-services` contract, carrying a `serviceId`), and the
// daemon bundles no ChatGPT client. An older daemon would still answer the
// removed commands; a newer daemon rejects them as invalid, so a server that
// still sends them must update.
//
// Version 157 adds the optional `absolute` side to the provider-native skill
// roots the server sends with `host.list_commands` and `host.list_skills`:
// host-absolute directories a provider plugin discovered through its own host
// RPC (pi's settings-configured skills directories, re-registered per
// connected host as the union across hosts). The daemon scans them like the
// relative roots, as user-origin skills. The schema is `.strict()`, so a
// server that sends the new key to an older daemon is rejected outright;
// the bump is what moves that daemon forward. With it the daemon's own pi
// skill policy (settings.json / trust.json readers) is gone: the plugin
// declares pi's roots.
//
// Version 156 removes the `daemon-bundled` bridge source: pi's bridge ships
// as the provider-pi plugin's `bb.host` artifact like every other provider,
// and the daemon bundles no bridge at all (pi itself is user-installed, gated
// on `pi --version` >= 0.84.0 plus a `get_state` probe). `bridgeLaunch.source`
// is the `artifact` variant only. An older daemon still accepts the removed
// variant but would never receive it; a newer daemon refuses it, so a server
// that still sends `daemon-bundled` for pi must update.
//
// Version 155 removes the typed `acpLaunchSpec` field from every command
// schema that carried it (the thread runtime context and its resume contexts,
// turn.submit, thread.goal.clear, and the five sessionless provider
// commands). An ACP agent's launch spec now reaches its bridge the way every
// other provider's static options do: inside `bridgeLaunch.providerOptions`,
// which the owning plugin declares. The daemon→bridge hop is unchanged — the
// bridge has always read `providerOptions.acpLaunchSpec` — and so is the
// process key, which already fingerprints the launch's provider options.
//
// Forward (old server → 155 daemon) BREAKS: every schema that carried the
// field is `.strict()` except `provider.list_models`, so an old server's
// thread.start, turn.submit, resume contexts, thread.goal.clear,
// provider.health, provider.installation.status, provider.installation.run
// and provider.usage are all rejected outright, and only its model listing
// degrades quietly (the field is stripped and the daemon lists the wrong
// agent's models). Reverse (155 server → old daemon) is tolerated in
// practice: the launch rides `providerOptions`, which an older daemon merges
// and forwards, and its own typed field is optional. The bump is therefore
// the repository rule — a wire this version deliberately narrowed does not
// ship on an untested compatibility assumption — plus the forward break,
// which is what moves an enrolled machine onto a daemon that speaks this
// shape.
//
// This continues what version 149 started. Provider-named fields remain on
// the wire (`codex.inference.*`, `codex.voice.*`); the runtime cleanup
// workstream removes the last of them.
//
// Version 154 (WS3 layer 5): the server no longer enriches tool-call events
// with the plugin `statusLabels` pair — the bridge's persisted `presentation`
// is the only label source — so the `item.statusLabels` key left the toolCall
// item schema and the daemon-wire guard that rejected a daemon-supplied one is
// gone. A daemon never sent the key, so the bytes on the wire are unchanged;
// the bump records that the wire's acceptance rules moved.
//
// Version 153 adds the optional `sourceProviderCheckpointId` to
// `thread.start.fork`. A fork requested at an earlier source sequence now
// clones the source session through that turn's recorded checkpoint instead
// of silently cloning the tip. An older daemon would strip the field and
// clone the tip, so it must update before it serves such a start.
//
// Version 152 records a displayed Pi extension message (`pi.sendMessage` with
// `triggerTurn`, e.g. a process-completion notification) as the `userMessage`
// item of the turn it woke, and stops surfacing its `message_start`/
// `message_end` boundaries as `provider/unhandled`. Older daemons emit the
// unhandled rows and no input for extension-triggered turns.
//
// Version 151 lets the daemon re-resolve an auto/steer turn target from its
// live runtime after the server observed an active thread but before it had a
// turn id. A command that an older daemon reports as `appliedAs: "new-turn"`
// can now report `appliedAs: "steer"`, preventing a child/system notification
// from replacing the user turn that was still starting.
//
// Version 150 adds an OPTIONAL `presentation` to each bb-injected tool
// definition (`dynamicTools[]` on thread.start, turn.submit and the resume
// contexts): how a call to the tool reads as a timeline row (grammar v3),
// resolved once by the server from the owning plugin's declaration and
// stamped by the bridge, beside `server: "bb"`, on the call's
// item.open/item.close. Additive and tolerated by an older daemon — the
// field is optional and `dynamicToolSchema` is not strict, so an old daemon
// strips the unknown key and keeps working; bumped per the repository rule
// that a widened server↔daemon wire bumps unless compatibility was
// deliberately tested. Stabilization makes the field required.
//
// Version 149 makes the thread runtime execution options provider-agnostic.
// `claudeCodePermissionMode`, `workflowsEnabled`, `memoryEnabled`, and
// `providerSubagentsEnabled` are gone from `options`; a REQUIRED
// `providerOptions` JSON object (derived per command by the owning provider
// plugin and opaque to the daemon) and an optional `promptMode: "plan"`
// replace them. `bridgeLaunch` gains a REQUIRED `envPassthrough` list naming
// the daemon environment variables the bridge may read, replacing the
// hardcoded `BB_CLAUDE_CODE_EXECUTABLE` forwarding. The schemas are strict,
// so an older daemon rejects the new payloads outright, and a newer daemon
// would treat an older server's provider knobs as absent.
//
// Version 148 is the generic assembler and the v3 delta grammar cutover. The
// daemon now emits `thread/extensionState/updated` (plugin-declared thread
// state) in its event batches — a new union member an older server's batch
// schema would reject — and its bridge runtime assembles the `thread/delta`
// grammar v3 only: the v2 streaming and usage dialects are gone, and every
// plugin bridge the server serves reports `grammarVersions: [3, 3]`. A
// version-147 daemon would refuse those bridges at the handshake, so the
// mismatch is what moves enrolled machines onto a daemon that speaks the
// grammar its bridges emit.
//
// Version 147 carries the provider plugin v3 contract across the daemon wire:
// the thread-event item union gains fileRead, search, delegation, planSteps
// and namespaced extension items plus an optional persisted `presentation`,
// two thread-scoped `item/delegation/*` events join the backgroundTask pair,
// and the interaction payload gains the `tool_use` approval subject. Every
// addition is a new union member or an optional field, so an older daemon's
// traffic still parses and nothing in this version emits the new shapes yet;
// the bump exists because the repository does not ship a widened event wire
// on an untested compatibility assumption — the version mismatch is what
// moves enrolled machines onto a daemon whose bridge runtime also negotiates
// the `thread/delta` grammar range (bridge protocol `grammarVersions`).
//
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
// Version 162 (stabilization S5): `host.list_commands` and `host.list_skills`
// carry a required `nativeRoots` set — the provider's declared skill and
// command roots with per-root options (`recursive`, `ancestors`,
// `namePrefix`) and the roots its plugin resolved for the host and workspace
// — in place of the optional `nativeSkillRoots` string lists. The daemon's
// per-provider scan table is gone; an old daemon rejects the new field and an
// old server's `nativeSkillRoots` fails the new daemon's strict schema.
//
// Version 165 adds a server-to-daemon acknowledgement for every daemon
// heartbeat. The daemon uses the acknowledgement to detect a one-way-stale
// websocket and reconnect instead of remaining registered but unable to
// receive host RPC commands.
//
// Version 166 makes turn admission single-owner across the shared runtime and
// lets turn submission recover a stale target by re-steering the live turn.
// An old daemon can still start a competing provider turn in that race.
//
// The version mismatch is what triggers the enrolled daemon's automatic update
// instead of an `invalid-message` reconnect loop.
export const HOST_DAEMON_PROTOCOL_VERSION = 166 as const;

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
