# Environment and thread startup

An environment row exists before its provider creates the workspace. Its
`status` moves from `creating` through `provisioning` (daemon attachment and
setup) to `ready`, or to `error`. Environment routes, the SDK, and the CLI
show reservations with `status: creating`; `statusMessage` holds current
progress or the terminal creation error. A server restart resumes the same walk.

- Creation failures are terminal; there is no automatic create retry. An
  explicit retry cleans the previous attempt and reuses the row. A failed setup
  script can be retried on the same environment without recreating its
  workspace.
- A provider that returns an existing project checkout keeps that checkout's
  identity and retires the unused reservation. A rejected foreign path records
  an error and is never handed to removal.
- A path is claimed before the provider mutates it, so concurrent threads
  cannot take it, and a claim survives failed cleanup until removal succeeds.
- Cancellation waits for the active create to settle before removing its
  resources. Shared environments remain until their last live thread leaves,
  then retire after the provider's grace period. Pending cleanup survives
  provider unavailability and server restart.
- The environment provider SDK reports a failed create as
  `{ status: "failed", message }`; the Plugin Guide documents this contract.

A thread's first message stays queued while its environment is prepared, and
is consumed when provisioning is admitted. Once agent start has been handed to
the daemon, recovery never resends an uncertain start automatically; use the
normal interruption and retry behavior.
