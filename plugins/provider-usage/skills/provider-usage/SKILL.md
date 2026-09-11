---
name: provider-usage
description: Inspect provider subscription usage sources and configure the Provider Usage footer card in BB.
---

# Provider Usage

Open Settings → Installed plugins → Provider usage to inspect subscription usage
for an account pool or machine. Provider Usage is enabled by default. An enabled,
unconfigured account pool shows setup guidance; choose a machine to inspect its
local accounts instead.

Hide the sidebar shortcut and card without disabling the usage settings page:

```sh
bb plugin config provider-usage set showFooterCard false
```

Set `showFooterCard` to `true` to restore them. This setting applies to all clients
connected to this server. Inspect effective values with `bb plugin config provider-usage`.

Discover usage-source plugins with
`bb plugin rpc list --method provider-usage.v1.listResources --json`.
Inspect schemas with `bb plugin rpc inspect <plugin-id> --method provider-usage.v1.listResources --json`.
Listing resources is cheap; `provider-usage.v1.getResource` fetches one resource’s
actual usage, even when `refresh` is false. RPC calls take JSON via `--input-file`.
The Plugin Guide documents the public RPC APIs.

`bb settings usage --json` remains the host-local maintenance view, without pooled
accounts. Hiding or disabling Provider Usage does not disable usage sources.
