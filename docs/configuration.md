# Configuration

The packaged `npx bb-app` flow stores persistent package settings under
`~/.bb/config.json`, provider environment values under `~/.bb/env.json`, and
client SSH target mappings under `~/.bb/client.json`.

Use `bb-app config` for non-secret bb settings:

```bash
npx bb-app config set BB_APP_URL http://<machine>.<tailnet>.ts.net:38886
npx bb-app config set BB_INFERENCE codex/gpt-5.6-luna
npx bb-app config set BB_TRANSCRIPTION codex/gpt-4o-mini-transcribe
npx bb-app config list
npx bb-app config unset BB_APP_URL
npx bb-app config refresh
```

Use `bb-app env` for provider credentials and provider-specific environment:

```bash
npx bb-app env set OPENAI_API_KEY <key>
npx bb-app env list
npx bb-app env unset OPENAI_API_KEY
```

`bb-app config list` shows non-secret values. `bb-app env list` redacts every
value and only shows whether a key is set.

The Add machine installer may also store a `machineCredential` and its
`connectMachineId` beside `serverUrl` in `config.json`. The credential is a
secret managed by bb connect: do not copy, edit, or commit it. Both fields are
intentionally omitted from `bb-app config list`. At runtime they are passed to
the standalone host daemon and its bundled `bb` CLI as
`BB_CONNECT_MACHINE_CREDENTIAL` and `BB_CONNECT_MACHINE_ID`. These are
installer-managed transport details, not user configuration knobs; re-add the
machine instead of setting them by hand.

Use `bb-app client ssh-target` to let a local helper open files from a remote
bb server in local editors. The SSH target is the value that works after
`ssh`, such as `devbox`, `user@devbox`, or a `Host` entry from `~/.ssh/config`:

```bash
npx bb-app client ssh-target set https://bb.example.test devbox
npx bb-app client ssh-target list
npx bb-app client ssh-target remove https://bb.example.test
```

## Precedence

Configuration is resolved in this order:

1. Explicit launcher flags, such as `--data-dir` or `--server-port`.
2. Persistent `bb-app config`, `bb-app env`, and client values.
3. Ambient shell environment.
4. Built-in defaults.

For the packaged app, prefer `bb-app config`, `bb-app env`, and launcher flags
over shell variables. The environment remains the internal and deployment
substrate, and source-development commands still load `.env` files.

After `bb-app config` writes `~/.bb/config.json` or `bb-app env` writes
`~/.bb/env.json`, it asks the running local server to reload. If bb is not
running, the new values apply on the next start. If you edit either file by
hand, run `npx bb-app config refresh` to apply the files to a running server.

The live reload applies runtime keys such as `BB_APP_URL`, `BB_INFERENCE`,
`BB_TRANSCRIPTION`, and provider env values like `OPENAI_API_KEY`. Startup-only
values such as `BB_LOG_LEVEL` apply the next time bb starts. Feature flags
remain source/deployment environment variables rather than `bb-app config`
keys.

When targeting a non-default running instance, pass the same `--data-dir` and
`--server-port` to `bb-app config` or `bb-app env` commands so they write the
right file and refresh the right server.

Startup settings such as data directory and ports still apply when the process
starts.

## Stopping A Running bb

A running `bb-app start` writes `<dataDir>/bb-app-runtime.json` and removes the
file when it exits. The file records the launcher process id, the server URL,
the version, the start time, and how bb was started. Do not edit it.

Two things read that file:

- `npx bb-app stop` stops the bb that owns the data directory. Pass the same
  `--data-dir` you started with when it is not the default `~/.bb/`.
- The macOS desktop app asks before it uses a bb it did not start, and offers to
  stop that copy for you.

Both confirm that the recorded process really is a bb launcher before they
signal it, so a stale file left by a crash cannot stop an unrelated process.

## Common Keys

