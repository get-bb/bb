---
kind: instruction
title: bb Guide — Automations
summary: Command reference for creating and managing scheduled agent and script automations.
intent: Provide complete automation command documentation for agents.
editingNotes: Keep flags accurate against the CLI implementation. Run the command-output tests after changes.
---
Automation commands

An automation is a scheduled task. When due it runs in one of two modes:

  agent    Spawn a thread that runs a configured prompt (uses tokens).
  script   Run a stored command and capture stdout/exit (no agent, no tokens).

Pass --project explicitly for every automation command. Inside a thread,
automations are stamped origin "agent" and record the creating thread
automatically.

Choosing a mode:

  Use script when the output is fully determined by code — watchdogs, threshold
  alerts, health checks, heartbeats, API pollers with a fixed output shape.
  Design the script to print NOTHING when there is nothing to report: an exit-0
  run with empty stdout (or a trailing {"wakeAgent": false} line) is a silent
  tick. Any other stdout is surfaced; a non-zero exit / timeout is recorded as a
  failed run.

  Use agent when the run needs reasoning — summarize a feed, pick interesting
  items, draft a human-friendly message, or branch on content.

  For a request like "every 15 minutes, alert me if disk is over 90%", prefer a
  script automation: author a small check script whose stdout IS the alert, then
  schedule it (no model spend per tick):

    # 1. write the check — stays silent unless the threshold is crossed
    cat > /tmp/disk-watch.sh <<'SH'
    #!/usr/bin/env bash
    pct=$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')
    [ "$pct" -ge 90 ] && echo "Disk at ${pct}% on $(hostname)"
    SH
    # 2. schedule it
    bb automation create --project <project-id> --name "Disk watch" \
      --cron "*/15 * * * *" --timezone "America/New_York" \
      --script-file /tmp/disk-watch.sh

  Automations cannot create automations (runs are origin-gated) — never schedule
  one whose job is to create more. Host-script automations may be disabled by
  server policy (config.automationsAllowScriptRuns); fall back to an agent
  automation if script creation is rejected.

Every command supports --json for machine-readable output.

Creating:

  bb automation create --project <id> --name "..." --cron "..." --timezone "..." [mode flags]

    --name <name>                  Automation name (required)
    --cron <expr>                  5-field cron expression, steps OK e.g. */5 * * * * (required)
    --timezone <tz>                IANA timezone, e.g. America/New_York (required)
    --project <id>                 Project (required)
    --environment <id-or-path>     Existing environment ID or unmanaged workspace path
    --new-environment <kind>       Create a new environment (worktree)
    --base-branch <branch>         Base branch for new managed environments
    --disabled                     Create the automation paused
    --auto-archive                 Auto-archive the spawned thread when it completes

  Agent mode (provide --prompt):

    --prompt <prompt>              Prompt to run when due
    --provider <id>                Provider ID (required for agent mode)
    --model <model>                Model ID (required for agent mode)
    --permission-mode <mode>       full, workspace-write, or readonly (default readonly)
    --target-thread <id>           Reuse/re-prompt an existing thread

  Script mode (provide --script or --script-file):

    --script <inline>              Inline script content
    --script-file <path>           Read script content from a local file (uploaded inline)
    --interpreter <name>           bash, sh, node, or python3 (default by extension)
    --timeout <ms>                 Timeout in milliseconds

  A script that exits 0 with empty stdout, or whose last non-empty line is
  {"wakeAgent": false}, stays silent. Any other stdout is surfaced.

  Script run environment: scripts run with the bb environment injected and
  inherit the daemon's PATH, so `bb ...` and `node ...` work without any manual
  exports. Injected variables:

    BB_SERVER_URL          The bb server API base URL (e.g. http://127.0.0.1:38886)
    BB_HOST_DAEMON_PORT    The host daemon port
    BB_PROJECT_ID          The automation's project
    BB_ENVIRONMENT_ID      The environment the script ran in
    BB_AUTOMATION_ID       The automation's id
    BB_AUTOMATION_RUN_ID   This run's id

  A script run's status IS its exit code: exit 0 = succeeded; a non-zero exit is
  recorded as failed even if the script already produced a visible side effect
  (e.g. posted a message via `bb thread tell`). Make scripts exit 0 on success
  and check the exit status of each `bb` call. Captured stdout+stderr is stored
  on failed runs and shown via `bb automation runs <id> --output <runId>`.

Cron format:

  Standard 5-field cron expressions are accepted, including step values like
  */5 * * * * and */15 * * * *. The minimum granularity is 5 minutes; a schedule
  that would run more often (e.g. * * * * * or */2 * * * *) is rejected.

Listing and inspecting:

  bb automation list --project <id>        List automations for a project

  bb automation show <automationId> --project <id>
                                            Show automation details
  bb automation runs <automationId> --project <id>
                                            List recent runs
    --limit <count>                        Maximum runs to return
    --output <runId>                       Print a script run's captured stdout

Managing:

  bb automation update <automationId> --project <id>
                                            Update configuration
    --name <name>                          Set the name
    --cron <expr>                          Set the cron (requires --timezone)
    --timezone <tz>                        Set the timezone (requires --cron)
    --auto-archive                         Enable auto-archive

  bb automation pause <automationId> --project <id>
                                            Pause (disable, clear next run)
  bb automation resume <automationId> --project <id>
                                            Resume (enable, recompute next run)
  bb automation run <automationId> --project <id>
                                            Run now (manual trigger)
    --idempotency-key <key>                Dedup key for replayable run-now

  bb automation delete <automationId> --project <id>
                                            Delete permanently (cascades run history)
    --yes                                  Skip confirmation
