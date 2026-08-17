// Version 130 makes every provider plugin-declared on the wire. Two changes,
// both of which an older daemon rejects outright:
//
//   - A REQUIRED `bridgeLaunch` field sits beside every `acpLaunchSpec` site
//     (thread.start, the resume contexts, thread.goal.clear, thread.archive,
//     thread.unarchive, provider.list_models). It names the bridge's delivery
//     path explicitly — a content-addressed `artifact` or a `daemon-bundled`
//     id — rather than leaving the daemon to infer it from an absent field,
//     and carries the server-validated capabilities the daemon enforces before
//     a command reaches the bridge. The command schemas are strict, so an old
//     daemon cannot parse a payload carrying the new field.
//   - `host.delete_skill`'s per-provider scopes (`claude-user`,
//     `codex-project`, …) collapse to `provider-user` / `provider-project`.
//     The daemon only ever distinguished bb roots from a server-supplied
//     provider `rootPath`, and the old vocabulary could not name a plugin
//     provider. An old daemon rejects the new scope values.
//
// The version mismatch is what triggers the enrolled daemon's automatic update
// instead of an `invalid-message` reconnect loop.
export const HOST_DAEMON_PROTOCOL_VERSION = 130 as const;

/** Absolute ceiling for any executable artifact delivered to a host daemon. */
export const HOST_ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;
