# Conductor layout

Makes bb's sidebar work like [Conductor](https://conductor.build)'s: a list of
projects, each holding **workspaces**. A workspace is every thread that shares
one environment (usually a git worktree), so a second chat started in the same
worktree shows up as part of the same row instead of as another thread.

## What you get

- **Pinned** workspaces at the top, then **Projects**. A project row expands
  and collapses its workspaces; collapsed, it shows how many it holds. Hover a
  project for **+**, which opens the composer in that project.
- One row per workspace, titled by its first chat, newest first:
  - a glyph for its state: bb's working or waiting glyph while any of its
    threads runs, otherwise its pull request (open, draft, merged, closed, or a
    red cross when checks fail, changes are requested, or it conflicts),
    otherwise a branch;
  - the number of chats when there is more than one;
  - lines added and removed against the merge base (`+3.1k -338`);
  - on hover, **Archive**, which archives every thread in the workspace with
    bb's own undo toast.
- Clicking a workspace reopens the chat you last had open in it. Right-click
  opens bb's thread menu for its first chat.

Threads without an environment each get a row of their own. Hidden threads
(side chats) and sub-agents never get a row, but their work still shows on
their workspace's glyph.

## How it works

The plugin replaces bb's sidebar thread list through
`app.slots.experimental_threadList`. It reads threads from
`experimental_useSidebarThreads`, line counts from the Git plugin's `status`
read, and pull requests from the GitHub PR Status plugin's `pullRequests`
read; without either plugin those parts are simply left out. Which projects
are expanded and the last chat opened in each workspace are kept in this
browser's local storage.

Switch back to bb's own list under Settings → Appearance → Sidebar, or disable
the plugin.
