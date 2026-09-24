# bb cloud AI

Status: **2026-09-23: 0 passed, 5 not run** (new plugin). Run against the local cloud from hosted-web.md.

## Setup and entry points

Settings → Plugins → bb cloud AI; Settings → AI services; bb ai --help. Needs a
signed-in bb account (bb-account plugin) against `pnpm cloud:dev`; real replies
need `OPENROUTER_API_KEY` in the cloud-dev environment. bb cloud is off in a
fresh store; turn it on with `ai on` or the settings switch for every recipe
after Opt-in.

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
| Opt-in | In a fresh store, sign in, read `ai status` and the AI services picker, pick bb cloud for Thread titles and create a thread; then run `ai on --json`, read status again, and run `ai off`. Repeat on/off with the settings switch and reload the plugin in between. | Off by default: status says "bb cloud is off" and names Settings → bb cloud AI and `bb ai on`, Automatic skips it, the pinned title falls back to prompt text, and the gateway logs no request. `ai on` reports enabled and ready; `ai off` stops requests; the choice survives a plugin reload. |
| Readiness | With bb cloud on, read `ai status` and the AI services picker signed out, signed in, and with bb-account disabled. | Status says how to become ready in each case; signed in it reports ready and Automatic lists bb cloud after Codex. |
| Titles and commits | Pick bb cloud for Thread titles and Commit messages, create a thread in a disposable project, and use the Commit action. | The title and commit subject come from bb cloud; `ai usage` grows by the gateway's reported cost. |
| Budget exhaustion | Lower the local `AI_DAILY_BUDGET_MICROS`, generate until the gateway answers 402, then read status and generate again; sign in to a second local cloud account and read status. | bb cloud reports "Daily limit reached" until the reset time for the exhausted account only; Automatic skips it; a task pinned to bb cloud falls back to prompt text or `bb: automated commit`; the second account reports ready. |
| Settings section | Open the plugin's settings section signed in and signed out, with bb cloud off and on. | The "Use bb cloud" switch and the disclosure (first prompt text and diff excerpts, getbb.app to OpenRouter with zero data retention, usage totals and 30-day request metadata, never prompts) render; the switch matches `ai status`; account line, readiness, and usage render; usage errors show as unavailable, not zero. |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Never
record prompts sent to the gateway beyond fixture text. Restore AI service
selections and bb cloud's on/off state, and remove only this run’s fixtures and
local cloud accounts.
