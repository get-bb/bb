# Configuration and skill management

## Environment Setup And Teardown Scripts

- To make a repo work with bb worktrees, run `bb guide environments`. It
  documents the repo-level `.bb-env-setup.sh` and `.bb-env-teardown.sh` hooks,
  and the `.worktreeinclude` file.
- A new worktree checks out tracked files only. Commit a `.worktreeinclude`
  file at the repo root to list untracked files, such as `.env`, that bb must
  copy from the source checkout. It uses gitignore pattern syntax. bb copies
  the matches before it runs `.bb-env-setup.sh`.

- Hooks require ownership confirmed by successful provider creation. Attached
  checkout and personal-workspace paths skip both hooks. Server restart resumes
  the saved hook operation; cleanup waits for daemon-confirmed termination
  after a transport failure and retries while the daemon is unreachable.

- Missing default environment plugins cause creation to fail before a thread is
  inserted. Enable the plugin or explicitly select another environment.
- Host-dependent environment preflight requires a connected machine. Directory
  switching creates a core-owned attachment without claiming plugin provenance.

## App settings

- Read `references/app-settings.md` for every general key, experiment, default,
  and effect.
- Use `bb settings show` and `bb settings ai-services` for current values.
- Use `bb settings general <key> <value>` or
  `bb settings experiment <key> <value>` for updates.
- Use `bb settings keyboard list`, `set`, and `reset` for shortcut overrides.
- Use `bb settings usage [--machine <id-or-name>]` for provider limits.
  `--host` is an alias for `--machine`.
- Use `bb settings version [--force]` for release information.
- Use `bb settings reload` to reload BB-managed configuration.
- These commands support `--json`.

## Agent Instructions

- Add `AGENTS.md` to the bb data dir (usually `~/.bb/AGENTS.md`) to inject
  user-level default instructions for every provider-backed thread across all
  projects.
- Add `.bb/AGENTS.md` at a workspace root to inject repo-specific instructions
  into every thread that runs there. Track the workspace file with git so fresh
  managed worktrees include it.
- bb appends data-dir instructions first, then workspace instructions, to the
  thread system prompt for all providers when a provider session starts.
- Only the plural `AGENTS.md` is read, only from those exact locations (no
  parent-directory walk); an empty file is ignored. Run
  `bb guide agent-configuration` for details (it also covers project
  `.bb/skills/`).

## Skills

- Use `bb skill list` to inspect installed and discovered skills. It defaults to
  `BB_PROJECT_ID`, then the personal project; pass `--project` or
  `--environment` to select another workspace.
- Copy the opaque ID from `bb skill list`, then use `bb skill show <skill-id>`
  or `bb skill files <skill-id>` to read that exact skill.
- `bb skill show <skill-id> --json` returns the revision. Pass that revision,
  plus `--file`, to `bb skill update <skill-id>`. Use update or delete only when
  the list says editable.
- Use `bb skill search [query]` for live skills.sh results. With no query it
  lists what is trending. The page defaults to zero, and the page size defaults
  to 24. The `ranking` field names the selected leaderboard.
- In JSON, `installs` is the ranking-window count. `lifetimeInstalls` is the
  resolved lifetime count or `null`. Resolution covers at most 48 rows and can
  fail at any page size. Human output prints `—` for an unresolved lifetime
  count.
- Inspect metadata and the bounded file preview with
  `bb skill registry detail <registry-skill-id>`.
  Install with `bb skill install <registry-skill-id>`; never infer an install
  source from a display name.
- `bb skill install-cli-skills` copies bb's built-in CLI skills into a machine's
  global agent skill roots (`~/.agents/skills` and `~/.claude/skills`) so agents
  outside bb can drive bb. It targets every connected machine unless you pass
  the repeatable `--machine <id-or-name>`, and reports each machine's outcome.
  Settings → Skills has the same action; it confirms first, and asks which
  machines only when more than one is enrolled.
- `bb skill cli-skills-status` reports per machine whether the installed copy is
  `installed`, `outdated`, `missing`, or `unknown` (disconnected or unreachable).

## BB guide instructions and skills

Settings → Installed plugins → BB guide controls the BB introduction and the
four bundled skills. All settings default to true. Use
`bb plugin config bb-guide set <key> true|false` with `introduction`, `skills`
(the master skill switch), `bbCli`, `pluginAuthoring`, `skillCreator`, or `submitPlugin`.
Disabling the plugin removes its introduction and skills. Changes apply when
agent configuration is next assembled; independently installed copies remain
available through their own sources.

## BB source runtime preparation

In the BB repository, add `--dryrun` to `pnpm start` or `pnpm start:worktree`
to run Turbo preparation, print resolved paths/ports and exit. The dry run uses
the same dotenv settings and runtime policy as normal startup. It does not start
services, migrate instance data or require ports to be free, but still writes
build outputs and may repair native modules. Install dependencies beforehand.
Preparation writes the checkout's build outputs; use a separate staging checkout
to warm Turbo while a live instance serves its existing files, then prepare the
stable serving checkout before launch. See `docs/debugging-and-qa.md` and
`bb guide environments`. These source-maintenance commands are separate from
installed `bb` commands and `.bb-env-setup.sh`.

## Machine access and isolated data

Machine access `machineServerUrl` is the URL reachable by machines; unset uses
`BB_EXTERNAL_URL`. `defaultMachineAccess` selects an access provider; unset
uses the first registered access provider, or direct when none are registered.
Inspect effective values
with `bb settings show --json` and change them with `bb settings general`.
`BB_DATA_DIR` selects isolated enrollment state. Local machine lifecycle commands
treat it as an ownership assertion and refuse the default BB installation; see
thread-creation.md and docs/configuration.md for the directory constraints.

Machine enrollment v2 stores private `serverHeaders` in machine `config.json`.
The launcher transports these through `BB_SERVER_HEADERS` (JSON string map) for
all server requests. Do not print these headers; they can contain access tokens.

## Machine environment

Repository setup receives freshly resolved machine variables on each dispatch,
including recovery. Values are sent transiently to the setup process and are
not stored in provisioning requests. Existing attached paths skip setup.

Use `bb machine env list --json` for variables and built-in gh health.
`bb machine env set NAME [--note text] --json` reads the value from
stdin and removes one trailing newline; never pass secrets in argv. Runtime
output is forwarded as-is, so commands and providers can print contributed
values. `bb machine env unset NAME --json` removes an override. All values are
encrypted in the database and omitted from settings responses.

These settings apply globally to enrolled machines, excluding local hosts. The
server synchronizes them into the daemon environment on connection and settings
changes, so background commands and new child processes inherit them. Removing
an override restores the original daemon value. User values override built-ins;
agent-provider entries override host values. Cached provider runtimes refresh
before their next operation once active work finishes. Reopen existing terminals
after a change. The server gh login provides GitHub Git/gh authentication and commit
identity by default; a user GH_TOKEN replaces it. See Settings → Machines →
Machine environment, and `bb machine env list` for builtInGit readiness.

Plugin host calls start immediately using the current environment while any calls
are active in that plugin worker. Changed or removed machine variables take
effect on the next call after all active calls finish. Continuous overlapping
calls can keep the previous values until the worker becomes idle.
