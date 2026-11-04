---
kind: instruction
title: bb Guide — Threads
summary: Command reference for spawning, handing off, forking, and editing threads.
intent: Document how agents create threads and edit sent messages.
editingNotes: Keep flags accurate against the CLI implementation. Run the json-flag-enforcement and command-output tests after changes.
---
Thread commands

Every command supports --json for machine-readable output. Read-only commands
take a thread ID or --self where supported; mutating lifecycle and messaging
commands require an explicit ID or --self.

Thread commands are split across four chapters:

  threads            Spawning, handing off, forking, and editing sent messages
  thread-inspection  Listing, sections, inspecting, waiting, opening in the app,
                     and panel tabs
  thread-messaging   Messages, plan mode, metadata and ownership, interactions,
                     and queued messages
  thread-lifecycle   Stop, compact, clear, retry, archive, and delete

Spawning:

  bb thread spawn --project <id> --prompt "..." [options]
  bb thread spawn --project <id> --prompt-file <path> [options]

    --prompt <prompt>              Initial prompt (one of --prompt or --prompt-file is required)
    --prompt-file <path>           Read the prompt from a file; `-` reads stdin. Use this for
                                   multi-line or Markdown prompts: inside double quotes the shell
                                   runs `backticks` and $(...) before bb sees them
    --title <title>                Thread title
    --project <id>                 Project (required; when omitted the error prints this thread's project ID to add)
    --parent-thread <id>           Parent thread (may be in another project)
    --parent-self                  Parent to the current thread (BB_THREAD_ID)
    --lifecycle-owner-thread <id>  Archive/delete with this owner
    --provider <id>                Provider override
    --model <model>                Model override
    --reasoning-level <level>      Reasoning level id the model lists: low, medium, high, xhigh, max, or a provider-specific id
    --environment <id-or-path>     Attach to an existing environment (ID or workspace path)
    --new-environment <kind>       Create a fresh personal workspace or managed worktree
    --base-branch <branch>         Base branch or ref for a new managed worktree
                                   (--new-environment worktree only; an
                                   --environment-provider takes its branch
                                   through --environment-inputs)
    --environment-provider <id>    Run on an environment provider by id (list them with
                                   `bb environment providers`). The provider
                                   provisions where the thread runs; its steps show in the
                                   thread's workspace-setup block. Its `requires` names the
                                   facts it consumes: `host` takes --machine (the local
                                   machine by default); `gitCheckout` needs this project's
                                   checkout on that machine to be a Git repository with
                                   commits; `gitRemote` needs a project remote;
                                   `projectless` serves only threads with no project.
    --environment-inputs <json>    JSON value for an --environment-provider that declares
                                   inputs; `bb environment providers --json` prints each
                                   provider's inputs as JSON Schema (null when it takes
                                   none). Omitted, it defaults to {} when the schema
                                   accepts an empty object and is otherwise required;
                                   refused when the provider declares no inputs
    --machine <id-or-name>         Run on a machine (--host is an alias)
    --service-tier <tier>          Service tier id the provider lists for the model, such as
                                   default or fast (see `bb provider models`)
    --option <option=value>        Choose a value for an option the provider's model lists, applied
                                   before the first message; true or false for an on/off option
                                   (repeatable; see `bb provider models`)
    --permission-mode <mode>       Permission mode: accept-edits, auto, or full
    --plan                         Send the prompt as the provider's /plan action (plan first, execute after approval)
    --section <id>                 Create the thread in a section
    --pinned                       Create the thread in Pinned (combines with --section;
                                   unpinning reveals it in that section)
    --visibility <visibility>      visible or hidden; a child inherits its parent by default
    --parent-notifications <value> auto (default), stuck, or off; which outcomes wake the parent
    --send-at <when>               Dispatch the first message at an ISO 8601 timestamp or a duration from now (30s, 10m, 2h, 7d)
    --file <path>                  CLI-local absolute path, file: URL, or uploaded file path
    --image <path>                 CLI-local absolute path, file: URL, or uploaded image path
    --origin-kind <kind>           Create a fork thread
    --source-thread <id>           Source thread for a fork
    --source-seq-end <seq>         Fork after the source turn containing this event sequence

  Execution defaults resolve from explicit flags, live parent execution, and
  remembered project defaults. With no remembered model, bb uses the explicitly
  requested provider or Codex and resolves its provider-reported default model
  on the target machine (or the first catalog model when none is marked). The product reasoning and permission defaults are
  medium and auto.
  accept-edits uses workspace sandboxing with user-reviewed escalation. auto uses
  the same workspace sandbox with provider-native automatic review. full is the
  explicit sandbox and approval bypass. Plan mode is separate from permissions.
  Subagents inherit the parent's permission mode by default, adapted to the child provider's supported modes. Explicit requests and a thread's recorded mode take precedence; nesting a thread does not cap its permissions. The host permission ceiling still applies.
  Parenting is opt-in. Inside a thread, pass --parent-self to parent the new thread to the current thread.
  Hidden threads are for plugin/background workers. They remain addressable by
  ID while staying out of sidebar organization and unread/pending favicon
  attention. Thread lists exclude them unless
  --include-hidden is passed; direct-ID operations remain available.
  A new child thread inherits the visibility of its parent, so the subagents of
  a hidden thread stay hidden too. Pass --visibility to override the inherited
  value. A hidden child still reports its turns and blockers to its parent
  thread; only source-derived forks stay silent.
  --parent-notifications chooses which child outcomes wake the parent. auto
  reports every finished, failed, or interrupted turn and every blocker. stuck
  skips completed turns and keeps failures, interruptions, and blockers on an
  approval or question; the child sends its results with `bb thread tell`, so
  say so in its prompt. off reports nothing. Under stuck and off, unassigning
  the child does not notify the former parent either. `bb status` and
  `bb thread show` print the value for a child thread.
  A machine selector accepts an exact ID or an unambiguous name. It works with
  an unmanaged --environment path, --new-environment worktree, or the personal
  workspace. It cannot be combined with an existing environment ID because that
  environment already selects its machine. Without the flag, local/server
  machine resolution is unchanged.
  Omit --base-branch for bb's default. Default and named branches use the
  remote when local is equal or behind, preserving local commits when ahead
  or diverged. Explicit refs are honored exactly. Remote refs such as
  origin/<branch> are fetched before creation. When bb picked the remote and
  the fetch fails (for example offline or unauthenticated), the worktree
  starts from the last fetched copy and provisioning reports it; an explicit
  origin/<branch> fails instead. refs/remotes/origin/<branch> uses the last
  fetched copy without fetching.
  With no environment flag, a new thread gets a fresh worktree of the
  project's default branch (the project checkout when the project has no
  branch) on the primary host, or on the persistent machine that holds the
  project's source when the primary host has none. A child of a live thread
  in the same project gets a worktree on its parent's machine; a child of an
  unmanaged non-Git folder reuses its parent's environment.
  Before selecting a provider, run `bb environment providers --project <id>
  --machine <id-or-name>` to see whether it is available, needs setup, or is
  unavailable and why. The first-party providers are Project checkout,
  Worktree, and Personal workspace.