| Key                | Command         | When to set             | Used for                                                                                                                                       |
| ------------------ | --------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `BB_APP_URL`       | `bb-app config` | Optional for remote use | Human-facing app URL used for generated links and allowed browser origins. Leave empty for local-only use.                                     |
| `BB_INFERENCE`     | `bb-app config` | Optional                | Server-side helper model in `provider/model` format. Defaults to `codex/gpt-5.6-luna`; the Codex helper route uses no reasoning.               |
| `BB_TRANSCRIPTION` | `bb-app config` | Optional                | Voice transcription model in `provider/model` format. Defaults to `codex/gpt-4o-mini-transcribe`.                                              |
| `BB_SERVER_URL`    | `bb-app config` | Remote CLI/host use     | Server URL for standalone `bb` CLI and `host-daemon` commands on the current machine. The CLI defaults to `http://127.0.0.1:38886` when unset. |
| `BB_LOG_LEVEL`     | `bb-app config` | Debugging               | Log level for the next bb start: `trace`, `debug`, `info`, `warn`, `error`, or `fatal`.                                                        |
| `OPENAI_API_KEY`   | `bb-app env`    | OpenAI opt-in routes    | Required only when selecting explicit OpenAI provider routes such as `openai/gpt-4o-mini` or `openai/gpt-4o-transcribe`.                       |

By default, helper inference and voice transcription use Codex credentials from
the host daemon. Run `codex login` on the host for the default path. Set
provider env keys only when opting into a non-Codex provider route.

The microphone picker in Settings → Voice Input is client-local. It stores the
selected browser `MediaDevices` device id in localStorage as
`bb.voiceInput.audioInputDeviceId`; it does not change `bb-app config` or the
server-side transcription model.

The Caffeinate toggle in Settings → General is server-backed and macOS-only. It
asks the primary host daemon to run `/usr/bin/caffeinate -i -w <daemon-pid>`
while enabled, preventing system idle sleep while bb is running; turning it off
stops that process. It only blocks idle sleep: closing a laptop lid or choosing
Sleep manually still sleeps the Mac. The toggle is hidden unless the connected
primary host daemon reports macOS.

The "Show unhandled provider events" toggle in Settings → General exposes raw
provider events that bb does not yet understand. It defaults to off in packaged
builds because these diagnostic payloads are noisy. Development builds continue
to show them regardless of the toggle. Set the persisted preference from an
agent or terminal with
`bb settings general showUnhandledProviderEvents <true|false>`.

The "Steer running threads on Enter" toggle in Settings → General changes the
active-thread composer shortcuts. It defaults to off: Enter queues and
Command+Enter steers. When enabled, Enter steers and Command+Enter queues. Set
it with
`bb settings general steerActiveThreadOnEnter <true|false>`.

## Keyboard Shortcuts

Settings → Keyboard edits app command shortcuts. Overrides are stored in the
server database, applied live to every connected window, and kept across
restarts. Resetting a shortcut removes its override so future bb releases can
continue to update the default. Clearing a shortcut explicitly disables that
command. Command context and native-only availability remain server-owned and
are not editable. Actions supported by both clients use the same resolved
bindings in the browser and desktop app; browsers may still reserve some chords
before bb receives them.

`Mod` means Command on macOS and Control on Windows/Linux. Numbered thread and
pane shortcuts follow Slack's browser-safe convention: web uses
`Control+1…9` on macOS and `Ctrl+Shift+1…9` on Windows/Linux, while desktop
uses `Mod+1…9`. The web aliases leave native browser `Mod+1…9` tab switching
untouched.

The "Show keyboard hints when holding CMD / Control" preference defaults
to on. Set it with
`bb settings keyboard hints <true|false>`. Turning it off hides the
delayed shortcut badges without disabling any shortcuts.

