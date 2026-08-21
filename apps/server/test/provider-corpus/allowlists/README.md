# Per-workstream corpus allowlists

`snapshots/rows` under the private corpus is the row baseline minted on
`main`, shared by every workstream. A pull request that intentionally
changes projected rows carries its allowlist here, one file per workstream,
and compares against the shared baseline with:

```bash
BB_PROVIDER_CORPUS_ALLOWLIST=apps/server/test/provider-corpus/allowlists/<ws>.json \
  scripts/provider-corpus/snapshot-rows.sh compare
```

Entries use the same schema as `snapshots/allowlist.json` (scope, `path`
glob, `pr`, `reason`) and are merged after it. Never write a snapshot into
the shared `snapshots/rows` from a feature branch; point
`BB_PROVIDER_CORPUS_SNAPSHOT_DIR` at a shadow directory instead. When the
PR merges and `main` is re-minted, its entries go stale and the file is
deleted.
