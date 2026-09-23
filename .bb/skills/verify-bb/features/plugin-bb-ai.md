# bb cloud AI

Status: **2026-09-22: 0 passed, 4 not run** (new plugin). Run against the local cloud from hosted-web.md.

## Setup and entry points

Settings → Plugins → bb cloud AI; Settings → AI services; bb ai --help. Needs a
signed-in bb account (bb-account plugin) against `pnpm cloud:dev`; real replies
need `OPENROUTER_API_KEY` in the cloud-dev environment.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/bb-ai/package.json`
- `plugins/bb-ai/src/server.ts`
- `plugins/bb-ai/app.tsx`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Readiness | Read `ai status` and the AI services picker signed out, signed in, and with bb-account disabled. | Status says how to become ready in each case; signed in it reports ready and Automatic lists bb cloud after Codex. |
| Titles and commits | Pick bb cloud for Thread titles and Commit messages, create a thread in a disposable project, and use the Commit action. | The title and commit subject come from bb cloud; `ai usage` grows by the gateway's reported cost. |
| Budget exhaustion | Lower the local `AI_DAILY_BUDGET_MICROS`, generate until the gateway answers 402, then read status and generate again. | bb cloud reports "Daily limit reached" until the reset time; Automatic skips it; a task pinned to bb cloud falls back to prompt text or `bb: automated commit`. |
| Settings section | Open the plugin's settings section signed in and signed out. | Account line, readiness, usage, and the data disclosure render; usage errors show as unavailable, not zero. |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Never
record prompts sent to the gateway beyond fixture text. Restore AI service
selections and remove only this run’s fixtures and local cloud accounts.
