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
    --attach                              Attach after creating
    --json                                Print machine-readable output

Machine names are resolved to an explicit machine ID. No scope defaults to the
primary machine, and --cwd is valid only with --machine or --host.

All other operations need only the terminal ID:

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
    --json                                Print chunks, nextSeq, and truncated

  bb terminal blocks <terminal-id>
    --since-seq <n>                       Read output chunks from a sequence
    --tail-bytes <n>                      Bound the read to latest N bytes
    --limit-chunks <n>                    Bound the read to latest N chunks
    --json                                Print index, command, cwd, exit code, output

  bb terminal export <terminal-id>
    --block <index>                       Index from blocks; defaults to the latest
    --out <path>                           File to write; defaults to the command slug
    --json                                Print the block and the written path

  bb terminal wait <terminal-id>
    --contains <text>                     Wait for new output containing text
    --regex <pattern>                     Wait for new output matching regex
    --exit                                Wait until the terminal exits
    --from-start                          Include existing scrollback
    --timeout <seconds>                   Timeout
    --poll-interval <ms>                  Polling interval

For a dev server, prefer:

  bb terminal create --thread <thread-id> --title "pnpm dev" --command "pnpm dev"
  bb terminal wait <terminal-id> --contains "Local:" --timeout 120

Do not run long-lived servers as one-off foreground commands when the user will
need to inspect logs, refresh the page, or stop the process later.

Captured commands

bb installs shell integration in zsh and bash terminals it starts, so each
command the user runs is recorded with its working directory, exit code, and
output. Use blocks to find a command and export to write it as Markdown:

  bb terminal blocks <terminal-id>
  bb terminal export <terminal-id> --block 2 --out /tmp/failing-build.md

Only commands run after the terminal started are captured, and only while the
output remains in daemon scrollback. Other shells, `bb terminal create
--command`, and terminals opened in an external terminal app are not captured.
In the UI, the Add to chat button on a command's prompt line attaches the same
Markdown to the composer.
