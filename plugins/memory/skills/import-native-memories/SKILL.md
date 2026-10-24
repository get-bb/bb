---
name: import-native-memories
description: "Import, migrate, or keep your agents' built-in memories (Claude Code and Codex native memory) in bb memory, for example before or after turning built-in memory off. Finds them on every connected machine, proposes what to keep, and saves only after approval."
---

# Import native memories into bb memory

Claude Code and Codex keep their own memories on each machine that ran their
threads. This skill moves the durable ones into bb memory so nothing is lost
when the person turns provider memory off. You read every source, decide what
is worth keeping, show a plan, and save only after the person approves it.

## Ground rules

- Import only from the providers in scope. A request that names providers
  limits it: "I'm turning off Claude memory" means Claude Code only. A request
  that names none, such as "Import my agents' built-in memories", covers the
  providers enabled in bb: run `bb provider list --json` and keep `claude-code`
  and `codex` if listed. This skill knows the files of Claude Code and Codex;
  for any other provider, say it is not supported yet instead of guessing
  paths.
- Treat every Claude Code and Codex file as read-only. Read them only with
  `bb file paths` and `bb file read`. Never write, move, rename, or delete
  them, and never change provider settings while importing.
- Save nothing before the person approves the plan in this thread.
- Never store anything that looks like a secret. `bb memory` rejects most of
  them; skip those files with a reason instead of rewording around the check.
- Follow the `memory` skill for how to write a memory.

## 1. Find the machines

```bash
bb host list --json
bb project list --json
```

Work on every host with `status: "connected"`. Name every other host in the
plan and the final report as not checked, so the person can rerun once it is
online.

The CLI does not expand `~` on other machines. On the host you run on, the
home directory is `$HOME`. For every other host, start from its project source
paths (`sources[].path` with that `hostId`) and walk up their parent
directories. The home directory is the nearest one where
`bb file paths <dir>/.claude/projects --host <hostId> --limit 1 --json` or the
same check for `<dir>/.codex/memories` returns at least one path. A missing
directory also exits successfully, with an empty `paths` list, so check the
list, not the exit code. A repository's own `.claude` folder has no `projects`
directory, so it does not count. If a host
has no project source, or no parent directory matches, ask the person for its
home directory.

## 2. Find the sources

Search only the rows for the providers in scope.

| Provider | Read | Ignore |
| --- | --- | --- |
| Claude Code | `<home>/.claude/projects/*/memory/*.md` | `MEMORY.md` (only the index), session `*.jsonl` files |
| Codex | `<home>/.codex/memories/MEMORY.md`, `<home>/.codex/memories/memory_summary.md`, and `<home>/.codex/memories_v2/memory_summary.md` | `raw_memories.md`, `rollout_summaries/`, every `*.sqlite` file |

If the person set `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, use that directory
instead of `~/.claude` or `~/.codex`.

```bash
bb file paths <home>/.claude/projects --host <hostId> --files --query "memory/.md" --limit 5000 --json
bb file paths <home>/.codex --host <hostId> --files --query memor --limit 500 --json
bb file read <path> --host <hostId> --json
```

The `memory/.md` query keeps session transcripts out of the list; a plain
`memory` query also matches them. An empty list means that provider has no
memories on that host. Record
each file's `sha256` from `bb file read --json`; the final report uses it to
show that sources were unchanged.

Claude Code memory files start with frontmatter: `name`, `description`, and a
`type` (`user`, `feedback`, `project`, or `reference`), sometimes nested under
`metadata`. Codex `MEMORY.md` is one handbook of `# Task Group` blocks, each
with an `applies_to: cwd=…` line. Split it into separate memories by topic.

## 3. Match each source to a bb project

Claude Code names each `projects/<folder>` after the working directory, with
every character other than a letter or digit replaced by `-`. Encode candidate
paths the same way and compare them with the folder name:

- each project source path on that host (`bb project list --json`);
- each environment path on that host, including destroyed ones
  (`bb environment list --host <hostId> --json` and the same with
  `--status destroyed`). Their `projectId` gives the project. bb
  personal-workspace thread folders belong to the personal project.

For Codex blocks, match the `cwd=` path the same way. A folder for a home,
Documents, or temporary directory matches no project.

## 4. Decide each file's fate

First read what bb already holds:

```bash
bb memory catalog --scope global --limit 100 --json
BB_PROJECT_ID=<projectId> bb memory catalog --scope project --limit 100 --json
bb memory search "<topic>" --scope all --json
```

Then give every source file exactly one outcome:

| Outcome | When |
| --- | --- |
| New memory | Durable: a user preference, feedback with its reason, a project fact that is still true, or a reference |
| Merged | The same rule appears in other files; fold them into one memory |
| Update | bb already has the memory; update it instead of adding a near-duplicate |
| Skipped, with a reason | Old project or PR status, a dated one-off event with no lasting rule, anything derivable from code or git, a rule already in `AGENTS.md`, superseded content, a likely secret, or a repository-specific fact whose project is not in bb |

- **Conflicts:** keep the newest rule and say in the memory what it replaced.
- **Scope:** project scope by default. Use global only for preferences and
  workflows that clearly apply across repositories, even when Claude Code
  stored them under one project.
- **Shape:** the rule first, then why and how to apply it, in plain words.
- **Kind:** one of `fact`, `preference`, `decision`, `procedure`, `episode`,
  or `reference`. Claude Code `user` and `feedback` usually become
  `preference`, and step-by-step rules `procedure`.
- **Reruns:** memories tagged `imported` and their reasons show which files an
  earlier import handled. Decide only files that are new or changed since then.

Large stores take many files. Work project by project and skim long state
dumps for lasting rules.

## 5. Show the plan and wait

Write `import-plan.md` in this thread's workspace with one line per source
file: `<host>:<path>` and its outcome (`new → <name>`, `merged into <name>`,
`update <id>`, or `skipped: <reason>`), then the proposed memories with scope,
project, name, kind, summary, and details. Post the totals as a message in the
thread (new, updated, merged, skipped, hosts not checked), then ask the person
to approve.
Use a decision card when the thread supports them. Change the plan when they
ask, and ask again.

## 6. Save

Only after approval:

```bash
bb memory add --scope global --name <name> --summary "…" --details "…" \
  --kind preference --tag imported --tag claude-code --importance 40 \
  --reason "Imported from Claude Code memory on <host>: <files>" --json
BB_PROJECT_ID=<projectId> bb memory add --scope project … --json
bb memory update <id> --expected-version <version> --details "…" \
  --reason "Merged Claude Code memory from <host>: <files>" --json
```

- Tag every imported memory `imported` plus `claude-code` or `codex`, and use
  importance 40 unless the person asks otherwise. `bb memory update --tag`
  replaces the whole tag list, so repeat the memory's existing tags.
- Keep the reason at most 500 characters; list as many source files as fit.
- Check each command's JSON result. If a write fails, fix it and retry, or mark
  that file skipped in the plan with the error.

## 7. Report

Give the totals, the hosts not checked, any failures, and the path of
`import-plan.md`. Re-read a few source files with `bb file read --json` and
confirm their `sha256` is unchanged. Remind the person that the provider files
are still on disk, and that turning provider memory off is their choice in
Settings → Plugins.
