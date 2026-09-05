# Scheduled agent and script automations

Status: **source-documented; live execution pending**.

## Setup and entry points

Open Extensions/Automations or the Automations plugin panel; bb automation --help. Use a disposable project and short synthetic commands.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/automations/package.json`
- `plugins/automations/src/server.ts`
- `plugins/automations/app.tsx`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Browse, detail, and history | Open the list, browse templates, inspect an automation and its run history; reload a detail/edit deep link. | Identity, schedule, status, and recorded runs remain consistent across routes and CLI. |
| Create and edit | Create a harmless automation, then edit its name, prompt/script, schedule and execution options. | Validated persisted configuration matches the form and next run; canceled edits do not apply. |
| Cron and timezone | Schedule a near-future cron run in a selected timezone and inspect next-run calculations across a DST boundary. | The schedule represents the chosen local time and timezone; invalid cron input is rejected. |
| One-shot time and delay | Create once-at and once-after fixtures and wait for dispatch. | Each runs once at the intended time and does not become a recurring job. |
| Agent targets | Exercise a new thread, reprompt, and managed-worktree target with supported model/permission options. | The resulting thread, environment, parent linkage, and execution settings match the automation. |
| Script runtimes | Run harmless bash, sh, node, and python fixtures producing known stdout/stderr and exit codes. | History records the correct exit and output; successful silent scripts do not fabricate assistant messages. |
| Pause, resume, run now, delete | Pause before dispatch, resume, run manually, then delete a fixture. | Paused schedules do not fire; manual runs and deletion have the documented scope and history. |
| Failure and recursion | Use a failing script and have an automation child attempt to create another automation. | Failure remains inspectable; child automation creation is denied rather than recursively scheduling work. |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Inspect the
registered plugin command and SDK call before claiming agent parity; do not
invent a plugin CLI where the feature uses a core command instead. Preserve
failed attempts and missing prerequisites as unverified results. Restore plugin
configuration and remove only this run’s fixtures, registrations, and workers.
External account changes use authorized disposable targets.