| Area      | Command                       | Default                           | Availability             |
| --------- | ----------------------------- | --------------------------------- | ------------------------ |
| Threads   | New thread                    | `Mod+N` / `Mod+Shift+O`           | Desktop / web            |
| Threads   | Search threads                | `Mod+K`                           | All clients              |
| Threads   | Previous / next thread        | `Mod+Shift+[/]` / `Mod+Shift+↑/↓` | Desktop / web            |
| Threads   | Open visible thread 1–9       | Platform defaults above           | Web / desktop            |
| Layout    | Previous / next chat pane     | `Mod+Shift+[/]`                   | While split              |
| Layout    | Focus chat pane 1–8           | Platform defaults above           | Split (web / desktop)    |
| Layout    | Maximize / restore chat pane  | `Mod+Shift+E`                     | While split              |
| Layout    | Close focused chat pane       | `Mod+Shift+X`                     | While split              |
| Window    | New window                    | `Mod+Shift+N`                     | Desktop                  |
| Window    | Settings                      | `Mod+,`                           | All clients              |
| Layout    | Toggle sidebar                | `Mod+\`                           | All clients              |
| Panel     | New tab / close tab / toggle  | `Mod+T` / `Mod+W` / `Mod+J`       | All clients              |
| Workspace | Quick open file / toggle diff | `Mod+P` / `Mod+D`                 | All clients              |
| Workspace | Open terminal                 | `Mod+Shift+Enter` / `Mod+Shift+T` | Web / desktop            |
| Workspace | Open in preferred app         | `Mod+O`                           | All clients              |
| Composer  | Focus composer                | `Mod+Shift+C`                     | All clients              |
| Composer  | Toggle model picker           | `Mod+Shift+M`                     | All clients              |
| Browser   | Focus location / reload       | `Mod+L` / `Mod+R`                 | Desktop embedded browser |
| Questions | Choose visible answer 1–9     | `1` … `9`                         | While a question is open |

The desktop application menu uses the same resolved bindings for New Thread,
New Window, New Tab, Close, and Settings. There is no separate menu shortcut
configuration.

`BB_SERVER_URL` does not change where full `npx bb-app` startup binds locally.
It is for commands that need to target an already-running server, such as the
bundled `bb` CLI or a standalone host daemon. The CLI can omit it when targeting
the default local packaged server at `http://127.0.0.1:38886`; set it for remote
or non-default servers.

## Client SSH Targets

`~/.bb/client.json` is local to the machine showing the UI. The CLI resolves the
remote server's host ID and stores a mapping from that server/work-host to an SSH
target known to the local machine. The remote server does not read this file.

Example:

```json
{
  "servers": {
    "https://bb.example.test": {
      "hosts": {
        "host_abc": {
          "sshAuthority": "devbox"
        }
      }
    }
  }
}
```

When a remote bb page asks the local helper to open a work-host path, the helper
uses this mapping to launch remote-capable editors and terminals over SSH.
Browsers or devices without a helper can still use bb; local editor actions are
simply unavailable.

## Custom ACP Agents

Known ACP agents can appear automatically when their CLI is installed on the
host. For example, bb exposes `acp-opencode` when `opencode` is on PATH and can
be launched as `opencode acp`, and `acp-omp` when `omp` (oh-my-pi) is on PATH
and can be launched as `omp acp`. It also exposes `acp-grok` when Grok Build's
`grok` CLI is on PATH and can be launched as `grok agent stdio`, and
`acp-hermes-agent` when Hermes' `hermes` CLI is on PATH and can be launched as
`hermes acp`.

Register custom ACP agents by editing `customAcpAgents` in `~/.bb/config.json`.
There is no `bb-app config set` or `unset` command for this list, matching the
manual-file workflow used for custom models. After editing the file, run
`npx bb-app config refresh` to apply it to a running local server, or restart bb.
Use `customAcpAgents` for arbitrary ACP agents, or to override the launch
command for a known provider id such as `acp-opencode`. To override
`acp-opencode`, set `"id": "opencode"`; bb derives the provider id by adding
the `acp-` prefix.

