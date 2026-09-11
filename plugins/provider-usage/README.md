# Provider usage

Shows usage from enabled usage-source plugins in the sidebar. Provider tabs
use provider names and icons, with pooled accounts stacked under each provider.
The card lists account metadata cheaply, then fetches only the selected provider’s accounts. Unopened tabs have no quota badge until measured. Shared sources such as Account Pooler are selected by default; an explicit
machine selection shows that machine’s local usage instead.

An unconfigured shared source remains selectable and shows setup guidance.
Failed refreshes retain the last available measurements with a retry notice.
Account authentication failures and plans without reported limits have separate
states; unavailable usage is never represented as zero consumption.

Settings → Usage limits consumes the same sources independently, using its
existing full-size provider cards and fetching only resources in the selected pool or machine. Neither display is required for source
plugins to publish their usage.

Use `bb plugin rpc list --method provider-usage.v1.listResources --json` to find sources
and `bb plugin rpc inspect <plugin-id> --method provider-usage.v1.listResources --json`
to inspect their published contracts. RPC calls accept JSON through
`--input-file`. See the Plugin Guide for the contract API.

`bb settings usage --json` and `bb.sdk.system.usageLimits()` remain the
host-local provider-maintenance view; they do not aggregate shared pool accounts.

Codex, Claude Code, and ACP provider plugins explicitly implement the usage contract
for their own providers. Account Pooler implements it for shared accounts. The
contract is owned here and copied into each source; no additional adapter plugin,
provider-kit helper, or core runtime convention is required. Other providers must
explicitly implement the contract to appear in these displays.

Known provider-issued account identities are deduplicated within the selected
location. Unknown identities are never merged by email. Structured plan and quota
window metadata give both displays consistent labels.
