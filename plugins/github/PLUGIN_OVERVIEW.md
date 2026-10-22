See the open issues and pull requests of your repositories inside bb. Hand one to an agent with one click.

## What you get

- A pull request inbox of what needs you: reviews requested from you, then your own pull requests that are ready to merge, need fixing, or are in progress, each with its reason in words. Switch between Inbox, Mine, All, Merged, and Issues, filter with chips, snooze what can wait, and drive it all from the keyboard or, on a phone, with a long press.
- Pull request details beside the list: a card that says what to do now and does it (merge with the repository's method, re-run the failed checks, mark a draft ready, reopen), then Activity with a comment box, Files, and Checks with their logs.
- A status pill to mark a pull request ready, turn it into a draft, close, or reopen it, with Undo.
- Start an agent on a pull request or an issue with bb's composer, seeded with what your pull request needs or a review of someone else's, and placed in the bb worktree already on the branch or a new one. The thread is linked to it.
- The home page lists what needs you, and the panel's badge counts it. A thread's GitHub panel shows its pull request.
- Issues with details: body, comments, a comment box, and editing of status, assignees, and labels.
- Mentions. Type `@` or `#` in any composer to attach an issue or pull request. Its title, body, and state go to the agent at send time.

## How it works

The plugin tracks every bb project whose checkout has a GitHub `origin` remote. Add more repositories in the Extra repositories setting as a comma-separated `owner/repo` list. Choose a Default project for repositories that are not attached to a project. A background service refreshes the cache at startup, then waits 15 minutes after each completed sync to reduce background GitHub traffic. Press Refresh in the panel to update now.

## For agents

The `bb github` command lists cached data. Use `bb github repos`, `bb github issues [owner/repo]`, `bb github prs [owner/repo]`, or `bb github sync`. `bb github prs` also says what each pull request needs next. `bb github pr-state <owner/repo> <number> --state open|draft|closed` marks a pull request ready, turns it into a draft, closes it, or reopens it. `merge`, `rerun`, `snooze`, and `unsnooze` do what the panel does. `agent` starts a thread on a pull request or issue in the project's default environment and checks the pull request's branch out there, while the panel reuses the worktree that holds the branch or creates one. Every command accepts `--json`, and `bb github --help` or `bb github <command> --help` prints the arguments and options and exits 0.

## Requirements

The GitHub CLI must be installed and signed in with `gh auth login`. See https://cli.github.com for installation. The plugin uses your `gh` session and stores no tokens. Until `gh auth status` passes, the plugin reports that it needs configuration.
