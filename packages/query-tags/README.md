# Query tags

Register a query's scope and `tagsOf(data)` with `taggedQueryMeta`, and wrap its
query function in `runTaggedRead`. `invalidateTags(client, scope, tags)` marks
matching cached queries stale and awaits active reads. An empty tag list does
nothing. Clients and scopes are independent.

An invalidation during a read repeats it only when its known or returned tags
overlap. Reads without a response yet must settle before tag matching is known.
Failed first loads can recover on the next invalidation.

`runTaggedMutation` invalidates the successful call's `invalidated` tags and
waits for active reads to settle. Refresh failures retain
the cached data and query error; they do not turn a successful write into a
failed mutation. A later successful read clears the query error.
