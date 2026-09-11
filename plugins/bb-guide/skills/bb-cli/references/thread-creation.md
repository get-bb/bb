# Thread, project, environment, and machine creation

## Spawning Threads

- Use `bb thread spawn --project <project-id> --prompt "..."` to create another
  thread. Pass the intended project explicitly; the CLI does not infer it from
  context variables. Omitted execution flags use remembered project defaults;
  without a remembered model, bb resolves the selected provider and its reported
  default model on the target machine.
- Select a target with `--environment`, `--new-environment`, `--base-branch`,
  or `--machine`. Select execution with `--provider`, `--model`,
  `--reasoning-level`, `--service-tier`, and `--permission-mode`.
- List plugin-provisioned environment choices with `bb environment providers`. Add `--project <id>` and optionally `--machine <id>` to omit providers whose declared requirements are unmet. Without a machine, the project listing includes providers structurally eligible on any persistent machine. Git inspection and plugin availability run only for the selected provider and machine during thread creation. `--json` includes each provider's `description` and `icon`, its `requires` facts and its `inputs` JSON Schema or null.
  Pass the selected ID to `--environment-provider`. Add
  `--environment-inputs <json>` only when the provider's schema does not accept
  an empty object; otherwise the CLI supplies `{}` when the flag is omitted.
  `--machine` picks the existing machine.
- List machine providers with `bb machine providers`. Create a
  new provider machine with
  `bb thread spawn --new-machine <provider-id> --environment-provider <id>`.
  For Modal's composed environment, use `--environment-provider modal-sandbox`
  without machine selectors; `--machine-inputs <json>` configures that composed
  machine with optional configured names such as
  `{"preset":"Large","image":"Node 22"}`. These inputs are persisted and
  readable by plugins, so keep credentials in plugin settings and send only
  non-secret configuration or references.
- Omit `--base-branch` for bb's default. Explicit values are exact; use
  `origin/<branch>` for a remote ref. It applies to `--new-environment
worktree` only; a provider takes its branch through `--environment-inputs`.
- Spawn also accepts `--title`, `--origin-kind`, `--source-thread`,
  `--source-seq-end`, `--agent-context-seed`, and `--json`.
- Add repeatable `--file <path>` / `--image <path>` flags for structured prompt
  attachments, and `--section <id>` to add the new thread to a section. These
  flags pass host-readable absolute paths (or relative server-upload tokens)
  through to the runtime; they do not read files on the CLI machine.
- Spawn creates a root thread unless you pass `--parent-thread`.
- Use `bb thread fork <source-thread-id>` to clone a provider session. The
  fork inherits the source conversation in its timeline. It creates an idle
  fork in the source environment by default; add `--prompt`, select an existing
  environment with `--environment`, or create a fresh personal workspace or
  worktree with `--new-environment personal|worktree`. `--base-branch` matches
  spawn for worktrees, while the target machine is always derived from the
  source environment. Anchor with
  `--source-seq-end` on a completed source turn (the clone and inherited
  timeline both end with the turn containing that sequence). Permission mode
  inherits the source thread unless explicitly overridden.
- Pass `--visibility hidden` for background/plugin workers that should remain
  out of sidebar organization without contributing unread/pending favicon
  attention. `bb thread list` excludes them by
  default; pass `--include-hidden` when a hidden worker must be discovered.
  Direct-ID lifecycle and messaging operations remain available. A root thread
  is visible by default; a child thread inherits its parent's visibility, so a
  hidden thread's subagents are hidden too. Pass `--visibility` to override the
  inherited value. A hidden child still reports its turns and blockers to its
  parent thread; only forks and side chats stay silent. Promote or hide an
  existing thread with `bb thread update <id> --visibility visible|hidden`.
- Stop a finished hidden worker with `bb thread stop <id>` to release its agent
  runtime promptly. Archive it first when it no longer belongs in active thread
  lists. Stop preserves the thread and supports a later resume.
- Add remote execution machines from Settings → Machines. Its one-line
  installer stores the account machine credential locally and configures
  both the daemon protocol and agent-launched `bb` CLI to traverse the account
  gate; revoke a lost machine from the getbb.app dashboard. It uses
  the server's exact `/install/bb-app.tgz` artifact and uses the npm registry
  only on a 404. It installs under the enrollment's bb data directory, without
  `sudo` or a global npm configuration, and enables daemon `--auto-update`.
  Newer protocol mismatches update that private install with a persisted
  exponential retry backoff from 5 seconds to 5 minutes, then let
  launchd/systemd restart the daemon. Auto-update never downgrades. To bypass a
  transient backoff, use `bb machine retry-update <id-or-name>`. Remove
  `--auto-update` from the service definition and reload it to opt out.
