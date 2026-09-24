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
- `src/bridge/extension-ui.ts` — pi extension dialogs reach the user:
  `ctx.ui.select/confirm/input/editor` inside a pi extension arrive as pi RPC
  `extension_ui_request` lines, the bridge forwards each dialog as a
  `provider-pi/extension-ui` interaction request, and the plugin's pending
  interaction renderer (`app.tsx`) shows it and returns the answer to pi.
  Fire-and-forget requests (`notify`, `setStatus`, `setWidget`, `setTitle`,
  `set_editor_text`) are accepted and dropped. A dialog left pending when the
  session closes is answered cancelled. Requests that fail validation are
  answered cancelled, never forwarded. Select answers must match an offered
  option. Helper sessions without a dialog handler automatically cancel dialogs
  so extensions cannot block helper startup waiting for user input.

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

## Tests

The bridge tests drive `src/bridge/fake-pi-rpc.mjs`, a scripted
`pi --mode rpc` that loads the real bb extension the way pi does and speaks
pi's framing (LF-delimited JSON, raw U+2028 and U+2029). Its prompts script a
turn: `/tool <name> <json>` runs an extension tool, `/hold` keeps the run open
until `abort` or a steer, `/fail-run` ends it with an assistant error, `/ui
<json>` opens an extension dialog, and `/die` exits mid-run. `FAKE_PI_*`
environment variables select the rest: the reported version (`crash` for a
broken install), logs of spawns, commands, prompts, and tools, and the faults
the lifecycle and steering tests inject.

`bridge.bun-runtime.test.ts` runs the same fake under Bun when it is
installed: pi ships as a Bun standalone binary, and Bun's `node:net` could not
attach a read handle to a borrowed stdio fd, which silently dropped every
dynamic tool result.

The recorded-conformance replay of bb's committed pi recordings
(`packages/provider-bridge-protocol/recordings/pi`) runs in
`@bb/provider-parity` (`pi-recorded-conformance.test.ts`), because the
recordings live outside the plugin.
