# Live query changes

`liveQueryOptions(client, queryKey, registration)` and `liveQueryMeta(registration)`
register a scope, `dependenciesOf(data, client)`, and an optional
`reactToChange(data, change)`. An optional `read(context)` creates the query
function through `runLiveRead`, so changes arriving during a read are checked
before its result commits. Metadata-only registrations preserve the caller's
query function. `liveQueryOptions` also rebases plain-query optimistic updates.

Dependencies and changes identify `entity`, optional `id`, and required nonempty
`changes`. A missing ID matches every instance. Only a change carries an optional
JSON `value`. A reducer returns `{ action: "patch", data }`, `{ action: "reload" }`,
or `undefined` for dependency matching. Reducer errors are reported and reload.
Until the first result, dependencies may be known or `undefined`; unknown reads
check changes against their result and recover a failed first load on a scoped
change. `refreshLiveQueries` handles reconnect and explicit refresh without
inventing a message. A plugin/reset change refreshes its whole plugin scope.

`applyQueryChange` patches cached values or reloads matching reads. An in-flight
read restarts or gets a trailing refresh so an old result cannot remain
authoritative. Reload reactions can select `keys` for keyed reads. A pushed row
patch reduces the stored base value beneath predictions; row differences drive
store updates. There are no per-path patch receipts.

`runLiveMutation` and `useLiveMutation({ client, publish, call, optimistic, meta })`
resolve at write acknowledgement; background refresh does not extend pending
state. `pendingInputs` belongs to the hook instance. Rejected writes roll back.
Plain-query predictions use `optimisticQueryUpdate(queryKey, updater, path)`;
full-read receipts preserve accepted values through older reads and refresh
failures. The keyed store owns keyed prediction confirmation separately.

## Keyed store

A `KeyedCollection` holds each row once per client. `registerKeyedViews(client,
resolve)` maps query keys to views that split query data into slots, ingest rows,
and render their visible values back into each query. Core threads and plugin
keyed RPC rows use this store. `createLiveKeyedQueryOwner` reads only subscribed
keys, batches up to 200 keys, and retains dependencies per row.

`optimisticKeyedUpdate` predicts a row through `beginOptimisticMutation`, the
same path for core threads and plugin `cache.updateKey`. Accepting a write stores
its value; a rejected write removes its prediction. Reads record per-key start
epochs, so an older read cannot replace an accepted value, and a partial read
cannot confirm a different row. Views can apply version checks, as thread views
do with `updatedAt`. Pending predictions remain over authoritative patches.
`writeKeyedEntity` updates the base beneath them. Shared rows remain consistent
across detail, lists and sidebar views.

`@bb/query-changes/testing` exports `keyedStoreContract`, the cases every keyed
surface runs through a `KeyedStoreSubject`.
