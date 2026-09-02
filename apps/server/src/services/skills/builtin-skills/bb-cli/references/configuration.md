# Configuration and skill management

## Environment Setup And Teardown Scripts

- To make a repo work with bb worktrees, run `bb guide environments`. It
  documents the repo-level `.bb-env-setup.sh` and `.bb-env-teardown.sh` hooks,
  and the `.worktreeinclude` file.
- A new worktree checks out tracked files only. Commit a `.worktreeinclude`
  file at the repo root to list untracked files, such as `.env`, that bb must
  copy from the source checkout. It uses gitignore pattern syntax. bb copies
  the matches before it runs `.bb-env-setup.sh`.

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

## Provider plugin settings

- Read provider settings with `bb plugin config <plugin-id>` and change them
  with `bb plugin config <plugin-id> set <key> <value>`.
- Claude Code's `idleQueryReleaseEnabled` setting opts into closing its native
  process after 30 seconds of quiescence while keeping the bb thread resumable.
  It defaults to `false`; changes apply on the next start, resume, or turn.
- The bundled `rapp` provider speaks only the `rapp/1` protocol. Consumer mode
  discovers the Brainstem's verified GitHub Copilot models; select one of
  those ids or use `brainstem` to follow its current default. Business mode
  exposes the fixed `business-grail` model. Configure the non-secret `grail`
  setting as `consumer` or `business`, and optionally set `endpoint`.
- Consumer mode defaults to the shared local Brainstem and also reads
  `RAPP_BRAINSTEM_URL` and `RAPP_BRAINSTEM_SECRET` from the host daemon.
  Business mode reads `RAPP_BUSINESS_URL`, `RAPP_FUNCTION_KEY`, and optional
  `RAPP_USER_GUID`. Store credentials with `npx bb-app env set`, not in plugin
  settings or endpoint URLs. Endpoint URLs may not contain query parameters or
  fragments, and header credentials require HTTPS outside loopback. Automatic
  startup applies only to plain HTTP `localhost` or `127.0.0.1` `/chat`
  endpoints, and the launched Brainstem does not inherit those five RAPP
  routing and credential variables.
- RAPP persists complete transcripts in canonical `rapp/1` session eggs,
  journals completed responses before delivery, caps responses at 64 KiB, and
  fails before `/chat` when the egg cannot reserve that response capacity.
  Continue in a new thread after the 1 MiB egg limit or an uncertain legacy
  Brainstem completion; bb retains uncertain requests for audit and does not
  replay them automatically.

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
