# Rift workspace

Install this optional plugin from BB Official, then install `rift` on each machine:

```sh
npm install -g rift-snapshot
```

Rift makes copy-on-write copies of a standalone Git checkout using APFS clonefile on macOS or btrfs/native reflinks on Linux. It preserves the index, uncommitted files and, by default, dependencies and build outputs. It does not create a Git worktree or share branch updates with the source. Linked Git worktree sources and Windows are unsupported by Rift.

The plugin initializes the checkout with `rift init --here`, then runs `rift create --copy-all --into <attempt-directory> --name workspace`. Filtered mode omits `--copy-all` (the current CLI has no `--filtered` flag), excluding Rift's regenerable dependency/build artifacts. Filesystem support and same-filesystem copy constraints come from Rift.

Rift runs `.rift.toml` precreate and postcreate hooks. The copy starts detached; BB creates its suggested prefixed branch, or the exact named input branch, from the copied HEAD. A same-named inherited branch is replaced only in the copy. BB then runs `.bb-env-setup.sh`. BB reserves the canonical attempt path before creating or recovering a copy. Refused admission leaves the path untouched; failed creation retains its claim until cleanup succeeds. Hooks must tolerate retry after an interrupted attempt. A completion record and branch check preserve a completed copy on replay; incomplete or mismatched copies are removed and recreated.

```sh
bb thread spawn --project <project-id> --environment-provider rift \
  --environment-inputs '{"branch":{"kind":"default"},"copy":"all"}' \
  --prompt 'Implement the change'
```

Inputs: `branch: { kind: "default" } | { kind: "named", name: string }`; `copy: "all" | "filtered"`, default `all`. The same selection is available through the SDK and New Thread picker.

The provider owns its attempt directory, uses per-attempt path keys and the standard five-minute retirement after the last thread is archived. Removal runs BB's teardown script and `rift remove`; if Rift fails, direct deletion is confined to that exact managed attempt. Rift normally moves removed copies into adjacent `.trash`, so removal does not reclaim disk space. Run `rift gc` manually to reclaim that storage, following upstream Rift semantics; BB does not run garbage collection automatically. Source initialization remains after retirement.

`presentation: { groupsThreads: true, kindLabel: "Rift workspace" }` groups threads sharing a copy and labels its info tab. This changes presentation only; the environment's real `isWorktree` remains false.

Hook support depends on the installed Rift version. The tested npm release 0.0.10 supports postcreate; master also documents precreate and remove hooks. BB delegates those hooks to Rift rather than emulating newer CLI behavior.
