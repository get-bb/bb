See each thread's git status where you work: the Diff tab, the changed-files segment above the composer, and the branch, merge base, git status, commits and uncommitted files in the Info tab.

## What you get

- The Diff tab, with uncommitted, branch, all-changes and per-commit views, Viewed marks, whitespace and file filters, and Add to chat on selected lines. `Mod+D` toggles it.
- A changed-files segment above the composer with a merge-base picker.
- Branch, merge base, ahead/behind status, commits and uncommitted files in the Info tab.
- Live updates: views refresh after the environment's files or refs change, at most once a second, and only rows someone is watching are re-read.

## How it works

The plugin runs git in the environment's workspace on its own machine. One status read serves the Diff tab, the composer and Info. bb never wakes a sleeping machine for git status.

Use the CLI from any thread:

- `bb git status <environment-id>` prints the workspace status.
- `bb git files <environment-id> --target uncommitted` lists changed files.
- `bb git diff <environment-id> --target all` prints the diff.
- `bb git viewed mark <environment-id> --path <path>` marks a file Viewed.

The Commit button and dialog stay in core.
