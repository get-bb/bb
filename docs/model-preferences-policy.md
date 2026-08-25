# Provider-native model preferences

Status: accepted and implemented for Pi

## Decision

Pi's global `enabledModels` setting remains the authority for Pi's preferred
model set. BB exposes a product editor for that native preference; it does not
create a second BB model-policy document.

The editor lists authenticated models on the host selected by Settings. It
shows model switches, search, enabled count, **Enable all**, **Reset**, and
**Save**. Host routing is supplied by the Settings host context. The editor
never asks for a machine, cwd, file path, pattern, revision, or conflict
resolution.

The CLI offers the same global operation through `bb pi models`; its optional
`--machine` flag follows BB's remote-targeting convention. SDK clients use the
Pi plugin's `readModelSettings` and `writeModelSettings` RPC methods through
`sdk.plugins.callRpc`. Neither surface accepts cwd.

## Invariants

### Preferences are not authorization

`enabledModels` controls Pi's picker and model cycling. It does not authorize
execution. A selected thread model outside the preferred set remains in BB's
selected-only catalog and can continue to run.

A future execution restriction would be a separate BB-owned policy with an
explicit denial result. It must not reuse this preference.

### Pi owns matching

Pi model identifiers and `enabledModels` patterns are opaque outside the Pi
bridge. The bridge uses Pi's native resolver, including ordered patterns,
globs, bare IDs, aggregator IDs containing slashes or colons, and thinking
suffixes. Core model contracts carry only ordinary model IDs and never gain Pi
pattern fields.

The product editor intentionally writes exact authenticated model IDs. Existing
native patterns are resolved internally to switch state but are never exposed
or rewritten until the user saves a changed selection.

### Empty resolution is unrestricted

Pi treats absent or empty `enabledModels` as unrestricted. It also treats a
configured pattern set that resolves no models as unrestricted rather than
deny-all. BB preserves that behavior: the picker cannot become empty because a
stale native pattern stopped matching.

**Enable all** removes the global `enabledModels` field. The editor prevents a
user from disabling the final authenticated model.

### Selected-only models remain available

Model discovery partitions the authenticated catalog:

- models selected by Pi's native preference appear in `models`, in Pi's
  resolved order;
- authenticated models outside that preference appear in
  `selectedOnlyModels`;
- duplicate IDs are not introduced.

The distinction preserves an existing thread's selection without presenting
that model during ordinary cycling.

### Hosts are isolated

The selected host determines credentials, authenticated models, and the global
Pi settings file. A host with no authenticated models reports that state; it
must never show another host's cached catalog.

Saving clears the server's model-catalog memo and broadcasts a model change so
web and mobile picker queries refetch immediately. The Pi bridge reloads native
settings before every model-list resolution, so a save does not require a BB
restart.

### Writes preserve the settings document

The Pi bridge updates only global `enabledModels`. It takes the same
host-local lock Pi uses (`proper-lockfile` on the settings path), preserves
unrelated JSON fields and file mode, writes a temporary file beside the real
file (through a symlinked `settings.json`, not over the link), and atomically
renames it over the settings file. Invalid settings or write failures fail the
save rather than replacing unknown content; a settings file pi could not load
is reported and read as empty for listings, so the picker keeps working.

The bridge reads only the global file. A project's `.pi/settings.json`
`enabledModels` applies in pi only once the project is trusted, a decision
the bridge cannot see, and a repository must not be able to steer the picker.

## Ownership

| Concern                                      | Owner                                        |
| -------------------------------------------- | -------------------------------------------- |
| Authenticate and enumerate Pi models         | Pi model runtime in the Pi bridge            |
| Resolve native `enabledModels` semantics     | Pi native resolver in the Pi bridge          |
| Atomically update global Pi settings         | Pi bridge on the selected host               |
| Route the selected host                      | BB Settings context / CLI machine resolution |
| Cache invalidation and client notification   | BB server provider plugin API                |
| Search, draft, reset, save, and empty states | Pi provider plugin app                       |
