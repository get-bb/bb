---
name: provider-usage-sources
description: Inspect host-local usage resources published by the maintenance adapter.
---

# Inspect usage sources

The bundled Provider usage sources plugin adapts every enabled provider declaring
`maintenance.usage`, including third-party providers. It is independent of the
Provider Usage display. Account Pooler publishes its shared resources separately.

Inspect methods and schemas:

```sh
bb plugin rpc inspect provider-usage-sources --json
bb plugin rpc list --method provider-usage.v1.listResources --json
```

Call `provider-usage.v1.listResources` with `{}` through
`bb plugin rpc call provider-usage-sources <method> --input-file <json-file> --json`.
Choose an opaque resource ID from that response and call
`provider-usage.v1.getResource` with `{ "resourceId": "<id>", "refresh": false }`.
Listing is cheap metadata; fetching returns actual data for only that resource.
Use `refresh: true` for a fresh attempt. Machine disconnection, authentication,
and collection failures are distinct states. Unknown account identity is never
inferred from email. `bb settings usage` remains the direct maintenance view.
