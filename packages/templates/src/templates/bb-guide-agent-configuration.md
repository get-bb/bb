---
kind: instruction
title: bb Guide — Agent Configuration
summary: Workspace .bb/ files that customize agent instructions and skills.
intent: Document the .bb/ workspace files that shape agent behavior for a workspace's threads.
editingNotes: Keep accurate against the server's workspace-instructions reader and skill loader.
---
Agent configuration

bb reads per-workspace configuration from a project's .bb/ directory. These files
shape how agents behave for every thread that runs in that workspace. Track them
with git so fresh managed worktrees include them.

Workspace instructions (.bb/AGENTS.md):

  Add a .bb/AGENTS.md file to a workspace to give every thread that runs there
  repo-specific instructions. bb reads <workspace>/.bb/AGENTS.md and appends its
  contents to the thread system prompt for all providers, on both start and
  resume. Editing the file takes effect on the next turn.

  Only the plural AGENTS.md is read, only from the workspace-root .bb/ directory
  (bb does not walk parent directories), and an empty file is ignored. This is
  bb's own provider-agnostic instruction file, separate from provider-native
  files such as CLAUDE.md or a repo-root AGENTS.md.

Skills (.bb/skills/):

  A skill is a reusable instruction file that bb injects into a thread and
  exposes to the agent as a slash command. Place project skills under
  .bb/skills/<name>/SKILL.md in a workspace. Each SKILL.md has YAML frontmatter
  with `name` (lowercase, hyphenated, matching the directory) and `description`,
  followed by the instruction body.

  bb resolves skills from three sources, in increasing precedence:

    builtin    Skills bundled with bb.
    user       <dataDir>/skills (e.g. ~/.bb/skills).
    project    <workspace>/.bb/skills.

  A project skill overrides a user or builtin skill with the same name. Two
  skills with the same name within one source collide and are both dropped.

  Use the skill-creator skill to author and iterate on skills.
