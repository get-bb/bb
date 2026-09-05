# Inline HTML visualizations

Status: **source-documented; live execution pending**.

## Setup and entry points

Enable Inline vis; create a harmless workspace HTML file and produce its documented directive in a synthetic conversation.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/inline-vis/package.json`
- `plugins/inline-vis/server.ts`
- `plugins/inline-vis/app.tsx`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Render and open | Emit the directive with a relative .html/.htm path, open its header file action, and reload the thread. | The file renders inline and opens from the correct thread workspace. |
| Relative assets | Reference a fixture stylesheet, script, and image beside the HTML. | Assets resolve from the authorized workspace location and render without unrelated filesystem access. |
| Height | Try omitted height and values around the declared 120–1200 bounds. | Default and clamping match the renderer; oversized content remains usable without breaking the timeline. |
| Sandbox | Have the fixture attempt to read parent DOM, cookies, and origin storage; report only success/failure. | The sandbox blocks parent-origin access while allowing the intended visualization interaction. |
| Invalid artifacts | Try missing, non-HTML, invalid UTF-8, and greater-than-5MiB fixtures. | Clear artifact errors replace the frame; no silent blank success or unrestricted fallback occurs. |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Inspect the
registered plugin command and SDK call before claiming agent parity; do not
invent a plugin CLI where the feature uses a core command instead. Preserve
failed attempts and missing prerequisites as unverified results. Restore plugin
configuration and remove only this run’s fixtures, registrations, and workers.
External account changes use authorized disposable targets.
