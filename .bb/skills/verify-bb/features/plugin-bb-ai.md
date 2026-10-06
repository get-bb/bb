# bb cloud AI

Status: **2026-09-30: 0 passed, 5 not run** (on by default; settings page removed; voice input added). Run against the local cloud from hosted-web.md.

## Setup and entry points

Settings → AI services; Settings → Plugins → bb cloud AI (enable/disable only;
there is no settings page); bb ai --help. Needs a signed-in bb account
(bb-account plugin) against `pnpm cloud:dev`; real replies need
`OPENROUTER_API_KEY` in the cloud-dev environment. bb cloud is on in a fresh
store.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/bb-ai/package.json`
- `plugins/bb-ai/src/server.ts`
- `apps/ai-gateway/src/gateway.ts`

## Feature recipes

| Feature                   | Drive                                                                                                                                                                                                                            | Observable success                                                                                                                                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On by default and opt-out | In a fresh store, sign in and read `ai status` and the AI services picker; run `ai off --json`, reload the plugin, read status, create a thread with Thread titles pinned to bb cloud; then run `ai on`.                         | On by default: status is ready and Automatic lists bb cloud after Codex. After `ai off` status says "bb cloud is off" and names `bb ai on`, the choice survives the reload, the pinned title falls back to prompt text, and the gateway logs no request. `ai on` reports enabled and ready. |
| Readiness                 | Read `ai status` and the AI services picker signed out, signed in, and with bb-account disabled.                                                                                                                                 | Status says how to become ready in each case; signed in it reports ready and Automatic lists bb cloud after Codex.                                                                                                                                                                          |
| Titles and commits        | Pick bb cloud for Thread titles and Commit messages, create a thread in a disposable project, and use the Commit action.                                                                                                         | The title and commit subject come from bb cloud; `ai usage` grows by the gateway's reported cost.                                                                                                                                                                                           |
| Voice input               | With bb cloud on and no Codex login, open a thread and check the microphone; pick bb cloud for Voice input, record a short dictation, and run `voice transcribe <file>` with a WebM and an MP4 recording; try a file over 10 MB. | The mic shows once bb cloud is ready and hides when it is off or signed out; the transcript comes from bb cloud and `ai usage` grows; the oversized file is refused before any gateway request.                                                                                             |
| Budget exhaustion         | Lower the local `AI_DAILY_BUDGET_MICROS`, generate until the gateway answers 402, then read status and generate again; sign in to a second local cloud account and read status.                                                  | bb cloud reports "Daily limit reached" until the reset time for the exhausted account only; Automatic skips it; a task pinned to bb cloud falls back to prompt text or `bb: automated commit`; the second account reports ready.                                                            |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Never
record prompts sent to the gateway beyond fixture text. Restore AI service
selections and bb cloud's on/off state, and remove only this run’s fixtures and
local cloud accounts.
