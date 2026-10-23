# Git

Owns git status, changed files and diffs for bb environments. Bundled and enabled by default.

- `host.ts` runs git in the environment's workspace on its machine: status, diff, changed files, patches and branch options. Reads share one cache per workspace path.
- `server.ts` resolves environments, fills in the merge base the thread uses, serves the keyed `status` and `patches` reads, `files`, `diff`, `fileSide`, `branches` and the Viewed and merge-base mutations, and registers `bb git`. `server/invalidation.ts` turns the daemon's file and ref change events into one coalesced refresh per environment.
- `contract.ts` is the public contract. Core reads it with `pluginId: "bb--git"` for the Diff tab, the Info git rows, the composer, the Commit dialog and `bb thread show`, the way any other plugin would.

Viewed marks stay in core's `diff_viewed_files` table; the plugin reads and writes them through the SDK.
