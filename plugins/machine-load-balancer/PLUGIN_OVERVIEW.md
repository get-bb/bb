# Machine Load Balancer

Automatically choose a ready machine for each new independent agent thread, and inspect the capacity and readiness behind that choice.

## Use it in BB

From the repository root, install it with `bb plugin install path:plugins/machine-load-balancer`. If BB shows it as disabled, enable it with `bb plugin enable machine-load-balancer`.

When the plugin is enabled and more than one machine is connected, the BB new-thread environment dropdown starts with an **Auto** group. Each Auto row names the machine the plugin would choose right now and why others were skipped, such as "Places on Mac Studio · omarchy skipped: Codex not signed in", and the trigger reads `Auto → Mac Studio · <environment>`. Choosing Auto sends the thread without a machine, so the plugin places it at thread start. Auto is also the default until you pick a specific machine, and picking one is remembered for the project. From the CLI, omit `--machine` from `bb thread spawn` for the same behavior, and preview the choice with `bb thread placement --project ID --provider ID`. You do not need to run a preview first.

To see every machine, run `bb placement inspect [--json]`. Add `--project <project-id> --provider <provider-id>` to preview the choice for that pair. In BB, open Settings → Installed plugins → Machine Load Balancer → Machines for the same machine dashboard.

Explicit machine choices, existing environments, forks, host-bound paths, and inherited environments stay on their selected machine. Running threads are never moved. If no eligible machine is available, BB uses its normal server default or reports its existing source or host error.

## What you get

- A Machines dashboard in Settings that ranks every connected machine by load per processor and marks the **Next pick**, the least-loaded machine with a fresh reading and a ready provider. The server carries a **server** badge.
- For each machine: `N CPU · M GB`, a green, amber, or red load bar with the raw 1-minute load in its tooltip, and each provider's readiness, such as `Codex ✓  Pi ✗ not signed in`, with the reason in a tooltip. Unavailable machines say why: ephemeral, disconnected, rejected daemon protocol, or paused.
- Running threads collapsed behind "N running threads". Expanded, each row shows the title (opens the thread), provider and model, status (starting or active), and elapsed time. Threads still choosing a machine appear under **Pending placement**.
- "Observed 12s ago" with a refresh button, a **Stale** marker after 30 seconds (the placement freshness window), and an optional auto-refresh toggle.
- Automatic placement at the start of an independent new thread: the ready machine with the lowest load per processor that has the project's source and a ready provider.

## How it works

Nothing runs in the background unless you turn on auto-refresh, which re-measures every 15 seconds while the section is open. Opening the section, pressing Refresh, or showing the Auto option in the new-thread composer measures connected machines on demand. The Auto label is a preview; the placement itself is decided again when the thread starts. Load is the 1-minute operating system load average divided by the machine's available processors. It is scheduler load, not CPU percent. Windows does not report it, so a Windows machine shows no load and is never chosen. A reading older than 30 seconds is never used. The overview is a snapshot; Refresh to get a new observation.

Placement resolves before source inspection or environment provisioning for a new independent thread with an implicit machine. A valid choice keeps its provider during model catalog resolution. An implicit model is resolved from the chosen machine's catalog, and an explicitly chosen model must appear in that catalog. Explicit machines, attached environments, host-bound paths, forks, and inherited environments keep their chosen host. On plugin error, timeout, or no eligible machine, thread creation uses the primary host when it has the project source, and otherwise reports the existing source/host error. Ordinary projects need an existing directory source and provider sign-in on the chosen machine; personal workspaces need no source. Running threads are never moved; handoff and periodic rebalancing are deferred.

## For agents and scripts

`bb placement inspect [--json]` prints the same machine overview as the dashboard. `--project <id> --provider <id>` must be passed together and add the placement decision with each skipped machine and its reason. The RPC method `inspect` takes `{ "kind": "all" }` or `{ "kind": "placement", "projectId", "providerId" }`. It measures without starting or moving a thread.
