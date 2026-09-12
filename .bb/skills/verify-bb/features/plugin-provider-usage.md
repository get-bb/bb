# Provider usage limits

Status: **2026-09-05: 2 passed, 1 partial/blocked**. See [the audit](../MAINTENANCE.md) and [per-recipe ledger](../validation-2026-09-05.json).

## Setup and entry points

Enable Provider usage and a provider implementing the usage RPC contract. Open its usage card and Settings → Installed plugins → Provider usage.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/provider-usage/package.json`
- `plugins/provider-usage/server.ts`
- `plugins/provider-usage/app.tsx`
- `plugins/provider-codex/src/usage-source.ts`
- `plugins/provider-claude-code/src/usage-source.ts`
- `plugins/provider-acp/src/usage-source.ts`
- `plugins/account-pool/src/usage-source.ts`
- `plugins/provider-usage/settings.tsx`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| All capable providers | Refresh with two supported providers and one unsupported provider. | Cards show only supported data using current provider names/icons and configured ordering. |
| Quota windows and errors | Inspect real returned windows/resets and a controlled refresh failure. | Values match the provider response; unknown/unavailable data is distinct from exhausted quota. |
| CLI and SDK parity | Inspect `bb plugin rpc list --method provider-usage.v1.listResources --json`, list a provider plugin’s resources, and fetch one returned resource ID. Compare its selected host/provider with `bb settings usage --json`. | Discovery is independent of display plugins, inventory collects no quota, and fetch returns only the chosen resource. Pool resources remain separate from direct host maintenance. |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Inspect the
registered plugin command and SDK call before claiming agent parity; do not
invent a plugin CLI where the feature uses a core command instead. Preserve
failed attempts and missing prerequisites as unverified results. Restore plugin
configuration and remove only this run’s fixtures, registrations, and workers.
External account changes use authorized disposable targets.

## Contract verification

- Test a source with the display plugin disabled. Each provider implementation
  publishes both source methods independently of the display.
- Check empty pools, loading, first-load errors, stale measurements after failed
  refresh, disconnected hosts, and removed resources on both displays.
- Verify matching window and plan labels, account order, default pool selection,
  and explicit machine selection. Do not deduplicate by email; known account
  identities are deduplicated only within the selected location.
- The settings page fetches resources for the selected location; the footer
  fetches only its selected provider tab. Compare shared pool sources through
  their RPC contract; `bb settings usage` remains the direct host-maintenance view.