Example:

```json
{
  "customAcpAgents": [
    {
      "id": "my-agent",
      "displayName": "My Agent",
      "command": "my-agent",
      "logo": "agent-logos/my-agent.svg",
      "args": ["acp"],
      "env": {
        "MY_AGENT_MODE": "bb"
      },
      "cwd": "/Users/me/project",
      "modelCli": {
        "listArgs": ["--list-models"],
        "selectFlag": "--model",
        "primaryModels": ["default"]
      },
      "reasoningCli": {
        "flag": "--reasoning-effort",
        "supportedLevels": ["low", "medium", "high"],
        "levelValues": {
          "max": "high"
        },
        "defaultLevel": "high"
      },
      "nativeReasoning": {
        "configId": "reasoning_effort",
        "supportedLevels": ["none", "low", "medium", "high", "xhigh", "max"],
        "defaultLevel": "medium"
      }
    }
  ]
}
```

`id` is a slug matching `^[a-z0-9][a-z0-9-]*$`. bb derives the provider id by
prefixing it with `acp-`, so the example appears as `acp-my-agent` in
`bb provider list`, `bb provider models acp-my-agent`, and provider pickers.
The derived id must not collide with a built-in provider such as `acp-cursor` or
with another custom ACP agent. It may match a known ACP agent provider id, in
which case the custom config wins.

`command` is the executable name or path. bb runs it directly with the `args`
array; it is not a shell command line. `env` adds environment variables for the
agent process. `cwd` is optional; omit it to use the thread workspace directory.

`logo` is optional and accepts an SVG, PNG, or WebP file path. Relative paths
resolve from the bb data directory (for example,
`~/.bb/agent-logos/my-agent.svg`); absolute paths are also supported. bb serves
the file to app clients and uses it in provider and model pickers. Omit `logo`
to use the built-in brand icon for a known ACP agent or the generic ACP icon.

`modelCli` is optional. When present, `listArgs` are used to ask the agent for
models, `selectFlag` is the flag bb passes when launching with a selected model,
and `primaryModels` marks preferred models in the picker. ACP agents that
advertise models over the protocol are auto-discovered without `modelCli`; keep
`modelCli` for CLI-style agents such as Cursor.

`reasoningCli` is optional. Use it only when the agent accepts reasoning as a
global launch flag rather than advertising a protocol `thought_level` option or
encoding effort in model ids. `flag` is inserted before the ACP agent args,
`supportedLevels` controls the picker levels, `defaultLevel` controls the
picker default, and `levelValues` maps bb reasoning levels to the agent's CLI
vocabulary when they differ.

`nativeReasoning` is optional. Use it for ACP agents that accept reasoning via
`session/set_config_option` but do not advertise a `thought_level` config option
during model discovery. `configId` is the ACP config id to set,
`supportedLevels` controls the picker levels, `defaultLevel` controls the
picker default, and `levelValues` maps bb reasoning levels to the agent's ACP
config vocabulary when they differ. Hermes Agent uses this with
`configId: "reasoning_effort"`.

For ACP-native agents, bb also uses a protocol `thought_level` config option
when the selected model advertises one. The selected reasoning level is applied
with `session/set_config_option` before the first prompt. Models without that
option keep agent-managed reasoning unless the provider launch spec declares
`nativeReasoning`. Cursor is intentionally separate: it encodes reasoning in
model ids discovered through `modelCli`, not in an ACP `thought_level` option.
Grok Build is also separate: it uses `reasoningCli` to launch
`grok --reasoning-effort <level> agent stdio`.

Custom ACP agents are supported only with the co-located daemon from the same
machine as the server. A command path in server config is host-local and is not
meaningful for a remote daemon.

Security note: `command` is arbitrary local code execution by design. Anyone who
can write `~/.bb/config.json` can cause bb to run that command as the local user
when the provider is used. Treat `config.json` write access as the trust
boundary.

