# System Monitor plugin

Shows live CPU, memory, disk, load-average, and uptime data for the machine
running the bb server.

## Install

From the bb repository root:

```sh
bb plugin install system-monitor --yes
```

Open **System Monitor** from the app sidebar, or query the same data from the
CLI:

```sh
bb system-monitor
bb system-monitor --json
```

The panel refreshes every five seconds. Because plugin backend code runs in the
bb server process, the values describe the server host, not a separately
enrolled execution machine.

## Develop

```sh
bb plugin dev plugins/system-monitor
```
