---
kind: instruction
title: bb Guide JSON Output
summary: The --json contract for core bb commands, including output shapes and the error envelope.
intent: Let agents parse bb output on the first try instead of probing its shape.
editingNotes: Every shape here must match real command output. The CLI help JSON lines come from apps/cli/src/json-shapes.ts, and a CLI test fails when that file and this chapter disagree.
---
JSON output

Every core command accepts --json except the plugin authoring tools (`bb plugin
new`, `types`, `migrate`, `build`, `dev`, `run`, `logs`, `update`). Success
prints one JSON value on stdout and exits 0. Nothing else is written to stdout.

Errors

A failed command exits non-zero. With --json it prints this envelope on stdout
and still prints the readable message on stderr:

  {"ok": false, "error": {"code": "unknown_option", "message": "...", "hint": "..."}}

`hint` is present only when bb knows the fix: the flag to add, the nearest
command or option, or the usage line. Codes for mistakes in the invocation:
unknown_command, unknown_option, missing_required, unexpected_argument,
invalid_value, missing_command. A failed server request uses the server's error
code, such as thread_not_found or terminal_output_unavailable; otherwise the
code is http_<status> or error.

Parse stdout only. `2>&1` mixes the readable message into the JSON, and
`2>/dev/null` hides it. Check the exit code, or test `.ok == false`, before
reading fields.

Shapes

List commands do not share one wrapper. Most print a bare array; a few wrap it.
Fields beyond those shown exist; these are the ones scripts use.

  bb status --json
    {project: {id, name} | null, thread: {id, status, title, parentThreadId, environment: {hostId, display} | null} | null, childThreads: [{id, status, title}] | null, pendingTodos, pluginsNeedingAttention: [{id, status}], dataDir}

  bb thread list --json
    [{id, projectId, environmentId, providerId, title, status, lifecycle, parentThreadId, sectionId, visibility, archivedAt, pinnedAt, createdAt, updatedAt, activity}]    (bare array; title can be null)

  bb thread show <id> --json
    {thread: {id, status, title, projectId, environmentId, parentThreadId, ...}, environment: {id, hostId, path, branchName, ...} | null, pendingTodos}    (thread fields are under .thread)

  bb thread log <id> --json
    [{id, seq, type, createdAt, threadId, scope, data}]    (bare array of raw events, oldest first; page with --after-seq <seq>)

  bb thread output <id> --json
    {output}

  bb thread spawn ... --json
    the created thread: {id, status, title, projectId, environmentId, ...}

  bb thread tell <id> ... --json
    {threadId, ...delivery outcome}

  bb thread wait <id> --json
    {threadId, matched: true, target}

  bb thread count --json
    {total}

  bb thread search <query> --json
    {active: {total, results}, archived: {total, results}, draft?: {total, results}}    (draft group present with --lifecycle)

  bb thread section list --json
    [{id, name, createdAt, updatedAt}]

  bb thread queue list <id> --json, bb thread interactions list <id> --json, bb thread history <id> --json
    bare arrays

  bb project list --json
    [{id, kind, name, gitRemoteUrl, sources: [{id, hostId, path, isDefault}]}]    (bare array)

  bb project show <id> --json
    {id, kind, name, gitRemoteUrl, sources}

  bb machine list --json
    [{id, name, type, status, lifecycle, maxPermissionMode, lastSeenAt}]    (bare array)

  bb provider list --json
    [{id, displayName, available, capabilities, reasoningLevels, serviceTiers}]    (bare array)

  bb provider models [providerId] --json
    [{id, model, displayName, supportedReasoningEfforts, defaultReasoningEffort, isDefault}]    (bare array)

  bb environment list --json
    [{id, name, projectId, hostId, path, branchName, status, lifecycle}]    (bare array)

  bb environment show <id> --json
    {id, name, projectId, hostId, path, branchName, baseBranch, status, lifecycle}

  bb terminal list --thread <id> --json
    {sessions: [{id, title, status, exitCode, closeReason, cols, rows}]}    (wrapped in .sessions)

  bb terminal output <terminalId> --json
    {chunks: [{seq, dataBase64}], nextSeq, truncated, status, exitCode, closeReason}    (chunk data is base64; status is "exited" once the command has finished)

  bb terminal wait <terminalId> ... --json
    {terminalId, matched, nextSeq, exitCode}

  bb plugin list --json
    {plugins: [{id, version, enabled, status, source, rootDir}]}    (wrapped in .plugins)

  bb skill list --json
    {skills: [{id, name, description, scope, provider, filePath}]}    (wrapped in .skills)

  bb marketplace list --json
    bare array

  bb settings show --json
    one object keyed by settings area (generalSettings, serverAccess, keybindings, experiments, appearance, ...)

  bb guide commands [group] --json
    {chapter, commands: [{path, aliases, arguments, options, description}]}

Commands contributed by plugins document their own JSON in `bb <command> --help`
and the plugin's skill.