## Agent Instructions

bb can inject user-level and workspace-level agent instructions into every
provider-backed thread's system prompt, alongside the skills convention.

For user-level defaults across projects, create `AGENTS.md` in the bb data dir:

```
<dataDir>/AGENTS.md
```

For repo-specific guidance, create `.bb/AGENTS.md` at the workspace root:

```
<workspace>/.bb/AGENTS.md
```

The file contents are appended to bb's standard agent instructions when a
provider session starts, so the guidance applies regardless of which provider
runs. When both files exist, `<dataDir>/AGENTS.md` is appended first and
`<workspace>/.bb/AGENTS.md` second. An empty or whitespace-only file is treated
as absent.

No agent loads `.bb/AGENTS.md` natively, and provider-native instruction files
(`CLAUDE.md` for Claude Code, a repo-root `AGENTS.md` for Codex) remain
provider-specific. bb reads the files above itself and injects them, so use them
for guidance you want every bb thread to receive regardless of provider.

## Skills

User-level bb skills live under `<dataDir>/skills/<name>/SKILL.md`; for the
packaged app this is usually `~/.bb/skills`. Project skills live under
`<workspace>/.bb/skills/<name>/SKILL.md` and override same-named user or built-in
skills. Running plugins contribute a third tier: every `skills/<name>/SKILL.md`
in an installed plugin (relocatable via the manifest's `bb.skills` field) is
auto-imported while the plugin is loaded — overridden by project and user
skills by name, overriding built-ins.

## Multi-machine

Settings → Machines can enroll,
rename, and remove machines; project settings can add a path or clone source on
each machine; and thread creation can target any enrolled machine with a usable
source. The CLI equivalents are `bb machine list`, `bb project create
--machine <id-or-name> ...`, `bb project source add --machine <id-or-name>
...`, and `bb thread spawn --machine <id-or-name> ...`.

Multi-machine execution is independent of browser access. Tailscale and bb
connect let another browser reach the bb server; multi-machine support lets
that server dispatch work to non-primary host daemons. The Settings → Machines
installer can use a paired bb connect account to route the daemon and its CLI
back to the server. Machine credentials remain locally managed as described at
the top of this document.

Each machine has a permission ceiling (`maxPermissionMode`, default `full`).
The server resolves every thread on that machine down to the ceiling, so a
paired sandbox machine can keep Full Access while a personal machine stays at
Approve for me or Accept Edits. A provider that supports no mode under the
ceiling is refused on that machine. Only an owner session sets it, on the machine
page (Settings → Machines → the machine, which also carries that machine's
projects, provider CLIs, update state, and rename/remove); it is deliberately
absent from the SDK and the `bb` CLI,
and machine credentials are rejected at both the bb connect gate and the
server. The boundary it defends is machine-to-machine: a process already
running on the server machine has the data directory and the server itself, so
it is trusted as the owner here exactly as it is for renaming or removing a
machine. The current value is readable through the host API and
`bb machine list --json`.

Machine installation and daemon protocol repair use the owning server as the
distribution source: `/install/version` reports the server package/protocol and
`/install/bb-app.tgz` serves its exact installable package. The installer falls
back to npm only when the package route returns 404. Installed services enable
`--auto-update`; remove that flag from the launchd plist or systemd user unit
and reload the service to opt out. Updates only move to a newer server protocol,
retry failures with a persisted exponential backoff from 5 seconds to 5
minutes, and never downgrade a daemon. Settings → Machines and `bb machine
retry-update <id-or-name>` can bypass the current backoff after a transient
failure.

## Thread splits

Thread splits enable up to eight panes in the app's multi-pane thread view and
its sidebar, menu, and keyboard split controls. Edge placement creates panes
through the eighth pane; at the eight-pane limit, opening a new thread with an
edge placement replaces the focused pane. Every pane header can temporarily
maximize that pane without unmounting or resizing the underlying split tree;
the same control restores the exact arrangement. Maximization follows focus and
newly opened panes, closing the maximized pane restores the surviving layout,
and both the split tree and maximized pane restore after reload. Compact
viewports show the ordinary single-page surface while preserving that desktop
layout state.
It also enables explicit split placement through
`bb thread open <thread-id> --split right|down|left|top|replace` and the matching
SDK request, plus ephemeral maximize/restore delivery through
`bb thread pane maximize|restore|toggle [thread-id]` and
`sdk.threads.paneAction({ threadId, action })`. Pane actions apply only when the
target thread is already open in a multi-pane app window; the response reports
how many connected clients received the broadcast.

## bb connect

`bb connect --code <code> --server https://<handle>.getbb.app` pairs this bb
server for browser access at `<handle>.getbb.app` (claim a handle and copy the
command at https://getbb.app). Remote access is owned by the builtin
**connect plugin** (`plugins/connect/`): pairing redeems the code and stores
the durable credential in the plugin's kv storage (in `bb.db`), and the
plugin's background service holds the connect tunnel — dialing the gate,
proxying relayed requests to the server's own loopback (which serves the SPA

- `/api` + `/ws`), and reconnecting with capped backoff. The tunnel therefore
  lives as long as the bb server runs (with the plugin enabled) and
  re-establishes on restart; there is no foreground client. Pair from a machine
  without an installed bb via `npx -p bb-app@latest bb connect …`.
  `bb connect status` shows the connect state and every share's host and URL;
  `bb connect off` disconnects and clears the pairing. After pairing,
  `bb connect expose <port>` run from a thread shares that thread environment's
  enrolled host. Server-host URLs remain
  `https://<server-label>--<port>.getbb.app`; other machines use
  `https://<machine-label>--<port>.getbb.app` and proxy directly through the
  owning daemon. Outside a thread the command defaults to the server host;
  `--host <name-or-id>` overrides host resolution. Access requires the owner's
  getbb.app session (not a public link). `bb connect unexpose <port>` and
  `bb connect shares` use the same host resolution and accept the same
  `--host` override. Their JSON rows include `hostId`, `hostName`, `port`, and
  `url`; `shares --json` also includes the resolved `host`. A machine without
  a live Connect enrollment fails fast with instructions to remove and re-add
  it in Settings → Machines. Disabling the plugin
  (`bb plugin disable connect`) cuts off all remote access;
  `bb plugin enable connect` restores it.

The tunnel client lives in `plugins/connect/`; the CLI command is proxied to
the plugin, and Settings → Connect drives the plugin's rpc (including shared
ports).

