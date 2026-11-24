---
kind: instruction
title: bb Guide — Projects
summary: Command reference for project CRUD, attachments, sources, and folders.
intent: Provide complete project command documentation for agents.
editingNotes: Keep flags accurate against the CLI implementation.
---
Project commands

A project maps to a code repository. All threads belong to a project.

  bb project list                         List ordinary projects
    --include-personal                    Also include the personal project
  bb project discover                     Find recently used git repos
    --machine <id-or-name>                Machine to scan (default: local)
    --host <id-or-name>                   Alias for --machine
  bb project history <id>                 List prompt history
  bb project reorder <id>                 Reorder in the sidebar
    --after <id>                          Previous project, or omit for start
    --before <id>                         Next project, or omit for end
  bb project create --name "..." [options]
    --root <path>                         Project source path
    --machine <id-or-name>                Bind the path to a connected machine
    --host <id-or-name>                   Alias for --machine

  An explicit machine/host selector accepts an exact ID or unambiguous name and
  binds --root to that machine. Omitting the selector preserves the existing
  local CLI machine fallback (normally the server machine).

  bb project show <id>                    Show project details
    Accepts proj_personal to inspect Personal.
  bb project update <id>                  Update a project
    --name <name>                         New name

  bb project delete <id>                  Delete project and all threads
    --yes                                 Skip confirmation

Global prompt history:

  bb prompt-history list [--cursor <cursor>] [--limit <number>]

  Lists accepted prompts across projects and threads newest first. Pass the
  returned cursor to continue from the next page.

  Prompt history omits prompts larger than 256 KiB.

Discovery:

  bb project branches <id> --host <id>   List branches for a machine source
  bb project paths <id>                   Search workspace paths
  bb project files <id>                   List workspace files
  bb project content <id> <path>          Read file content (binary is base64;
                                          --json reports contentEncoding)
  bb project commands <id> --provider <id>
                                          List commands and skills
    --machine <id-or-name>                Target project source machine
    --host <id-or-name>                   Alias for --machine
    --environment <id>                    Target environment workspace

  The machine/host and environment selectors are mutually exclusive. An
  environment selects its owning machine and workspace; otherwise an explicit
  machine selects that machine's project source. Omitting both intentionally
  falls back to the server machine's project source.

  Personal file access (`paths`, `files`, `content`) requires an explicit
  --environment <id> belonging to Personal. Personal has no default project
  source; the selected environment must be ready.

  Path and file searches honor Git ignore rules, including local and global
  exclusions; tracked and non-ignored untracked files, including hidden files,
  remain searchable. Non-Git workspaces use filesystem listings. Use
  `bb file list|paths` for listings that include ignored files.

Attachments:

  bb project attachment upload <id>       Upload bytes from the CLI machine
    --client-file <path>                  Path read on this CLI machine
    --filename <name>                     Attachment filename override
    --mime-type <type>                    MIME override (otherwise inferred)
  bb project attachment download <id> <attachment-path>
    --client-file <path>                  Destination on this CLI machine

  Uploads use multipart bytes and return a server-managed attachment DTO. Pass
  its relative `path` to thread --file/--image input. Thread --file and --image
  upload absolute paths and file: URLs from the CLI machine automatically;
  relative values remain existing server attachment paths.
  Uploads are limited to 35MB per file.
  image/heic and image/heif uploads are rejected because no renderer or
  provider can decode them; convert them to JPEG or PNG first. There is no
  command to list or remove project attachments.

Sources:

  Projects can have multiple machine-local path sources.

  bb project source add <projectId>       Add a source
    --path <path>                         Local path
    --clone                               Clone the project's Git remote
    --remote-url <url>                    Git remote override for --clone
    --target-path <path>                  Destination override for --clone
    --machine <id-or-name>                Target machine (--host is an alias)
    --default                             Set as default source

  Explicit project source selectors must name a connected machine. Omitting
  the selector preserves the same local CLI machine fallback as project create.

  bb project source update <projectId> <sourceId>
    --path <path>
    --default

  bb project source delete <projectId> <sourceId>

  A live project must retain at least one source; a project pending deletion
  may remove its last source.

Folders:

  Folders are extra existing directories, outside a machine's checkout, that
  every thread of the project on that machine can read and write: sibling
  repositories, shared data, or a docs checkout.

  bb project folder list <projectId>      List the main folder, then the
                                          extra folders (--json: extra
                                          folders only)
  bb project folder add <projectId> <path>
                                          Add an absolute folder path
  bb project folder import <projectId> <file>
                                          Add the folders a VS Code
                                          .code-workspace file lists
  bb project folder update <projectId> <path-or-id> <new-path>
                                          Point a folder at another path
  bb project folder remove <projectId> <path-or-id>
                                          Remove a folder
    --machine <id-or-name>                Machine whose checkout to change
                                          (--host is an alias; default: the
                                          local CLI machine)

  A folder must exist on the machine, and must not be the checkout, inside
  it, or contain it. bb reads the list before every turn, so adding,
  changing, or removing a folder changes a running thread's write access at
  its next turn. The agent's instructions list each folder and whether it is a git
  repository; they are written when the agent session starts, so a running
  session may still name a folder added or removed since. A
  folder missing on the machine is marked missing in the instructions, left
  out of the writable folders, and reported once in the thread's timeline.

  Write access is enforced by each provider's own controls. Claude Code and
  Codex grant the folders in their sandboxes. ACP agents receive them as
  additional directories when the agent supports it; agents that can
  restore their session are rebuilt before the next turn when the list
  changes, and bb refuses ACP file writes outside the list in accept-edits.
  An ACP agent's own tools are otherwise governed by that agent's
  permissions. Pi runs with full access, so the list only informs it.

  `bb project folder import` reads the .code-workspace file on the
  machine (comments and trailing commas are allowed), resolves relative
  folder paths against the file's folder, and adds each folder with the same
  rules as `add`. Folders that are the main folder or inside it are skipped;
  missing, duplicate and over-limit folders and non-file `uri` entries are
  reported per folder. A relative file path is read from the CLI's current
  folder when no --machine is given.

  An environment provider can add folders of its own environment
  (`Environment.additionalPaths`, the Folder lines of `bb environment show`);
  they join the project's folders for threads in that environment. A folder
  can replace a project folder (`replaces`, shown as "replaces project
  folder" on its Folder line): threads in that environment no longer get
  that shared folder. A Worktree environment created with
  `{"branch":{"kind":"default"},"folders":["/abs/folder"]}` makes a worktree
  of each listed folder's git repository on the thread's branch, next to the
  main worktree, and replaces that folder with it. Each folder worktree runs
  its own .bb-env-setup.sh once, in the order listed, before the main
  worktree's, and its .bb-env-teardown.sh after the main one's.
