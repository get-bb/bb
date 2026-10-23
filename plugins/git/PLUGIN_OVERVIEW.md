Reads each environment's git status, changed files, diffs and branches on its own machine. bb's Diff tab, the changed-files segment above the composer and the git rows in the Info tab read from it.

## What you get

- One status read per environment serves the Diff tab, the composer and Info.
- Live updates: views refresh after the environment's files or refs change, at most once a second, and only rows someone is watching are re-read.
- bb never wakes a sleeping machine for git status.

## How it works

The plugin runs git in the environment's workspace on its own machine. Use the CLI from any thread:

- `bb git status <environment-id>` prints the workspace status.
- `bb git files <environment-id> --target uncommitted` lists changed files.
- `bb git diff <environment-id> --target all` prints the diff.
- `bb git viewed mark <environment-id> --path <path>` marks a file Viewed.

The Commit button and dialog stay in core and read through the plugin.
