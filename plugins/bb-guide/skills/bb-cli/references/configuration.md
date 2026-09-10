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

In the BB repository, use `pnpm prepare:worktree` before a planned restart and
`pnpm launch:worktree` for validated launch without installs, builds, or native
repairs. `pnpm start:worktree` still prepares and launches in one command. All
worktree launches retain checkout-specific data/ports and worktree runtime
policy. Install dependencies before preparation when needed. Source, Node,
dependency, build-environment, or artifact changes require fresh preparation.
Preparation writes the checkout's build outputs; use a separate staging checkout
to warm Turbo while a live instance serves its existing files, then prepare the
stable serving checkout before launch. See `docs/debugging-and-qa.md` and
`bb guide environments`. These source-maintenance commands are separate from
installed `bb` commands and `.bb-env-setup.sh`.
