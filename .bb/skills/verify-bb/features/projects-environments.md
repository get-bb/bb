# Projects, sources, environments, and Git

Status: **source-documented; not live-verified in the initial smoke pass**.

## Setup and entry points

A synthetic Git repo with a committed main branch, a feature branch, an untracked file, and a modified tracked file. Use project actions/settings and the composer Environment picker.

Follow the main skill’s isolated launch, doctor, evidence, and cleanup rules.
CLI examples below omit the `pnpm --silent bb:dev` prefix; use that source CLI
against the same dev instance. Resolve IDs with list/show and inspect the named
command’s `--help` before mutation. Use fresh browser snapshots for controls.

## Source

- `apps/app/src/views/ProjectSettingsView.tsx`
- `apps/app/src/components/project/ProjectActionsMenu.tsx`
- `apps/cli/src/commands/project.ts`
- `apps/cli/src/commands/environment.ts`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Create and rename projects | Run the local-project recipe, then rename in Project settings and reload; compare project show/update. | Project identity remains stable while its name changes. |
| Multiple sources and default source | Add a second synthetic local source, change its host/path/default flag, then remove it with project source operations. | Sources persist, the intended default is selected, and the remaining source is still usable. |
| Git remote projects | Create a project from a disposable remote using project create --help and the UI source controls. | Clone/provisioning uses the requested remote and branch; invalid remote errors do not create a usable fake checkout. |
| Recent repository import | On a disposable host home with synthetic recent repos, run the offered import action and inspect project list. | Only discovered candidates are imported; duplicates and missing paths are handled. Do not use real recent repos as fixtures. |
| Local versus managed worktree | Create one thread with Work locally and one with a new worktree and selected base branch. | Environment path, branch, and lifecycle match the selection; edits in the managed worktree do not affect the original checkout. |
| Reuse and switch environments | Select an existing environment for another thread; use environment update for supported metadata/path changes after reading help. | Both thread details identify the intended environment; invalid paths fail without silently changing scope. |
| Environment status and branch discovery | Compare Info panel with environment show/status/branches and project branches for the same source. | Branch, dirty state, host, and path agree; disconnected or missing workspaces show an actionable error. |
| Diff views and selected patches | Open Diff with tracked edits, additions, renames, and deletions; use environment diff/diff-files/diff-file/diff-patch. | File lists, old/new contents, line numbers, and selected patches match git diff including untracked changes as supported. |
| Commit | Commit only a synthetic selected change through the supported UI/CLI action; inspect git show and remaining diff. | Commit message and file scope are correct; unrelated dirty work remains. |
| Pull requests | With a disposable authenticated remote PR, inspect environment pull-request show; exercise ready, draft, and merge only in that test repo. | Forge state agrees with UI/CLI; missing auth/checks/conflicts produce explicit failures. Never run this on a user PR for documentation. |
| Archive environment threads | Create threads in two environments and invoke environment archive-threads for one. | Only that environment’s active threads are archived. |
| Project attachments and history | Upload/download a synthetic file with project attachment; compare bytes; inspect project history and workspace file/path/content commands. | Returned content and history belong to the chosen project/host; missing files report failure. |
| Execution defaults | Set project defaults for environment/provider/model/permissions, open a new root draft and override one choice before sending. | Resolved defaults populate once, explicit draft choices win, and thread details reflect the actual execution options. |
| Clone destination and folder discovery | Browse an empty test host directory and inspect suggested clone path, path existence and invalid destination feedback. | Folder and clone suggestions target the chosen host; existing paths are not overwritten by a failed clone. |
| Delete project | Delete a disposable project through its confirmation flow, then inspect projects and its threads. | Deletion scope matches the confirmation; cancel leaves all state intact. |

## Evidence and cleanup

Record a result for each row separately, including the chosen entry point,
initial state, action, resulting state, and relevant persisted value. Repeat
mutations through the available agent interface to establish parity. Preserve
failed attempts and prerequisites; source documentation is not a passing test.
Restore preferences and remove only the fixtures and sessions created by this
recipe. External writes require a disposable test target and task authorization.
