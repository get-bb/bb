# Query tags

Spread `taggedQueryOptions(client, queryKey, registration)` into query options
to register the scope and `tagsOf(data)` and project predictions at cache commit.
Wrap the query function in `runTaggedRead`. `invalidateTags(client, scope, tags)` marks
matching cached queries stale and awaits active reads. An empty tag list does
nothing. Clients and scopes are independent.

An invalidation during a read repeats it only when its known or returned tags
overlap. Reads without a response yet must settle before tag matching is known.
Failed first loads can recover on the next invalidation.

`useTaggedMutation({ client, invalidate, call, optimistic, meta })` returns a
`mutate` that invalidates the successful call's `invalidated` tags and
resolves at server acknowledgement. Active reads refresh in the background.
Refresh failures retain
the cached data and query error; they do not turn a successful write into a
failed mutation. A later successful read clears the query error.

`optimistic` maps each input to prediction descriptors, applied synchronously
when `mutate` is called. Build each prediction with
`optimisticQueryUpdate<Value>(queryKey, updater, path = [])` for a cached query,
or `optimisticKeyedUpdate(collection, key, updater)` for a keyed row. Pure
updaters receive the visible value and return its prediction; missing query
values are skipped. A path selects a nested value of the query data. `meta` is
copied onto the TanStack mutation, so mutation cache handlers such as core's
error toast see it.

A prediction also attaches to its query if that query first receives data
while the write is pending. Updaters receive `{ value }` with the acknowledged
result after the server accepts the write, so the prediction shows the
server's value from acknowledgement on. A cache write after acknowledgement first folds the
acknowledged value into the confirmed data, so the later write takes effect;
reads that started before acknowledgement still get the acknowledged value
reapplied until a read started after it arrives.

All readers see the prediction through the query cache. Server reads update an
authoritative value beneath pending predictions. The prediction stays until the
matched confirmed reads arrive, then fresh server data replaces it, independently
of the acknowledged mutation's pending state. Write
failure removes that mutation's prediction. If the write succeeds but the read
fails, the accepted prediction stays with the read error until a successful
refresh. Later predictions and confirmed values cannot be replaced by an older
settle or rollback; an inverted completion retains the later confirmed value
until a subsequent fresh read.
A query without a tagged read has no confirming
read: its writes and fetches still land beneath the prediction, and an
acknowledged prediction becomes its value when the write settles.
`structuralSharing` calls for an observer's `select` output leave predictions
untouched.

`useTaggedMutation` accepts one typed input per call. Its `pendingInputs` contains
all pending inputs for that hook instance, and `isPending` stays true until all
writes are acknowledged. Background refreshes are excluded. Other hook instances are excluded.

Cache writes that are not read receipts keep predictions above them. A
`setQueryData` value is rebased onto the confirmed data field by field: object
fields it leaves unchanged from the visible value keep their confirmed value, so
rollback removes only the prediction. Arrays are replaced whole, so predict on
object-shaped values (an entity, or a keyed record of rows), not inside arrays.

## Keyed store

A `KeyedCollection` holds each row once per client. `registerKeyedViews(client,
resolve)` maps query keys to `KeyedView`s, which split a query's data into
slots of items, read each item into its row, and render rows back into the
query's data. Every view of a row shows the same visible value: the stored row
with pending predictions applied in order. `createTaggedKeyedQueryOwner` stores
its rows in the collection it is given, and core threads use the same store.
Refreshing subscribed keys retains cached rows and key tags for inactive keys.
Invalidated inactive rows remain visible and refresh when subscribed again, so
switching consumers does not discard their last successful values.

A read writes a row only if it fetched that row. A prediction is never written
into the stored row. One accepted by the server stays on its row until server
data confirms it: a read of that row that started after the acceptance, or
`confirmKeyedEntity`, which stores a server row the caller already has, such as
one returned by the write. The confirming data then replaces the prediction on
that row. A read that started before the acceptance lands beneath the
prediction; a view decides how any read merges into the stored row, so thread
rows also compare `updatedAt`. `confirmKeyedEntity` returns false and keeps the
prediction when its update returns undefined, for example because the stored
row is newer than the caller's; a row that is not stored has nothing to
confirm. A rejected write removes its prediction, leaving later predictions in
place. Rows that load while a write is pending show its prediction. A row
leaves the store, with its accepted predictions, when no view holds it.
`writeKeyedEntity` changes a stored row directly, beneath predictions.

`@bb/query-tags/testing` exports `keyedStoreContract`, the cases every keyed
surface runs through a `KeyedStoreSubject`.
