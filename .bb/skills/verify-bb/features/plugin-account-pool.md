# Account pooling

Status: **2026-09-05: 7 partial/blocked**; the Cache miss debugging recipe was added later and has not been run. See [the audit](../MAINTENANCE.md) and [per-recipe ledger](../validation-2026-09-05.json).

## Setup and entry points

Settings → Accounts; bb pool --help. Use disposable provider accounts, an isolated credential store, and synthetic threads. Never print imported credentials.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/account-pool/package.json`
- `plugins/account-pool/src/server.ts`
- `plugins/account-pool/src/cache-miss.ts`
- `plugins/account-pool/app.tsx`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Import, login, and API-key accounts | Add a test account through each supported flow; cancel an incomplete login and submit invalid input. | Only completed valid accounts become available; secrets remain masked and absent from transcripts. |
| Enable, disable, remove, and priority | Add two fixtures, toggle one, reorder them, change priority, then remove one through settings and pool account commands. | Persisted availability and order agree across interfaces; disabled accounts receive no new allocation. |
| Quota and status | Refresh quota/status for supported account types and inspect model-family windows and reset times. | Displayed availability matches returned provider data; unknown or failed fetches are distinguishable from zero usage. |
| Routing and fallback | Enable routing, start a short authenticated turn, exhaust or disable the selected test account, and start another. | A usable account is selected according to routing policy; no failed allocation is reported as successful. |
| Session pinning and bypass | Continue an existing test session, change routing order, and enable a per-thread bypass. | Continuation uses the valid pinned session policy; bypass follows the intended direct provider path. |
| Machine tokens and configuration | Create/rotate only a disposable machine token; exercise pool config/status and routing controls. | Old token no longer authorizes the test integration; new config persists without exposing values. |
| Blocked and retry states | Use controlled failures for quota reset, unavailable credentials, and unsupported account/provider combinations. | Failure category and next available time are actionable; permanent errors do not cause unlimited retries. |
| Cache miss debugging | Turn on cache miss debugging in settings or with `bb pool config set cacheMissDebug true`, lower `cacheMissMinTokens`, point `anthropicUpstreamBaseUrl` at a controlled fake upstream, then send two same-session requests that each carry a `cache_control` breakpoint, where the second changes one tool and reports a low cache read. List and clear through settings and `bb pool cache-miss list --json` / `clear`. | Both surfaces show one report naming `prompt-change` at the changed `tools[...]` path with before/after excerpts, and settings refresh without reload; server logs carry no prompt text; clear empties both; with debugging off, or on a proxy-mode child, nothing is recorded. |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Inspect the
registered plugin command and SDK call before claiming agent parity; do not
invent a plugin CLI where the feature uses a core command instead. Preserve
failed attempts and missing prerequisites as unverified results. Restore plugin
configuration and remove only this run’s fixtures, registrations, and workers.
External account changes use authorized disposable targets.

## Maintenance notes

- Open Settings → Account Pooler [Experimental] (/settings/plugins/account-pool), then Add account. API-key storage acceptance and Ready status do not prove upstream authentication; verify that separately using a disposable target. Source: `plugins/account-pool/app.tsx:88`.