## Experiments

Experimental surfaces are off by default and can be changed in Settings →
Experiments or with `bb settings experiment <key> <true|false>`. The `toolsHub`
experiment exposes Extensions for managing skills and plugins, while
Automations stays in the Plugins section beside threads. It is a UI-only gate:
installed skills, automation execution, plugin runtimes, CLI commands, and
backend APIs keep working while the experiment is off.

## Thread Timeline Window

A thread-timeline window is bounded by segment (user-message) count _and_ by
event count. Segment count alone is a weak bound on work, because an agentic
turn can be thousands of events: a thread with 21 user messages and 21k events
used to reproject its entire history on every timeline request. That projection
is synchronous, so it blocked the server's event loop — which also delayed
`/internal/session/events`, the endpoint the host daemon awaits before every
dynamic tool call and before registering every interactive request. One slow
thread therefore slowed agent work on _every_ thread on the host.

A window is capped at `BB_FF_TIMELINE_WINDOW_EVENT_BUDGET` events (default 1500) and returns however many whole turns fit. Older turns load automatically
as you scroll toward the top of the loaded window; a manual "Load older
messages" button remains on surfaces that render no scroll body, and after a
failed page so a broken fetch is retried on request rather than in a loop.
Nothing becomes unreachable — pagination still walks the full history, and the
head-state banners (goal, pending todos, running workflows, background
commands) are resolved by thread-scoped lookups rather than by scanning the
window, so a narrow window cannot drop them mid-session.

