# Provider usage limits

Status: **source-documented; live execution pending**.

## Setup and entry points

Enable Provider usage; configure at least one provider advertising usage maintenance. Open its usage card and Settings → Usage.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/provider-usage/package.json`
- `plugins/provider-usage/server.ts`
- `plugins/provider-usage/app.tsx`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| All capable providers | Refresh with two supported providers and one unsupported provider. | Cards show only supported data using current provider names/icons and configured ordering. |
| Quota windows and errors | Inspect real returned windows/resets and a controlled refresh failure. | Values match the provider response; unknown/unavailable data is distinct from exhausted quota. |
| CLI and SDK parity | Compare bb settings usage --json with bb.sdk.system.usageLimits() and the visible card. | All surfaces represent the same underlying provider maintenance data. |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Inspect the
registered plugin command and SDK call before claiming agent parity; do not
invent a plugin CLI where the feature uses a core command instead. Preserve
failed attempts and missing prerequisites as unverified results. Restore plugin
configuration and remove only this run’s fixtures, registrations, and workers.
External account changes use authorized disposable targets.
