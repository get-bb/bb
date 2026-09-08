# Existing machine

The built-in `manual` machine provider uses the public machine registration and
inputs-slot contracts. It prepares core enrollment, reports a redacted step,
and waits for the daemon. Cancellation and removal use core credential and access
cleanup. A host is identity plus daemon connection; a machine adds a provider-owned
lifecycle. The local host remains provider-less.

Run `bb machine create --provider manual` or select Existing machine in Settings
or the composer picker. `--no-wait` returns a durable launch ID and command;
`bb machine status <id>` retrieves it and `bb machine cancel <id>` cancels it.
Closing the dialog or interrupting the follower leaves creation running.

No idle suspend, automatic retirement, or suspend/resume. Removal cannot execute
on the box: run `bb machine uninstall --host-id <host-id>` there with the original
`BB_DATA_DIR` if configured under `~/.bb-machines`. This stops and uninstalls
only the matching identity.

The UI and CLI fetch the private command transiently through the authorized
launch endpoint. It decrypts only the pending encrypted bundle, sets no-store,
and returns no command after enrollment or cancellation. Credentials never enter
progress logs or provisioning transcripts. Removal and cancellation expire live
daemon sessions through core host-removal effects.
