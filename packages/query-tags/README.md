# Query tags

Spread `taggedQueryOptions(client, queryKey, registration)` into query options
to register the scope and `tagsOf(data)` and project predictions at cache commit.
Wrap the query function in `runTaggedRead`. `invalidateTags(client, scope, tags)` marks
matching cached queries stale and awaits active reads. An empty tag list does
nothing. Clients and scopes are independent.

An invalidation during a read repeats it only when its known or returned tags
overlap. Reads without a response yet must settle before tag matching is known.
Failed first loads can recover on the next invalidation.

`runTaggedMutation` invalidates the successful call's `invalidated` tags and
resolves at server acknowledgement. Active reads refresh in the background.
Refresh failures retain
the cached data and query error; they do not turn a successful write into a
failed mutation. A later successful read clears the query error.

Pass `{ client, optimistic: [...] }` as the third argument to
`runTaggedMutation`. Build each prediction with
`optimisticQueryUpdate<Value>(queryKey, updater, path = [])`. Pure updaters
receive the visible cached value and return its prediction; missing values are
skipped. A path selects a nested value, such as `["result", rowId]` for a keyed
row. `useTaggedMutation` takes a fourth callback from mutation arguments to the
same prediction descriptors, applied synchronously when `mutate` is called.

All readers see the prediction through the query cache. Server reads update an
authoritative value beneath pending predictions. The prediction stays until the
matched confirmed reads arrive, then fresh server data replaces it, independently
of the acknowledged mutation's pending state. Write
failure removes that mutation's prediction. If the write succeeds but the read
fails, the accepted prediction stays with the read error until a successful
refresh. Later predictions and confirmed values cannot be replaced by an older
settle or rollback; an inverted completion retains the later confirmed value
until a subsequent fresh read. Keyed reads acknowledge only rows they fetched.

`useTaggedMutation` accepts one typed input per call. Its `pendingInputs` contains
all pending inputs for that hook instance, and `isPending` stays true until all
writes are acknowledged. Background refreshes are excluded. Other hook instances are excluded.
