---
name: provider-usage
description: Inspect provider subscription usage sources and configure the Provider Usage footer card in BB.
---

# Provider Usage

Open Settings → Installed plugins → Provider usage to inspect subscription usage
for an account pool or machine. Provider Usage is enabled by default. An enabled,
unconfigured account pool shows setup guidance; choose a machine to inspect its
local accounts instead.

Right-click the sidebar shortcut and choose Hide to move it into More. Restore or
reorder footer actions in Settings → Appearance → Sidebar footer. These are BB
UI preferences shared across clients; they do not disable the usage source or its
settings page. The `bb settings ui` commands expose the same preferences.

Discover usage-source plugins with
`bb plugin rpc list --method provider-usage.v1.listResources --json`.
Inspect schemas with `bb plugin rpc inspect <plugin-id> --method provider-usage.v1.listResources --json`.
Listing resources is cheap; `provider-usage.v1.getResource` fetches one resource’s
actual usage, even when `refresh` is false. RPC calls take JSON via `--input-file`.
The Plugin Guide documents the public RPC APIs.

`bb settings usage --json` remains the host-local maintenance view, without pooled
accounts. Hiding or disabling Provider Usage does not disable usage sources.