A turn larger than the whole budget is cut at the budget while it is _running_,
so watching an agent work through a very long turn costs the budget per update
rather than the whole turn; scrolling up loads the earlier part. Once the turn
finishes it is rendered whole again, because a finished turn collapses into one
summary row that two pages cannot each own — so the budget bounds a running turn
and a long thread, but not a single finished oversized turn.

Raising the budget far above the default restores the previous
unbounded-in-practice behavior; it is an operator escape hatch set at server
start, not a product setting.

Timeline builds slower than 150ms log `Thread timeline build blocked the event
loop` with a per-stage breakdown, and event-loop stalls over 500ms log `Event
loop stalled`. Both log at `info`, so they are visible in `~/.bb/logs/` without
raising `BB_LOG_LEVEL`.

## Plugins

Plugins are on by default. Builtin plugins, including connect, ship with bb;
user-installed plugins come from `bb plugin install` or the bundled official
store.

Plugin state lives under the data dir:

```
<dataDir>/plugins/<id>/data.db     Per-plugin SQLite database
<dataDir>/plugins/<id>/secrets/    Secret settings and the plugin HTTP token
<dataDir>/plugins/<id>/logs/       bb.log output (plugin.log, JSONL, rotated
                                   at 5MB; read with `bb plugin logs <id>`)
<dataDir>/plugins/git/, npm/       Managed installs for git:/npm: sources
<dataDir>/skills-generated/        Server-generated skills (the
                                   plugin-commands skill listing plugin CLI
                                   commands, injected into agent threads)
```

BB's official plugins (GitHub, Docs, Memory, Tasks) ship bundled inside the
app and install from the local bundled copy — no network, no remote catalog.
Discover them with `bb plugin search` or Extensions → Plugins → Browse; users
cannot add, remove, or configure the official plugin set. Installed official
plugins are pinned to the bundled copy and update with BB app releases. Local
path installs remain available directly through `bb plugin install ./path` or
`path:...`, and direct `npm:`/`git:` installs stay supported.

### Plugin updates

Bundled builtin and official plugins update with BB app releases. For direct
`git:`/`npm:` installs, updates are manual: `bb plugin outdated` checks
tracking sources and `bb plugin update <id>` / `bb plugin update --all`
applies compatible candidates; there is no automatic plugin update
application or update audit feed. Reinstalling an already-installed managed plugin is
refused — use `bb plugin update`. Before activation bb snapshots the plugin
database, host-managed settings/storage/schedules, secrets, and registration.
A failed activation restores that snapshot and records the latest failure on
the plugin so it can be surfaced as needing attention.

### Workflows plugin

The builtin Workflows plugin is disabled on fresh installations. Enable it
under Extensions → Plugins or with `bb plugin enable workflows`. Its six
settings accept base-10 integer strings through Extensions → Plugins or
`bb plugin config workflows set <key> <value>`:

| Key                    |    Default |       Allowed range | Behavior                                               |
| ---------------------- | ---------: | ------------------: | ------------------------------------------------------ |
| `maxActiveRuns`        |        `4` |            `1`–`32` | Concurrent runs across the plugin; changes apply live. |
| `maxConcurrentAgents`  |        `8` |            `1`–`64` | Concurrent agent calls within one run.                 |
| `maxAgentCalls`        |      `100` |          `1`–`1000` | Total agent calls within one run.                      |
| `totalRunTimeoutMs`    | `86400000` | `60000`–`604800000` | Maximum total run duration in milliseconds.            |
| `retentionDays`        |       `30` |          `1`–`3650` | Days to retain completed workflow data.                |
| `maxNotificationBytes` |    `16384` |     `1024`–`262144` | Maximum UTF-8 size of a completion notification.       |

