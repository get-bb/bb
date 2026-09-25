---
name: machine-load-balancer
description: "Automatically choose a ready, least-loaded machine for new independent BB threads and inspect machine capacity, readiness, and running threads."
---

# Machine Load Balancer

From the repository root, install it with `bb plugin install path:plugins/machine-load-balancer`. If BB shows it as disabled, enable it with `bb plugin enable machine-load-balancer`.

In the BB new-thread environment dropdown, choose **Auto**. It is the default until a specific machine is picked, and it previews the machine the plugin would choose now and why other machines were skipped. From the CLI, omit `--machine` from `bb thread spawn`; `bb thread placement --project ID --provider ID` previews the same decision. The plugin chooses a ready machine with the lowest fresh load per processor at thread start, before environment provisioning. Explicit machine choices, existing environments, forks, and inherited environments stay on their selected machine. Running threads are never moved.

Open Settings → Installed plugins → Machine Load Balancer → Machines for a
dashboard of every machine ranked by load per processor, with the next pick,
per-provider readiness, and running threads. Observations older than 30
seconds are marked stale; refresh or turn on auto-refresh.

The same data is available from the CLI:

```sh
bb placement inspect [--json]
bb placement inspect --project <project-id> --provider <provider-id> [--json]
```

With no flags it lists every machine. `--project` and `--provider` must be
passed together; they add the placement decision and each skipped machine with
its reason, such as `no source for <project>` or `Codex not signed in`.

Every run measures connected machines on demand: available processors (Node
`availableParallelism`), total physical memory, and the 1-minute OS load
average. Load is scheduler load, not CPU percent; Windows does not report it.
Placement only considers a machine that is connected on the current protocol,
active, has an existing directory source for an ordinary project (personal
workspaces do not need one), and whose provider reports ready. Among those it
picks the lowest load per processor from a reading at most 30 seconds old,
favoring the server and then host id on ties, and otherwise stays on the
server. Running threads are `starting` or `active`
threads; ones still choosing a machine are listed separately.

The command only reports. It never moves threads, sets up sources, or signs in
providers. The same data is available through the plugin RPC method `inspect`, which
takes `{ "kind": "all" }` or `{ "kind": "placement", "projectId", "providerId" }`. This is a snapshot; run the
command again for a current observation.

When enabled, the plugin answers the pre-start placement hook for a new
independent thread whose machine was omitted. It runs before source inspection
or provisioning. Explicit machines, existing environments, host-bound paths,
forks, and inherited environments stay fixed. Failure or no eligible candidate
uses the primary host if it has the source; otherwise thread creation reports
the existing source or host error. Implicit models resolve on a chosen host,
and explicit models must be available there. It does not move running threads or poll for
later rebalancing; handoff is deferred.
