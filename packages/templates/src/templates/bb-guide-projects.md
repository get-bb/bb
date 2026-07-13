---
kind: instruction
title: bb Guide — Projects
summary: Command reference for project CRUD and sources.
intent: Provide complete project command documentation for agents.
editingNotes: Keep flags accurate against the CLI implementation.
---
Project commands

A project maps to a code repository. All threads belong to a project.

  bb project list                         List all projects
  bb project history <id>                 List prompt history
  bb project reorder <id>                 Reorder in the sidebar
    --after <id>                          Previous project, or omit for start
    --before <id>                         Next project, or omit for end
  bb project create --name "..." [options]
    --root <path>                         Project root path

  bb project show <id>                    Show project details
  bb project update <id>                  Update a project
    --name <name>                         New name

  bb project delete <id>                  Delete project and all threads
    --yes                                 Skip confirmation

Discovery:

  bb project branches <id> --host <id>   List branches for a machine source
  bb project paths <id>                   Search workspace paths
  bb project commands <id> --provider <id>
                                          List commands and skills

Sources:

  Projects can have multiple machine-local path sources.

  bb project source add <projectId>       Add a source
    --path <path>                         Local path
    --clone                               Clone the project's Git remote
    --remote-url <url>                    Git remote override for --clone
    --target-path <path>                  Destination override for --clone
    --machine <id-or-name>                Target machine (--host is an alias)
    --default                             Set as default source

  bb project source update <projectId> <sourceId>
    --path <path>
    --default

  bb project source delete <projectId> <sourceId>
