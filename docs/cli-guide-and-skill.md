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

The Machines settings creation drawer prepares an existing-machine command when access is ready, otherwise shows setup guidance. After access is ready, Choose a machine provider lets users select a project before reviewing provider inputs; the selected project is passed to the same `hosts.submit`/`bb machine create --project` launch surface.

Modal connection and machine commands are documented in [modal-sandboxes](../plugins/environment-modal-sandbox/skills/modal-sandboxes/SKILL.md). `bb modal image show [--json]` reads the bundled Dockerfile shown in settings; `bb modal account inspect --json` checks credentials; `bb machine create --provider modal-sandbox --project PROJECT --json` automatically prepares the bundled image and installs the daemon. `bb machine lifecycle --remove --yes` complements keep/automatic-retention controls.
