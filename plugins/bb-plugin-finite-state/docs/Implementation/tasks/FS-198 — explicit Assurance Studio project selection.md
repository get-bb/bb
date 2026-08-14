# FS-198 — Explicit Assurance Studio project selection

Assurance Studio owns the AS-to-Platform linkage. The plugin enumerates the
read-only product links, then requires an operator to select the AS project for
each exact `(bb workspace project, Platform project)` binding. It never ranks
or auto-selects candidates from names, `is_primary`, sync state, or version.

The Sync Review panel exposes the selector for Assurance Studio-backed
surfaces. Agents and operators have the same local-selection workflow through
the registered RPC and CLI surfaces:

```sh
bb finite-state as-projects --project <platform-project-id> --json
bb finite-state as-project-select --project <platform-project-id> \
  --as-project <assurance-studio-project-id> --json
```

The corresponding RPC methods are `sync.asProject.candidates` (read) and
`sync.asProject.select` (local write). Selection performs another read-only
enumeration and rejects an AS id that is not linked to the supplied Platform
project. No Assurance Studio write route is called.

Connected pulls retain the Platform scope for cache and generation identity,
but Assurance Studio adapters receive only the persisted AS project id. A pull
that includes an Assurance Studio-backed kind fails before remote contact when
the binding is unselected.
