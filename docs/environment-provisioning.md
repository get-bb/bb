# Environment and thread startup ownership

An environment record exists before its provider finishes creating the workspace. The record owns the provider selection, resource checkpoint, path claim, creation progress, attempt, and removal state. Successful creation attaches that same environment to the thread. Cancellation marks the environment for removal, waits for its create call to settle, and uses the same cleanup queue, concurrency limit, retry deadline, and teardown checkpoint as attached environments.

A provider may return an existing project checkout. In that case its existing environment identity is preserved and the unused reservation is retired. Path admission remains exclusive until attachment or successful cleanup; an environment still being prepared cannot be selected for another thread. Provider ownership checks apply before accepting a returned path.

A creation attempt reserves an environment record. A removed environment releases its path so a later allocation can reserve it. A failed resource remains recorded until its cleanup succeeds. Removing a provider or restarting the server does not discard its cleanup checkpoint.

The thread owns its startup request in `threads.startup_context`:

- `pending` stores the environment intent and fork facts while the first message remains queued.
- `provisioning` stores the resolved request, execution options, provisioning ID, current stage, and transcript positions. Admission persists this state and its request events in the same transaction that consumes the first queued message.
- `dispatched` records that the agent start has been handed to the transport. Recovery does not automatically resend an uncertain agent start. Existing interruption and explicit retry behavior applies.

The server reconstructs provisioning from the persisted thread state after restart. Only timer handles, recheck flags, and abort controllers remain process-local. Startup requests and progress are read from the thread record rather than cached in a second context registry. Checkpoint updates are conditional on the current provisioning ID, so an older attempt cannot overwrite a newer startup. Successful startup clears the context.

The existing environment list/get routes, SDK methods, and CLI commands expose reserved environments with `status: provisioning`. Existing thread provisioning events continue to carry detailed progress. No daemon wire contract changes are required.

Migration 0116 moves unfinished environment allocations into environment records and moves their startup requests onto threads. Existing attached environment resources remain authoritative. Pending starts are tagged without changing their queued messages.
