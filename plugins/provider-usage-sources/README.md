# Provider usage sources

A headless adapter from existing provider maintenance usage to the contract
owned by Provider Usage. Bundled and enabled by default, independently of either
display. Any enabled provider declaring `maintenance.usage` is included without
implementing RPC methods or depending on this plugin.

Inventory lists host/provider metadata without collecting quota. Fetch addresses
one opaque resource ID returned by inventory. It collects actual usage even when
`refresh` is false, with a 60-second cache; `refresh: true` requests a fresh
measurement. Concurrent requests share collection, while a forced request waits
for a fresh attempt if an ordinary collection is already running.

Provider-owned maintenance extensions can include `accountKey`, `plan`, and
window `kind`/`model`. The adapter validates these against its copied usage
contract. Missing or invalid optional extensions become unknown identity, no
structured plan, or a custom window; existing display labels remain usable.
Core and the provider kit do not register, import, or interpret this contract.

Use the Plugin Guide for the RPC API and published JSON Schemas for the exact
contract. Disable this adapter to replace it with another source implementation.
Neither Provider Usage nor a replacement display needs to be enabled to call it.
