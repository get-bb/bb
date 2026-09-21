---
kind: instruction
title: bb Terminal Guide
summary: Creating and managing persistent terminals across thread, environment, and machine scopes.
intent: Help agents route terminal sessions explicitly and manage them by terminal ID.
editingNotes: Keep scope selectors and ID-only commands aligned with bb terminal --help.
---
Terminal commands

Use terminals for long-running commands that should stay alive for the user,
such as dev servers, watch tasks, REPLs, and database consoles. A terminal is a
real persistent PTY and appears in the bb UI.

List and create require exactly one explicit scope:

  bb terminal list --thread <thread-id>
  bb terminal list --environment <environment-id>
  bb terminal list --machine <id-or-name> [--cwd <path>]

  bb terminal create --thread <thread-id> --command "pnpm dev"
  bb terminal create --environment <environment-id>
  bb terminal create --machine <id-or-name> [--cwd <path>]
    --host <id-or-name>                   Alias for --machine
    --title <title>                       Display title
    --cols <n>                            Initial terminal columns
    --rows <n>                            Initial terminal rows
    --shell <id>                          Interactive shell to launch (see below)
    --attach                              Attach after creating
    --json                                Print machine-readable output

Machine names are resolved to an explicit machine ID. No scope defaults to the
server machine, and --cwd is valid only with --machine or --host.

<!-- bb-fork(windows): the shell choice is a fork feature; see docs/windows.md. -->
Some machines offer more than one shell. Ask the machine what it can launch,
then pick one for an interactive terminal:

  bb terminal shells --machine <id-or-name>
    --host <id-or-name>                   Alias for --machine
    --json                                Print shell ids, labels, paths, and the default

  bb terminal create --machine <id-or-name> --shell <shell-id>

Only a native Windows machine reports a list today: PowerShell 7, Windows
PowerShell, and Git Bash, each installed copy. The id marked default is what a
terminal launches without --shell. `--shell` is valid only for an interactive
shell, so combining it with --command or a positional command is rejected. An
unknown or removed shell id falls back to the machine default instead of
failing the launch.

Some machines offer more than one shell. Ask the machine what it can launch,
then pick one for an interactive terminal:

  bb terminal shells --machine <id-or-name>
    --host <id-or-name>                   Alias for --machine
    --json                                Print shell ids, labels, paths, and the default

  bb terminal create --machine <id-or-name> --shell <shell-id>

Only a native Windows machine reports a list today: PowerShell 7, Windows
PowerShell, and Git Bash, each installed copy. The id marked default is what a
terminal launches without --shell. `--shell` is valid only for an interactive
shell, so combining it with --command or a positional command is rejected. An
unknown or removed shell id falls back to the machine default instead of
failing the launch.

All other operations need only the terminal ID. They also accept the scope
flags above and ignore them, so a command built for `list` or `create` still
runs:

  bb terminal show <terminal-id>
  bb terminal attach <terminal-id>        Ctrl-B d detaches
  bb terminal send <terminal-id> --text <text> [--enter]
    --stdin                               Read bytes from stdin instead of --text
  bb terminal resize <terminal-id> --cols <n> --rows <n>
  bb terminal rename <terminal-id> <title>
  bb terminal restart <terminal-id>       Atomically replaces it with a shell; does not replay the original command
  bb terminal close <terminal-id> [--if-clean]

  bb terminal output <terminal-id>
    --since-seq <n>                       Read output chunks from a sequence
    --tail-bytes <n>                      Bound output to latest N bytes
    --limit-chunks <n>                    Bound output to latest N chunks
    --json                                Print chunks, nextSeq, truncated, status, exitCode, and closeReason

  Output stays readable after the command exits: the machine keeps a finished
  terminal's scrollback for 30 minutes, until its daemon restarts, or until many
  newer terminals have exited. For an exited terminal the output is followed by
  `Terminal <id> exited with code N` on stderr. Once the scrollback is gone,
  output fails with `terminal_output_unavailable` and says why.

  bb terminal wait <terminal-id>
    --contains <text>                     Wait for new output containing text
    --regex <pattern>                     Wait for new output matching regex
    --exit                                Wait until the terminal exits
    --from-start                          Include existing scrollback
    --timeout <duration>                  Seconds, or a duration with a unit: 90s, 5m (default: 30s)
    --poll-interval <duration>            Milliseconds, or a duration with a unit (default: 500ms)

  When the terminal exits before the text appears, wait stops at once with exit
  code 124, the terminal's exit code, and the last output it printed. `--exit`
  prints the exit code.

For a dev server, prefer:

  bb terminal create --thread <thread-id> --title "pnpm dev" --command "pnpm dev"
  bb terminal wait <terminal-id> --contains "Local:" --timeout 120

Do not run long-lived servers as one-off foreground commands when the user will
need to inspect logs, refresh the page, or stop the process later.