- Run `bb machine list` to see machine names, IDs, connection status, and last
  seen time (`--json` returns the raw host list). Use `--machine <id-or-name>`
  (alias `--host`) on `bb thread spawn` to run in a personal or unmanaged
  workspace, or combine it with `--new-environment worktree`. Do not combine a
  machine selector with an existing environment ID, which already owns its
  machine.
- Each machine carries a permission limit (`maxPermissionMode`, default
  `full`): the highest permission mode a thread on that machine may run with.
  The server resolves any higher request down to it, and refuses a provider
  that supports no mode under it. Only the owner can change it, on the machine
  page at Settings → Machines → the machine — there is no CLI, SDK, or API
  surface that sets it, and machine credentials are refused — so read it from
  `bb machine list --json` or `bb machine show` and ask the user to change it
  in the app.
- `bb machine providers`, `show`, `join-code`, `rename`, `retry-update`,
  `suspend`, `resume`, `retry-cleanup`, and `remove` cover the Settings →
  Machines lifecycle. Use `bb machine provider-cli status|install` to inspect
  or install provider CLIs on a selected machine.
- `bb updates` runs the default `bb updates status` action. It aggregates BB and provider
  CLI update state across every machine — the CLI counterpart of Settings →
  Updates. `bb updates apply [--machine <id-or-name>]` runs every available
  provider CLI install/update sequentially; update bb-app itself with the
  printed upgrade command or the desktop relaunch.
- Use `bb project create --name <name> --root <path> --machine <id-or-name>`
  to bind a new project's local path to a connected enrolled machine. Use
  `--host` as an alias. Without a selector, the CLI asks its local host daemon.
- `bb project list` preserves the ordinary-project-only default. Pass
  `--include-personal` when the singleton personal project must be discoverable.
- Use `bb project source add <project-id> --machine <id-or-name> --path <path>`
  to register a path on another connected machine. It uses the same selector
  resolution and fallback as project create. Use `--clone` instead of `--path`
  to clone the project's remote there; `--remote-url` and `--target-path` are
  optional clone overrides.
- `bb project paths|files|content|commands` accept `--machine <id-or-name>`
  (`--host` alias) or `--environment <id>`, but not both. An environment uses
  its owning machine and workspace; an explicit machine uses that machine's
  project source; omitting both intentionally uses the primary machine source.
  `bb project content --json` returns UTF-8 text or base64 binary content with
  an explicit `contentEncoding`.
  Project/environment file and path searches honor Git ignore rules, retaining
  tracked and non-ignored untracked files, including hidden files. Non-Git
  workspaces use filesystem listing. `bb file list|paths` can inspect ignored
  files, subject to their exclusion options.
- Use `bb project attachment upload <project-id> --client-file <path>` when the
  bytes live on the CLI machine, including when the CLI and bb server are on
  different hosts. It reads locally and sends multipart bytes through the
  configured `BB_SERVER_URL` (and its enrolled-machine authentication proxy),
  returning the stable server attachment DTO. Optional `--filename` and
  `--mime-type` override inferred metadata. Pass the returned relative `path`
  to thread `--file` or `--image`; image MIME types are capped at 10MB and
  other files at 25MB, and image/heic or image/heif uploads are rejected
  (convert them to JPEG or PNG first). `bb project attachment download <project-id>
<attachment-path> --client-file <path>` writes existing attachment bytes on
  the CLI machine. There is no project-attachment list or per-file remove API.
- `bb project history|reorder` exposes project prompt recall and sidebar order.
- Use `bb project show|update|delete` for one project. Use `bb project source
update|delete` for one source. Use `bb project branches` for branch data.
- Direct environment inspection accepts any environment ID: use `bb environment
status|branches|paths|diff|diff-files|diff-file|diff-patch <id>` and `bb
environment pull-request show <id>`. Diff commands require an explicit target
  and the matching merge-base or commit flags; all support `--json`.
- `bb environment pull-request ready|draft|merge` manages pull-request state;
  `bb environment archive-threads` bulk-archives an environment's threads.
- Use `bb environment show|update|commit` for environment metadata
  and Git changes. Check live help before a commit or merge.
- Spawned child threads inherit permission from explicit flags, then the
  parent thread's last execution, then project defaults. The parent's mode is
  a hard ceiling: an explicit flag can lower it but never exceed it.
- Public permission modes are `accept-edits`, `auto`, and `full`.
  `accept-edits` keeps workspace sandboxing and asks the user to review
  escalations. `auto` keeps the same workspace sandbox while using the
  provider's automatic reviewer. `full` explicitly bypasses sandbox and
  approval protections. Plan mode remains separate. The product default is
  `auto` when no inherited or project default applies.
- Subagents inherit the parent's permission mode by default;
  `--permission-mode full` only takes effect when the parent itself runs full.
- Use `--parent-self` inside a thread to parent the new thread to the current
  thread.
