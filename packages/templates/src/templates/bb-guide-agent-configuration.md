---
kind: instruction
title: bb Guide — Agent Configuration
summary: User and workspace files that customize agent instructions and skills.
intent: Document the user and workspace files that shape agent behavior for threads.
editingNotes: Keep accurate against the server's agent-instructions reader and skill loader.
---
Agent configuration

bb reads agent configuration from the app data dir and from a project's .bb/
directory. These files shape how agents behave in provider-backed threads.

User instructions (<dataDir>/AGENTS.md):

  Add an AGENTS.md file to the bb data dir (usually ~/.bb/AGENTS.md) to give
  every provider-backed thread across all projects default user-level
  instructions. bb reads <dataDir>/AGENTS.md and appends its contents to the
  thread system prompt for all providers when a provider session starts.

Workspace instructions (.bb/AGENTS.md):

  Add a .bb/AGENTS.md file to a workspace to give every thread that runs there
  repo-specific instructions. bb reads <workspace>/.bb/AGENTS.md and appends its
  contents to the thread system prompt for all providers, after any
  <dataDir>/AGENTS.md instructions, when a provider session starts. Track it with
  git so fresh managed worktrees include it.

  Only the plural AGENTS.md is read, only from the exact data-dir and
  workspace-root .bb/ locations above (bb does not walk parent directories), and
  an empty file is ignored. This is bb's own provider-agnostic instruction
  injection, separate from provider-native files such as CLAUDE.md or a
  repo-root AGENTS.md.

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
