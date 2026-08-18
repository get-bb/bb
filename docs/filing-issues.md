# Filing Issues

A good issue lets a stranger reproduce the problem in ten minutes without asking you anything. That is the bar for humans and agents alike. The GitHub issue forms in `.github/ISSUE_TEMPLATE/` follow this guide; use them.

## Before you file

1. Reproduce it yourself on the latest release (or `main`). If you cannot, say so in the issue and give what you have; do not present a guess as a repro.
2. Search open and closed issues. If one exists, comment there instead.
3. Separate what you **observed** from what you **think the cause is**. Both are welcome; label them.

## What a bug report contains

Use these sections in this order.

### 1. Summary

Two or three sentences: what you did, what happened, what you expected. Write it for someone who does not know the codebase.

### 2. Versions and environment

- bb version (`bb --version` or Settings → About) and how it was installed (desktop app, `npx bb-app`, `install.sh`, from source at commit).
- OS and version. Node version if you run from source or npm.
- Provider and provider CLI version when the bug involves an agent (`claude --version`, `codex --version`, `pi --version`, ACP agent build).
- Anything unusual about the setup: remote machine, bb Connect, worktree environment, custom ports or data dir, cgroup/memory limits.

### 3. Steps to reproduce

Numbered, copy-pasteable, minimal. Exact commands, exact UI clicks, exact prompt text. Include a tiny scratch repo or fixture if the bug needs one. Prefer `bb …` CLI steps over UI descriptions when both work; they are unambiguous.

State the smallest thing that still reproduces it, and note anything you tried that did **not** reproduce it. That negative space is often the fastest route to the cause.

### 4. Expected vs actual

Paste the actual output verbatim (terminal output, log lines, HTTP responses, `bb thread log` excerpts). For visual bugs attach a screenshot or short recording and say what to look at. Then state what you expected instead.

### 5. Evidence

- Logs from `~/.bb/logs/` (or the dev data dir printed by `pnpm dev`), trimmed to the relevant window.
- Thread ids (`thr_…`), project ids, environment ids when relevant. They are primary keys and let us query the database directly.
- If you cite code, use a permalink to a commit: `https://github.com/get-bb/bb/blob/<sha>/<path>#L<n>-L<m>`. Branch links rot.
- If you measured something (memory, timings, counts), say how.

### 6. What you ruled out

One line each: "not a duplicate of #N because …", "still happens on `main` at `<sha>`", "does not happen with provider X", "clean data dir does not help". This keeps a triager from redoing your work.

### 7. Suggested priority and effort

Optional but useful. One line: how many users it hits, whether there is a workaround, and whether data or work is lost. Priority and effort are set from the built-in issue fields during triage; your suggestion is input, not the decision.

## Feature requests and tasks

Feature requests describe the workflow you could not complete, why the current behavior falls short, and what you would expect. Prototype links from a fork are welcome. Per [CONTRIBUTING.md](../CONTRIBUTING.md), open the issue before a PR for features and UI changes.

Tasks (refactors, docs, chores) state the concrete work and its acceptance criteria.

## Rules for agents

Agents file many issues in this repo. The same bar applies, plus:

- Reproduce before you file. A log line or a symptom in one thread is not a bug report. If a live repro is impossible, write the closest faithful repro (for example a unit test at the exact code path) and mark the issue as unverified.
- Question the report you were handed. If a user's stated cause is wrong, say what you actually observed and what you refuted.
- Include the base commit you tested against and permalinks to the code you cite.
- Link the bb thread or the investigation report that produced the finding.
- Do not open duplicates: search first, and if you find the same root cause under a different symptom, comment on the existing issue with the new evidence.
- End the body with `> AGENT GENERATED: by <model>` (see [AGENTS.md](../AGENTS.md)).

## Triage labels you may see

- `confirmed-repro` — someone other than the reporter reproduced it; the linked report has the steps.
- `partial-repro` — the cause is real but part of the report did not reproduce as written.
- `no-repro` — could not reproduce, or already fixed on `main`; the comment says what was tried.
- Area labels (`providers`, `threads`, `ui`, `plugins`, `host`, `workspaces`, `desktop`, `mobile`, `remote`, `security`, `cli`, `perf`) and per-plugin labels (`provider-claude-code`, `tasks`, `github`, …) say which part of the product owns it. Type, Priority, and Effort live in the built-in GitHub issue fields, not in labels.
