# Configuration

The packaged `npx bb-app` flow stores persistent package settings under
`~/.bb/config.json` and provider environment values under `~/.bb/env.json`.

Use `bb-app config` for non-secret bb settings:

```bash
npx bb-app config set BB_APP_URL http://<machine>.<tailnet>.ts.net:38886
npx bb-app config set BB_INFERENCE codex/gpt-5.4-mini
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

## Precedence

Configuration is resolved in this order:

1. Explicit launcher flags, such as `--data-dir` or `--server-port`.
2. Persistent `bb-app config` and `bb-app env` values.
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

## Common Keys

| Key                | Command         | When to set             | Used for                                                                                                                 |
| ------------------ | --------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `BB_APP_URL`       | `bb-app config` | Optional for remote use | Human-facing app URL used for generated links and allowed browser origins. Leave empty for local-only use.               |
| `BB_INFERENCE`     | `bb-app config` | Optional                | Server-side helper model in `provider/model` format. Defaults to `codex/gpt-5.4-mini`.                                   |
| `BB_TRANSCRIPTION` | `bb-app config` | Optional                | Voice transcription model in `provider/model` format. Defaults to `codex/gpt-4o-mini-transcribe`.                        |
| `BB_SERVER_URL`    | `bb-app config` | Remote CLI/host use     | Server URL for standalone `bb` CLI and `host-daemon` commands on the current machine.                                    |
| `BB_LOG_LEVEL`     | `bb-app config` | Debugging               | Log level for the next bb start: `trace`, `debug`, `info`, `warn`, `error`, or `fatal`.                                  |
| `OPENAI_API_KEY`   | `bb-app env`    | OpenAI opt-in routes    | Required only when selecting explicit OpenAI provider routes such as `openai/gpt-4o-mini` or `openai/gpt-4o-transcribe`. |

By default, helper inference and voice transcription use Codex credentials from
the host daemon. Run `codex login` on the host for the default path. Set
provider env keys only when opting into a non-Codex provider route.

`BB_SERVER_URL` does not change where full `npx bb-app` startup binds locally.
It is for commands that need to target an already-running server, such as the
bundled `bb` CLI or a standalone host daemon.

## Custom ACP Agents

Known ACP agents can appear automatically when their CLI is installed on the
host. For example, bb exposes `acp-opencode` when `opencode` is on PATH and can
be launched as `opencode acp`.

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
      "args": ["acp"],
      "env": {
        "MY_AGENT_MODE": "bb"
      },
      "cwd": "/Users/me/project",
      "modelCli": {
        "listArgs": ["--list-models"],
        "selectFlag": "--model",
        "primaryModels": ["default"]
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

`modelCli` is optional. When present, `listArgs` are used to ask the agent for
models, `selectFlag` is the flag bb passes when launching with a selected model,
and `primaryModels` marks preferred models in the picker. ACP agents that
advertise models over the protocol are auto-discovered without `modelCli`; keep
`modelCli` for CLI-style agents such as Cursor.

For ACP-native agents, bb also uses a protocol `thought_level` config option
when the selected model advertises one. The selected reasoning level is applied
with `session/set_config_option` before the first prompt. Models without that
option keep agent-managed reasoning. Cursor is intentionally separate: it
encodes reasoning in model ids discovered through `modelCli`, not in an ACP
`thought_level` option.

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

## Startup Flags

Use launcher flags for per-run startup details:

```bash
npx bb-app --data-dir ~/.bb-test --server-port 48886 --host-daemon-port 48887
```

The data directory is the root directory for all bb-managed state: the SQLite
database, logs, host identity, and thread storage. It defaults to `~/.bb/` for
the packaged app. The `pnpm dev` source launcher derives an isolated data
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
dotenv cascade. Contributors can start from [`.env.example`](../.env.example)
for a local development template:

```bash
cp .env.example .env
```

The standard [dotenv-cli](https://github.com/entropitor/dotenv-cli) cascade
applies to source development. `pnpm dev` loads `.env`, `.env.local`,
`.env.development`, and `.env.development.local`, then overrides the instance
selectors (`BB_DATA_DIR`, server URL/port, host-daemon local API port, and Vite
port) with deterministic values derived from the checkout path. The SQLite
database path is always derived from `BB_DATA_DIR`.
`pnpm start` loads `.env`, `.env.local`, `.env.production`, and
`.env.production.local`.

Production startup from source goes through the packaged launcher path:
`pnpm start` runs `packages/bb-app/dist/bb-app.js`, and
`pnpm start:host-daemon` runs `packages/bb-app/dist/bb-app.js host-daemon`.
Source-only scripts do not own production ports or data-dir defaults.

Source checkout commands such as `pnpm bb`, `pnpm bb:dev`, and `pnpm reset`
are thin wrappers around `@bb/scripts`. Those wrappers force `NODE_ENV` to the
intended mode so ambient shell state does not silently retarget bb.

Use `pnpm reset` or `pnpm reset:dev` to clear a data directory. These only
remove bb-managed state, not provider credentials.
