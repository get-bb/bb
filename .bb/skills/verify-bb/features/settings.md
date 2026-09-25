# Settings, keyboard, appearance controls, and usage

Status: **2026-09-05: 6 passed, 7 partial/blocked**. See [the audit](../MAINTENANCE.md) and [per-recipe ledger](../validation-2026-09-05.json).

## Setup and entry points

Fresh browser and isolated server. Record original settings and restore every mutation. Use Settings navigation; inspect CLI help for supported values.

Follow the main skill’s isolated launch, doctor, evidence, and cleanup rules.
CLI examples below omit the `node apps/cli/dist/index.js` prefix; use that source CLI
against the same dev instance. Resolve IDs with list/show and inspect the named
command’s `--help` before mutation. Use fresh browser snapshots for controls.

## Source

- `apps/app/src/views/SettingsView.tsx`
- `apps/app/src/components/settings/settings-sections.ts`
- `apps/app/src/components/settings/KeyboardSettingsSection.tsx`
- `packages/domain/src/app-settings.ts`
- `packages/domain/src/experiments.ts`
- `apps/cli/src/commands/settings.ts`
- `apps/cli/src/commands/theme.ts`
- `apps/app/src/components/settings/AiServicesSettingsSection.tsx`
- `apps/server/src/services/ai/ai-tasks.ts`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| General preferences | Toggle Navigate to threads on creation, Markdown formatting, follow-up Queue/Steer, Rewrite localhost links, Streamer mode, and Allow fast service tier individually; reload and exercise their effect. For the fast tier setting, submit an explicit fast selection through CLI/API in both states and inspect the resolved queued or accepted execution tier. | Each preference changes the named behavior, persists with its actual owner, and restores. Client-local preferences are not assumed to be in server config. With fast disallowed, the picker hides Fast mode and new execution resolves to default; with fast allowed, an explicit fast selection remains fast. |
| Managed branch prefix | Set a valid prefix and create a disposable managed worktree; try an invalid Git prefix. | New branch uses the configured prefix; invalid input is rejected without saving. |
| Provider order and default | Reorder providers and set a default; open a new composer and inspect provider list/models on the selected host. | Ordering/default affects the correct context and does not advertise unavailable models. |
| Keyboard overrides | Record a shortcut, disable it, restore it, test conflicting bindings and held-modifier hints; compare settings keyboard list/set/reset/hints. | Only the intended action fires; text input remains usable; overrides and reset survive reload. |
| Theme and palette | Run appearance; additionally cycle every built-in palette, install a synthetic custom theme, and use theme list/dir/set/show/reset. | Theme catalog, active palette, and loaded styles agree; invalid theme selection fails cleanly. |
| Favicon and split dimming | Change/reset favicon through UI and theme favicon; toggle Fade inactive splits with two panes. | Favicon updates without changing palette; only inactive splits dim. |
| File openers and local editor | Configure file/directory defaults, extension-specific openers, and local editor integration; open a fixture through each. | Chosen handler and line/path are correct; reset/default fallbacks remain usable. |
| Voice configuration | Load microphones, select one, pick the Voice input service in Settings → AI services, and transcribe a harmless fixture. | Choice is applied to recording/transcription; the microphone hides when the selected service is not ready or Voice input is Off. |
| Usage | Inspect Usage limits and settings usage; compare provider-reported windows. | Unavailable data remains unavailable rather than zero. |
| AI services picker | Open Settings → AI services. For Thread titles and Commit messages pick Automatic, a registered service, and Off; press Test; mirror with `settings ai-services`, `settings ai-services set <task> <choice>`, and `settings ai-services test <task>`. Create a thread and use the Commit action under each choice. | Each row lists only services that handle the task, with their status line; Automatic names the first ready builtin service; a picked service is used alone and a failure falls back to prompt-text titles and `bb: automated commit`; Off never calls a service; a failed Test shows the reason in the row; choices persist across reload and match the CLI. |
| Experiments | Exercise changelogPreview, mobileApp, serverMove, and sidebarProgressiveDisclosure on/off in isolated data. | Only the named feature gate changes; disabled routes/actions fail or disappear as designed; state restores. |
| Debug events | Toggle Show unhandled provider events and render a trusted unsupported-event fixture. | The diagnostic row visibility follows the toggle without changing persisted event data. |
| Community and update surfaces | Open Community links, version/update view, changelog, and CLI skills status. | Destinations and installed/latest status are correct; viewing does not perform an update. |
| Configuration reload | Change an owned test configuration value and invoke settings reload. | The running app observes supported reloadable values and reports invalid configuration without losing working state. |

## Evidence and cleanup

Record a result for each row separately, including the chosen entry point,
initial state, action, resulting state, and relevant persisted value. Repeat
mutations through the available agent interface to establish parity. Preserve
failed attempts and prerequisites; source documentation is not a passing test.
Restore preferences and remove only the fixtures and sessions created by this
recipe. External writes require a disposable test target and task authorization.

## Project machine environment verification

In isolated data, create two projects and use the primary host plus one connected
secondary host.
Set a global variable through `bb machine env set NAME` using stdin. Open
Settings → Environment variables and switch its scope control from All projects
to one project. Confirm inherited rows are masked and read-only, use a
row's Override action, and confirm the override replaces that inherited row in
place rather than appending a new row. Save it, open that project's settings,
and confirm the same saved state there. Remove the override, save, and confirm the
inherited row returns. Repeat with an empty string, CLI `--project <id>`, and
SDK project methods. On both hosts, confirm global variables apply and each
project's new terminals,
agent turns, source/setup/teardown processes, and project-scoped host RPC
receive only their own overrides; changing/removing overrides refreshes
subsequent launches. Open the scope picker at compact width, confirm the app
root is never inert or aria-hidden and content appears after drawer animation
begins, and repeat in iOS Simulator Safari. Existing terminals retain old
values. Confirm automatic GitHub credentials are forwarded to the secondary
host but not round-tripped to the primary host. Settings reads and provider
environment diagnostics must not expose saved values. This recipe does not
verify a platform or launch path unless that subcheck actually runs.

Import a .env value whose name matches an inherited variable and confirm it
replaces that row in place. Verify quoted backslashes, multiline values, and
empty values. Malformed assignments must keep Import disabled; importing only
stages edits until Save variables is clicked.
