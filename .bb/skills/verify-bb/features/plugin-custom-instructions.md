# Custom agent instructions

Status: **source-documented; live execution pending**.

## Setup and entry points

Settings → Plugins → Custom instructions; bb plugin run custom-instructions --help and the plugin command schema.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/custom-instructions/package.json`
- `plugins/custom-instructions/server.ts`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Get, set, clear | Save a unique harmless instruction, read it through the plugin interface, then clear it. | Saved text persists and clearing removes it from subsequent instruction assembly. |
| Next-turn propagation | Start a new test turn and follow-up across available providers/projects after changing the instruction. | New task instructions include the current value at the documented scope; an in-flight turn is not falsely claimed to have reloaded it. |
| Length and invalid input | Submit an empty value and values at and beyond the declared 4096-character maximum. | Boundary behavior matches the schema; rejected input preserves the previous value. |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Inspect the
registered plugin command and SDK call before claiming agent parity; do not
invent a plugin CLI where the feature uses a core command instead. Preserve
failed attempts and missing prerequisites as unverified results. Restore plugin
configuration and remove only this run’s fixtures, registrations, and workers.
External account changes use authorized disposable targets.
