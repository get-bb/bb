# Rift Arc commands

The official Rift plugin contributes `bb arc` after
`bb plugin install rift --yes`. The selected host must have `rift-acp` on
`PATH`. Use JSON output when an Arc ID or status controls a later command.

```sh
bb arc list --json
bb arc connect --json
bb arc read --id=<arc-id> --json
bb arc create --backend=apple-container --size=a1.small --json
bb arc start --id=<arc-id> --json
bb arc pause --id=<arc-id> --json
bb arc stop --id=<arc-id> --json
bb arc destroy --id=<arc-id> --json
bb arc thread --id=<arc-id> --project=<project-id> --prompt=<text> --json
```

Use `--backend=fly` for a remote Arc. Pass `--remote-provider=machines` or
`--remote-provider=sprites` only when overriding the Rift workspace default.
Use `--host=<id>` or `--environment=<id>` to select where `rift-acp` runs; the
two selectors are mutually exclusive. An explicit host also requires the
current directory to be an absolute workspace path.

`bb arc use` is an alias for `bb arc thread`. Both persist the selected Arc on
the new thread, so starts, later turns, and resumes use the same Arc. Inspect
the returned Arc after a lifecycle mutation instead of assuming it reached
`ready` immediately.
