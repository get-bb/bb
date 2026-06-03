---
kind: instruction
title: bb Guide - Manager Templates
summary: Manager storage template reference.
intent: Explain how manager-templates seed new manager thread storage.
editingNotes: Keep this factual against manager-storage-templates.ts and the manager hire API/CLI.
---
Manager templates

Manager templates are named bundles of starter files for manager thread
storage. When bb starts a new manager thread, the server resolves a template
and recursively copies regular files into the new manager's thread storage
before the host daemon receives the initial `thread.start` command. This is how
a fresh manager can boot with starter files such as `PREFERENCES.md`,
`ASYNC.md`, notes, plans, or other user-authored storage files.

Directory layout:

```text
<bb-data-dir>/manager-templates/
  active
  default/
    PREFERENCES.md
    ASYNC.md
  sawyer-next/
    PREFERENCES.md
    plans/
      kickoff.md
```

In this guide, `<bb-data-dir>` is your bb data directory. Packaged installs
default to `$HOME/.bb`. In source development, `pnpm dev` sets `BB_DATA_DIR`
to the current checkout's data directory; use `$BB_DATA_DIR/manager-templates/`.
Override packaged installs with the `BB_DATA_DIR` env var.

`active` is a plain text file. bb reads the first line, trims it, and uses it
as the template name. Missing or empty `active` means `default`. An invalid
name logs a warning and falls back to `default`. Template names must be one
directory name: 1-128 characters, no `/` or `\`, and not `.` or `..`.

Each subdirectory is a template set. The directory name is the template name.

What gets seeded:

bb recursively copies every regular file from the selected template directory
into `<bb-data-dir>/thread-storage/<manager-thread-id>/`. There is no filename
allowlist. Symlinks and other non-regular files are ignored. Existing
destination files are left as-is; seeding does not overwrite, delete, or
refresh files.

There is no bundled app overlay. If the selected template directory is missing
and the selected template is not `default`, bb logs a warning and seeds no
template files.

When it runs:

Seeding happens while building the manager `thread.start` command, normally
after `POST /api/v1/projects/:id/managers` or `bb manager hire` creates the
manager and the environment is ready. It happens before the host daemon starts
the provider thread. The copy operation is safe to run more than once because
existing files are skipped; it is not a refresh mechanism for managers that
already have storage.

Selecting a template:

For one manager, pass a template name at hire time:

```bash
bb manager hire --template sawyer-next
```

`--template` overrides the `active` pointer for that manager creation only.

For future managers by default, edit the active pointer:

```bash
DATA_DIR="${BB_DATA_DIR:-$HOME/.bb}"
mkdir -p "$DATA_DIR/manager-templates"
printf 'sawyer-next\n' > "$DATA_DIR/manager-templates/active"
```

There is no dedicated CLI command today for changing the global active
template.

Creating a template:

```bash
DATA_DIR="${BB_DATA_DIR:-$HOME/.bb}"
mkdir -p "$DATA_DIR/manager-templates/sawyer-next"
$EDITOR "$DATA_DIR/manager-templates/sawyer-next/PREFERENCES.md"
printf 'sawyer-next\n' > "$DATA_DIR/manager-templates/active"
```

Promoting current preferences:

Managers see their storage path in runtime context. To save the current
manager's `PREFERENCES.md` to the default template:

```bash
DATA_DIR="${BB_DATA_DIR:-$HOME/.bb}"
THREAD_STORAGE="/absolute/path/from-manager-runtime-context"
mkdir -p "$DATA_DIR/manager-templates/default"
cp "$THREAD_STORAGE/PREFERENCES.md" \
  "$DATA_DIR/manager-templates/default/PREFERENCES.md"
printf 'default\n' > "$DATA_DIR/manager-templates/active"
```

Copy `ASYNC.md`, notes, plans, or other starter files into the same template
directory when those files should be shared too.

Limitations and gotchas:

- There is no dedicated CLI or UI for changing `active`.
- Template file contents are not schema-validated before copying.
- Symlinks and other non-regular files are ignored.
- Existing thread storage files are never overwritten by seeding.
- Missing selected non-default templates do not fall back to `default`; bb logs
  a warning and seeds no template files.

Related guides:

  bb guide overview
  bb guide managers
  bb guide app
  bb guide async
