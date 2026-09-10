# CLI, Guide, And Skill

Keep the discoverable surfaces in sync whenever you add or change a `bb` CLI command, flag, or a user-facing configuration knob (env var, `.bb/` workspace file, settings field):

- Update the in-CLI guide templates under `packages/templates/src/templates/bb-guide-*.md`, turbo regenerates `packages/templates/src/generated/templates.generated.ts` (not committed) before every build, typecheck, and test task.
- For core commands, update the bb-cli skill at `plugins/bb-guide/skills/bb-cli/SKILL.md` or its relevant reference. For plugin commands and settings, update the owning plugin's `skills/<name>/SKILL.md` or supporting reference, including built-in plugins. Keep plugin-specific behavior out of the core CLI skill. Configuration knobs also belong in `docs/configuration.md`.
- Match the existing chapter/section style; keep entries concise and accurate against the implementation.

Environment lifecycle hooks are core policy: bb runs `.bb-env-setup.sh` after
an environment provider creates an owned path, and `.bb-env-teardown.sh` before
provider removal. Each has a 15-minute timeout; setup failure fails provisioning,
while reported teardown script failure does not block removal. Transport failure
keeps cleanup pending until the daemon confirms hook termination. Hook identity
and completion persist across server restarts. Attached checkout and
personal-workspace paths skip both hooks. These semantics apply equally to CLI,
SDK, and app launches; see [worktrees.md](worktrees.md).

The Machines settings creation drawer prepares an existing-machine command when access is ready, otherwise shows setup guidance. After access is ready, Choose a machine provider reviews provider inputs and launches through `hosts.experimental_create`/`bb machine create`. A machine belongs to no project; projects reach it later through project sources.

Machine maintenance state is part of `bb machine list --json`; there is no
separate machine lifecycle command. Keep the machine guide and bb-cli command
index aligned with this surface.

Local installed-daemon start, stop, and uninstall operations are flags on
`install-machine.sh`, not `bb machine` subcommands.

Modal connection and machine commands are documented in [modal-sandboxes](../plugins/environment-modal-sandbox/skills/modal-sandboxes/SKILL.md). `bb modal image show [--json]` reads the Dockerfile shown in settings; `bb modal image set --file PATH [--json]` saves a validated plugin-wide override and `bb modal image reset [--json]` restores the bundled default for future machines; `bb modal account inspect --json` checks credentials; `bb machine create --provider modal-sandbox --json` automatically prepares the bundled image and installs the daemon. `bb machine remove MACHINE --yes` explicitly removes compute and private snapshots.

`bb thread spawn --machine-inputs <json>` configures either an explicit
`--new-machine` or the machine provider owned by a composed
`--environment-provider`; a composition rejects separate machine selectors.

Modal image debugging uses `bb modal image build`, `bb modal sandbox run`, `bb modal sandbox exec ID [--json] -- COMMAND...`, and `bb modal sandbox stop ID`. Debug compute expires after 30 minutes and skips BB enrollment and project setup. See the plugin skill for output limits and typed RPC equivalents.
