---
kind: instruction
title: bb Terminal Guide
summary: Running commands on other machines with bb exec, and managing persistent terminals across thread, environment, and machine scopes.
intent: Help agents run one-shot commands on another machine, route terminal sessions explicitly, and manage them by terminal ID.
editingNotes: Keep scope selectors, exec exit codes, and ID-only commands aligned with bb exec --help and bb terminal --help.
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
  bb terminal create --machine <id-or-name> [--cwd <path>]   (alias: start)
    --host <id-or-name>                   Alias for --machine
    --title <title>                       Display title
    --id <terminal-id>                    Use this ID (term_ plus 10 characters); fails if it exists
    --cols <n>                            Initial terminal columns
    --rows <n>                            Initial terminal rows
    --attach                              Attach after creating
    --json                                Print machine-readable output

Machine names are resolved to an explicit machine ID. No scope defaults to the
server machine, and --cwd is valid only with --machine or --host.

A terminal runs the machine's own shell: $SHELL (then zsh, bash, sh) on macOS
and Linux; on Windows, PowerShell 7 when `pwsh` is on PATH, otherwise Windows
PowerShell, otherwise cmd. Write --command in that shell's syntax. To run a
program with arguments without knowing the shell, pass them after `--`
(`bb terminal create --thread <id> -- pnpm test "my file.ts"`): the machine
quotes each argument for its own shell. `send --enter` presses Enter (a carriage
return), which every one of those shells accepts. The terminal's exit code is
the command's own exit code on every shell.

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
  bb terminal close <terminal-id> [--if-clean]   (alias: stop)

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
  prints the exit code. Text and regex matching ignore colors and other
  terminal escapes, so `--contains "Local:"` matches a bold `Local`.

For a dev server, prefer:

  bb terminal create --thread <thread-id> --title "pnpm dev" --command "pnpm dev"
  bb terminal wait <terminal-id> --contains "Local:" --timeout 120

Do not run long-lived servers as one-off foreground commands when the user will
need to inspect logs, refresh the page, or stop the process later.

Commands on another machine

Use your own shell for commands in your current workspace. Use `bb exec` to run
a command on another machine and get its output and exit code in one call:

  bb exec --machine <id-or-name> --cwd <absolute-path> -- <program> [args...]
  bb exec --environment <environment-id> -- <program> [args...]
    --host <id-or-name>                   Alias for --machine
    --yield-after <duration>              Return a still-running command after this long (default: 30s); 0 returns at once
    --contains <text>                     Return once the output contains text
    --regex <pattern>                     Return once the output matches regex
    --max-output-bytes <n>                Return the last N bytes of output (default: 65536)
    --id <terminal-id>                    Run under this ID (term_ plus 10 characters); a retry with it fails instead of running twice
    --title <title>                       Terminal title (default: the command)
    --json                                Print terminalId, status, observation, exitCode, closeReason, output, truncated, and nextSeq

  bb exec wait <terminal-id>              Keep observing a command that bb exec left running
    --since-seq <n>                       Return and match only output from the previous result's nextSeq
    --yield-after, --contains, --regex, --max-output-bytes, --json   As for bb exec

Pass the program and its arguments after `--`; the machine quotes them for its
shell, as `terminal create -- ...` does. Write `sh -c '...'` (or the machine's
shell) for pipes and `&&`. The command runs in a new terminal on that machine,
so it appears in the bb UI and `bb terminal` commands work on its ID. It runs in
a PTY: stdout and stderr arrive interleaved in one `output`, colors and progress
redraws are removed from it, and commands that page or prompt (`git log`,
`npm init`) wait for input. Use `git --no-pager` or the command's
non-interactive flags.

The exit code says how it ended:

  the command's exit code                 It finished
  0                                       --contains or --regex matched; it may still be running
  1                                       It exited before the text appeared, or its terminal was closed before it finished
  124                                     Still running after --yield-after

Returning never stops the command. Continue with the `bb exec wait` line printed
on stderr, stop it with `bb terminal close <terminal-id>`, or read all of its
output with `bb terminal output <terminal-id>`. After the machine discards a
finished command's output, `bb exec wait` still reports its exit code, with
`output` null. When `bb exec` fails without
printing a result, check `bb terminal list --machine <id-or-name>` before
running it again, or pass `--id` so a retry cannot run it twice.

In the app, Find in terminal (`terminal.find`; Cmd+F on macOS, Ctrl+Shift+F
elsewhere) searches the focused terminal's scrollback; Enter and Shift+Enter
move between matches, Match case toggles case sensitivity, and Escape closes
find and returns focus. Rebind it in Settings → Keyboard or with
`bb settings keyboard set terminal.find <shortcut>`; the SDK's
`system.updateKeyboardSettings` accepts the same command ID.

Terminal URLs and file paths open with Cmd+click on macOS, Ctrl+click
elsewhere, or a tap on touch screens. Printed file paths, including `path:line`
and `path:line:column`, open in bb's file viewer on the terminal's machine.
Relative paths use the shell's OSC 7 working directory when reported, otherwise
the session's initial directory. Quoted paths may contain spaces.