The five settings other than `maxActiveRuns` are snapshotted into each new run.
Settings changes do not require a plugin reload.

`bb plugin install npm:<package>[@<version|tag|range>]` requires `npm` on PATH
(packages are installed with `--ignore-scripts`). Git plugins without prebuilt
frontend artifacts also use npm with lifecycle scripts disabled, then discard
their installed dependencies after bundling. An omitted npm spec tracks
the newest compatible stable release, ranges track within the range, dist-tags
track the tag, and exact versions are pinned. `git:<url>@<ref>` requires `git`;
branches track their head while tags and commits are pinned. Local
path installs register the directory in place and never delete it. Builtin
plugins use `builtin:<name>` and ship with bb unless removed. Managed
(`git:`/`npm:`) installs
refuse plugins whose optional `engines.bb` or `engines.bbPluginSdk` ranges
do not match the running bb/SDK, or whose `dist/*.meta.json` plugin identity
does not match the package manifest; installing a non-builtin source whose
derived id collides with a builtin name (automations, connect,
custom-instructions, inline-vis, secrets, workflows) is also refused.

The same tracking intent drives updates: `bb plugin outdated` checks for
compatible candidates (and reports blocked incompatible newer releases);
`bb plugin update <id>` / `bb plugin update --all` applies them. Pinned source
intent is never widened by update; remove and reinstall to choose a different
source intent. Dev builds (bb `0.0.0`) do not enforce `engines.bb` and annotate
that on check results.
Update confirmation matches install (full-trust code; `--yes` skips; non-TTY
refuses without it). Plugins are full-trust code running inside the bb server
process: they can read all local bb data, including other plugins' secrets.

## Startup Flags

Use launcher flags for per-run startup details:

```bash
npx bb-app --data-dir ~/.bb-test --server-port 48886 --host-daemon-port 48887
```

The data directory is the root directory for all bb-managed state: the SQLite
database, logs, host identity, thread storage, custom themes (`theme/`), and
plugins. It defaults to `~/.bb/` for the packaged app. The `pnpm dev` source launcher derives an isolated data
directory under `~/.bb-dev/<checkout-instance>/` from the checkout path. The
checkout instance id is the sanitized path to the checkout, relative to your
home directory, plus a short hash suffix. Use `--data-dir` to point packaged-app
instances at different data directories for fully isolated environments.

If the default ports are already in use, set explicit ports before starting:

```bash
npx bb-app --server-port 48886 --host-daemon-port 48887
```

## Source Development

For source development only, `pnpm dev` and `pnpm start` load the repo-root
dotenv cascade. Add a repo-root `.env` only when you need to override the
defaults described above.

The standard [dotenv-cli](https://github.com/entropitor/dotenv-cli) cascade
applies to source development. `pnpm dev` loads `.env`, `.env.local`,
`.env.development`, and `.env.development.local`, then overrides the instance
selectors (`BB_DATA_DIR`, server URL/port, host-daemon local API port, and Vite
port) with deterministic values derived from the checkout path. The SQLite
database path is always derived from `BB_DATA_DIR`.
`pnpm start` loads `.env`, `.env.local`, `.env.production`, and
`.env.production.local`.

Production startup from source uses the same launcher policy as the packaged
app while reading build outputs directly from `apps/app`, `apps/server`, and
`apps/host-daemon`. `pnpm start:host-daemon` continues to run the packaged
`packages/bb-app/dist/bb-app.js host-daemon` entrypoint. Source-only scripts do
not own production ports or data-dir defaults.

Source checkout commands such as `pnpm bb`, `pnpm bb:dev`, and `pnpm reset`
are thin wrappers around `@bb/scripts`. Those wrappers force `NODE_ENV` to the
intended mode so ambient shell state does not silently retarget bb.

Use `pnpm reset` or `pnpm reset:dev` to clear a data directory. These only
remove bb-managed state, not provider credentials.
