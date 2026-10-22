# Interrupted setup recovery

Run from a clean, committed checkout with dependencies installed, Python 3,
Git, an available Codex provider, and the host-care plugin on the owning bb:

```sh
BB_SERVER_URL="$OWNER_SERVER_URL" BB_THREAD_ID="$OWNER_THREAD_ID" \
  python3 tests/qa/scripts/environment-recovery.py
```

The script creates a fresh isolated runtime under the checkout's ignored `.tmp`
directory, selects separate available ports, and launches through host-care with
temporary retention and a ten-minute queue wait. Every source CLI write first
checks the isolated server's data directory. Owner commands only manage the
recorded host-care job. No existing runtime or database is reused.

It interrupts a real setup by restarting its daemon, verifies the detached hook
survives, and checks the 1/2/4/8-minute persisted retry deadlines. Explicit cleanup
requests advance retries without waiting fifteen minutes. At five failures it
requires “Needs recovery” in the CLI. A separate persisted fixture begins with
7,873 attempts; the scheduler must stop it without another attempt. Both counts
must remain unchanged for 75 seconds, longer than the sweep interval.

Recovery must refuse the surviving same-UID workspace process. After that
recorded process exits, recovery must finish the operation, run teardown, and
remove the workspace. The legacy fixture must also recover. Only owned PIDs are
signaled, with process start times checked before signaling; the managed runtime
is released even on failure.

The guard covers processes owned by the daemon UID. Processes owned by other
users require separate inspection. This test requires Linux process inspection;
it does not exercise native Windows termination failure.

Each run retains `results.log` (head and assertions only) and `diagnostics.log`
(raw CLI output) inside its generated directory. Publish only the reviewed
results log; diagnostics contain local paths and fixture identifiers.