- Use `--parent-thread <thread-id>` to choose another specific parent.
- A parent can live in a different project. Pass `--project <other-id>` with
  `--parent-self` to delegate work in another repository; the child still
  reports back to its parent and stays under its parent's permission ceiling.
- If provider or model choice matters, inspect options with `bb provider list`
  and `bb provider models <provider-id>`. Both accept `--machine <id-or-name>`
  (alias `--host`) or `--environment <id>` to inspect the machine where work
  will run; the selectors cannot be combined. With neither selector they
  intentionally inspect the primary machine.
- Top-level `customModels` in the same `config.json` registers extra picker
  models. Use a provider ID returned by the target host's catalog. Acceptance
  of unlisted models is provider-specific; consult that provider's skill.
  This list has no set/unset CLI surface. Edit the JSON and restart BB.
  The `streamerMode` General preference hides every entry from model lists.
- Top-level `sharedSkillRoots` uses the same relative `user` and `project`
  paths. bb lists these skills as read-only. bb injects them into each provider,
  so one physical skill collection can support bb and standalone provider CLIs.

Give spawned threads clear prompts: objective, constraints, expected deliverable,
validation to perform, and what to report back. Ask for outcome, changed files
or artifacts, validation performed, and blockers.

`bb environment show <id>` includes the core-owned lifecycle phase, retirement deadline, and teardown status/attempt/message. Archive or delete the last live thread to begin its provider's retirement grace; unarchive cancels pending retirement. Teardown failures retry automatically. Checkout policy keeps its directory indefinitely.

### Standalone machine creation

`bb machine create --provider <id> [--key <idempotency-key>] [--inputs <JSON>]
[--no-wait] [--json]` creates a machine without a thread. Omitted
inputs are null and must satisfy the provider schema; omitted key is generated
by the server. Supply a stable key to recover the same creation across retries.
Creation is durable. `--no-wait` returns the host ID; `bb machine show
<host-id>` inspects it and `bb machine remove <host-id>` cancels it. SIGINT
stops following and exits with status 130 while creation continues.

`bb machine show <id-or-name> --json` includes `providerDetails` inventory and
estimates when available. Suspend requires idle threads and no open terminals;
empty machines use the provider’s opt-in idle timeout. Resume waits for pending
suspension and leaves an already-active machine active.

### Local machine lifecycle

`install-machine.sh --start|--stop|--uninstall --host-id <id>` operates on that machine's local
installation. Optional `--server-url` and `--data-dir` assert its identity and
installation location; BB_DATA_DIR is also an assertion, never permission to
remove another installation. Uninstall checks ownership before stopping its
service, releasing its port reservation and deleting its private files.

### Private machine enrollment

Use `bb machine enroll --bootstrap-file <path>` or `--bootstrap-env <NAME>` on a machine that already has the CLI. Core prepares the versioned bundle; transport it through a private file or environment/stdin, never command arguments, logs, resource JSON, or a transcript. Enrollment refuses a different existing host/server identity and succeeds without another exchange when the same identity is already enrolled. The installer accepts `--bootstrap-env <NAME>` and invokes this command after installing bb. Machine state defaults to `~/.bb-machines/<server-host>`; an explicit `BB_DATA_DIR` must be isolated from the default BB instance. For remote non-login commands, discover `bb` on PATH and fall back to `~/.local/bin/bb`.

Delivered enrollment bundles from v1 remain valid until their expiry. The CLI accepts both file and environment forms, upgrades the bundle to v2 headers locally, and persists legacy Connect redemption before enrollment so a retry reuses it. The installer upgrades v1 environment bundles before authenticated artifact downloads.

The core `manual` provider appears as Manual machine setup. `bb machine create --provider manual` waits for the enrollment command to become ready, prints it once, and follows; `--no-wait` returns the creating host ID. Commands are no longer available after enrollment or removal. Manual machines never suspend or retire automatically. Removal revokes access; run the original installer with `--uninstall --host-id <id>` on the target using its original data directory.

For paths a provider owns, bb runs `.bb-env-setup.sh` after create and
`.bb-env-teardown.sh` before remove on that machine, with separate 15-minute
timeouts. Setup failure fails the launch with output in provisioning progress;
teardown script failure is logged and removal continues. Attaching a user-maintained project checkout or personal workspace skips both
hooks. A fresh core clone on a new machine is owned and runs the hooks. Providers do not run these
core hooks themselves.
Thread startup does not validate agent credentials, fingerprint the checkout, or install agent CLIs.

`bb machine list --json` includes lifecycle phase, progress, and any suspension or resume error.
Maintenance interrupts active turns and closes terminals before saving. Submit a
new continuation turn after restore; interrupted turns are never reported successful.

Resuming a machine restores its provider state without rerunning environment setup.
