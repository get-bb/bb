# Pi provider

First-party plugin for the [Pi coding agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent).
Pi is user-installed (`npm install -g @earendil-works/pi-coding-agent`, 0.84.0
or newer); the plugin ships no agent tree.

What lives here:

- `server.ts` — the plugin's runtime: one `bb.providers.register` for `pi`
  (`src/declaration.ts`).
- `src/host.ts` — the `bb.host` artifact, two surfaces in one file: the
  provider bridge (`src/bridge/`, a thin bridge over `pi --mode rpc` plus the
  bb extension pi loads) and the host entry that answers `resolveNativeRoots`
  (`src/native-roots.ts`).
- `src/delta-translation.ts` — pi's session events become bb's thread deltas.
- `src/bridge/provider-maintenance.ts` — the install gate (`pi --version`
  ≥ 0.84.0) and the npm install/update actions.

## Skills

Pi's skill layout is the plugin's fact, so bb lists pi's skills beside its
own and core holds no pi policy. The registration declares the documented
directories (`experimental_nativeSkillRoots`):

- `user`: `.pi/agent/skills` and `.agents/skills` under the host's home.
- `project`: `.pi/skills` and `.agents/skills` under the workspace.

The directories only a host knows are the host entry's answer
(`experimental_resolvesNativeRoots`): when bb lists skills on a host it asks
the plugin's host entry there, which reads `<agentDir>/settings.json`'s
`skills` entries (absolute, `~`-relative, or relative to the agent dir) and
adds `<agentDir>/skills` when `PI_CODING_AGENT_DIR` moves the agent dir. Each
host answers for itself, from its own files, at listing time (bb caches the
answer briefly). A settings entry that names a declared directory is listed
once: bb scans each directory once, and the declared root wins.

Not listed, by design:

- Skills pi loads through `packages` (npm/git installs pi manages itself) and
  `!pattern` disable entries: pi still applies them, bb does not show them.
- A settings entry naming a single `.md` file (`SKILL.md` or any other
  markdown file pi loads as one skill): it has no directory root to scan.
- The trusted project's `.pi/settings.json` `skills` entries: the host entry
  reads the user settings only.
- `.agents/skills` in ancestor directories of the workspace (pi walks up to
  the git root): the declared `project` roots resolve against the workspace
  only.

## Environment

`BB_PI_BRIDGE_COMMAND` and `BB_PI_BRIDGE_ARGS` point the bridge (and its
version probe) at a pi executable other than the `pi` on `PATH` — a pinned
install in a temporary prefix, say. The plugin declares them as environment
passthrough, so a value set on the host daemon's environment reaches the
bridge process; bb strips every other inherited `BB_*` variable.