Handoff:
  The app's Handoff to new thread (in the follow-up model picker) starts a new
  thread that references the source. From the CLI, run bb thread spawn with
  --provider, --model, --environment and --prompt 'Continue from
  @thread:THREAD_ID ...'; SDK callers pass the same fields to threads.spawn.

Forking:

  bb thread fork <source-thread-id> [options]

    --prompt <prompt>              Optional first prompt; omit for an idle fork
    --prompt-file <path>           Read the first prompt from a file; `-` reads stdin
    --lifecycle-owner-thread <id>  Archive/delete with this owner
    --source-seq-end <seq>         Fork after the source turn containing this event sequence (tip by default)
    --environment <id-or-path>     Existing environment ID or unmanaged workspace path
    --new-environment <kind>       Create a fresh personal workspace or managed worktree
    --base-branch <branch>         Base branch or ref for a new worktree; omit for the project default
    --title <title>                Thread title (idle forks default to "(1) <source title>")
    --permission-mode <mode>       Inherit source by default; accepts accept-edits, auto, full
    --visibility <visibility>      visible (default) or hidden
    --agent-context-seed <text>    Persist agent-only context without a first run
    --file <path>                  CLI-local absolute path, file: URL, or uploaded file path
    --image <path>                 CLI-local absolute path, file: URL, or uploaded image path

  Forks clone the source provider session on the same machine and inherit the
  source conversation in their timeline. --source-seq-end anchors the fork on
  the completed source turn that contains that sequence: the clone and the
  inherited timeline both end with that turn (an anchor on a user message
  branches before it, like editing it). Without it a fork clones the session
  tip and inherits every completed turn. Providers that can only clone a whole
  session accept an anchor only on the source's latest turn. A fork reuses the
  source environment by default. Use --new-environment personal for a fresh
  personal workspace or --new-environment worktree for a fresh worktree on the
  source machine; --environment can select another environment or unmanaged
  path on that machine. A different machine is rejected because the source
  provider session lives on its original machine. Omit --prompt to create an
  idle fork. A visible idle fork without --title is named after its source with
  a numbered prefix: "foo" becomes "(1) foo" and "(1) foo" becomes "(2) foo".
  Forks created with a first prompt get a title from that prompt.

Editing a sent message:

  bb thread edit-message <id> --message "Replacement text"
    --message-file <path>               Read the replacement from a file; `-` reads stdin
    --self                              Target the current thread (BB_THREAD_ID)
    --expected-request-sequence <seq>   Select the message and reject a stale target

  Without --expected-request-sequence, the latest eligible message is edited.
  Codex, Claude Code, and Pi threads are supported, including failed and
  incomplete turns; grouped multi-message requests are not editable.
  `canEditMessages` on `bb thread show --json` reports whether the thread's
  provider and archive state allow edits. The
  original conversation remains unchanged until the provider prepares the
  replacement history. If the thread is running,
  submission stops the current turn and waits for it to settle. Provider-owned
  background commands, agents, and workflows are stopped before replacing the
  session, and retained task cards keep their terminal status. Durable runs
  managed by the Workflows plugin continue independently. It then
  replaces the selected turn and every later turn while retaining workspace
  changes. Unsent queued messages remain in the queue and dispatch after the
  replacement turn when their waits clear. An already-sending queued message
  must finish before the edit can start. Retries of turns replaced by the edit
  are removed from the queue. From an agent thread, the command
  carries `BB_THREAD_ID` so the replacement runs under agent permission policy.
  An edit is refused if removing its history would erase ownership evidence
  shared with another thread. Use bb thread clear <id> to start a new session
  while keeping the history and its ownership evidence.

Lifecycle ownership:
  spawn and fork accept --lifecycle-owner-thread <id> (SDK
  lifecycleOwnerThreadId, also returned in thread responses, null if
  independent). The owner must be live; projects, hosts and environments may
  differ. Ownership is immutable. Archiving the owner archives and stops its
  dependents; deleting it deletes them. Unarchive the owner before explicitly
  restoring a dependent. Stop does not cascade. Sidebar parents and ordinary
  forks keep their own policies.
