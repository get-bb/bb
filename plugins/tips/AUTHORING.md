# Authoring tips

A tip is one entry in `TIP_CATALOG` in `catalog.ts`, drawn by one entry in
`ILLUSTRATIONS` in `illustrations.tsx`. `catalog.test.ts` and the host tests
(`apps/server/test/services/plugins/tips-catalog-targets.test.ts`,
`apps/app/src/components/settings/tips-catalog-routes.test.ts`) enforce the
rules below.

## How tips reach people

The New thread page shows a feed of three tips. Each new visit (a fresh mount,
at least 10 minutes after the last one) adds one tip at the top and drops the
oldest. The engine works through every eligible tip in ranked order (by
`tier`, then `boost`, then `priority`) before it repeats any. A clicked tip is
left out of the next
visit and comes back only after the rest of the library has been shown. A tip
retires for good when `retireWhen` turns true or the person dismisses it.
Held and expired tips never show. No tips show until bb's setup guide is
finished or skipped and a first thread exists.

## Fields

| Field                 | Rule                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                  | Unique, kebab-case, listed in `TIP_IDS` (`contract.ts`) and `TIP_TELEMETRY_IDS` (`packages/server-contract/src/api/system.ts`). Never rename one; storage keys and telemetry use it. |
| `title`               | Up to 45 characters. Sentence case, no trailing period.                                                                                                                              |
| `body`                | One sentence, up to 110 characters.                                                                                                                                                  |
| `illustration`        | Key in `ILLUSTRATIONS`. Usually the tip id.                                                                                                                                          |
| `tone`                | `blue`, `green`, `amber`, `orange`, or `rose`. Colors the illustration's one accent.                                                                                                 |
| `action`              | One of the action types below.                                                                                                                                                       |
| `source`              | `{ kind: "changelog" \| "blog" \| "guide" \| "feature", ref, version? }`: where the tip comes from.                                                                                  |
| `addedAt`             | bb version the tip ships in.                                                                                                                                                         |
| `reviewedAt`          | bb version the copy and eligibility were last checked against. Never later than `CATALOG_REVIEWED_THROUGH`.                                                                          |
| `expiresAt`           | Optional bb version from which the tip stops showing. Must be later than `CATALOG_REVIEWED_THROUGH`, so an expired tip fails CI.                                                     |
| `held`                | Optional. `true` keeps a finished tip out of every feed.                                                                                                                             |
| `tier`                | `1`, `2`, `3`, or `"unranked"`. See [Tiers](#tiers).                                                                                                                                 |
| `priority`            | Ordering inside a tier.                                                                                                                                                              |
| `eligible(signals)`   | When the tip fits this person right now.                                                                                                                                             |
| `retireWhen(signals)` | When the person already uses the feature. Retirement is permanent.                                                                                                                   |
| `boost(signals)`      | Optional. Pushes a tip ahead when context makes it urgent.                                                                                                                           |

Bump `CATALOG_REVIEWED_THROUGH` when you review the whole catalog against a
release.

## Tiers

Tiers come from which early behaviors go with people sticking with bb. The feed
shows tier 1 first, then unranked tips, then tier 2, then tier 3; `boost` and
`priority` only reorder tips inside one tier, so even an urgent boost never
lifts a tip above a higher tier. A tier 3 tip appears only after every eligible
higher-tier tip has been shown.

- **Tier 1:** the strongest early habits: child threads, the mobile app, a
  second agent on the same task, and asking the agent to build a plugin.
- **Unranked:** no clear signal yet. Place these by judgment with `priority`;
  automations lead because they give people a reason to come back.
- **Tier 2:** weaker but real: remote access, the bb CLI, and running more
  than one agent.
- **Tier 3:** features not worth promoting early, such as queued follow-ups,
  installing catalog plugins, or ACP agents.

New tips start `"unranked"` unless the owner places them. Keep tier reasons in
words; never put metrics, percentages, or sample sizes in this repository.

## Voice

- Plain and direct: "Ask bb to…", "Your agent can…", "Press ⌘K to…".
- Describe the outcome, not the mechanism: say what the person gets, not
  how the feature is built. Use bb UI terms (such as "child threads") only
  when pointing at that UI, or in a prompt that tells the agent which feature
  to use.
- No feature-toggle caveats, no "new!", no exclamation marks.
- Use `{version}`, `{paletteKeys}`, and `{searchKeys}` instead of hard-coding them.

## Actions

Every click marks the tip used and announces the result in the status line.
`actions.ts` implements each type once.

| Type          | Use it when                                                                                                                | Click                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `prompt`      | bb can do it if asked. End the prompt with `Task: ` when the person's draft belongs after it.                              | Fills the composer, moves the draft into the `Task: ` slot, focuses the caret at the end. |
| `open-page`   | A core page explains or sets it up. `path` must be `/plugins` (the plugin store), `/settings`, or a real Settings section. | Opens the in-app route.                                                                   |
| `run-command` | A command does it: `palette.open`, `thread.search`, or `settings.open`.                                                    | Runs the command as its shortcut would.                                                   |
| `open-plugin` | A built-in plugin does it. `pluginId` must be in `builtin-registry.ts`; never a personal plugin.                           | Opens the plugin's detail tab.                                                            |
| `learn-more`  | Only an `https://` release note, blog post, or guide explains it.                                                          | Opens the link with the person's browser preference.                                      |

Prefer `prompt`, then `open-plugin` or `open-page`. Use `learn-more` last.

### Walkthrough prompts

When a feature takes several setup steps (connecting the mobile app, turning
on bb connect, building a first plugin, adding a second agent), use a `prompt`
built with `walkthroughPrompt(goal)` in `catalog.ts` instead of opening a page.
It is the only place the wording lives:

> Walk me through `<goal>` in this bb, one step at a time, and check each step
> with me. If the interactive_answer tool is available, show the steps as an
> interactive answer; otherwise reply with plain numbered steps.

Make the goal specific and about something bb ships. Tips never depend on the
Interactive Answers plugin: the prompt asks for an interactive answer only when
the tool is there, and plain numbered steps otherwise. Prompts that act on the
person's own task, such as child threads, end with `Task: ` instead.

## Illustrations

Build every drawing from the parts in `diagram-kit.tsx`, and check it in the
**Illustrations** and **Diagram kit** stories in Ladle (`plugins/Tips`).

- **Grid.** 48 units, rendered at 64px. Keep a 3-unit margin.
- **Line.** Use `LINE`: `currentColor` at a 1.1 stroke with round caps and
  joins. Fills use `WASH`; secondary lines use `soft`.
- **Color.** Ink tones from `currentColor` and `CANVAS`. Use exactly one small
  accent, from the `accent` argument. Never write literal colors.
- **Rest state.** The drawing is still and complete at rest. It must read
  without the animation.
- **Hover.** Give the part that acts out the tip `animate`, and `stagger` for
  a sequence. Use one idea per drawing, about one second, with the end state
  held while the row is hovered. Reduced motion turns animation off in the kit.

| Animation                                  | Does                                                                |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `fill-in`                                  | Scales from `from` (0–1) to full width; ProgressBar fills.          |
| `flip-on` / `flip-off`                     | Fades a part in or out; Toggle flips on.                            |
| `glide`                                    | Moves from the `from` transform to the drawn position; Slider knob. |
| `slide-in`, `fade-in`, `rise`, `travel`    | Enters from an offset.                                              |
| `pop`, `press`, `snap`, `twinkle`, `nudge` | Plays once and settles where it started.                            |
| `sweep`                                    | Moves across and settles.                                           |
| `grow`                                     | Grows up from the baseline.                                         |
| `spin`                                     | One full turn around `origin`.                                      |

The parts are Panel, Window, Rule, Dot, ListLine, Node, Branch, ProgressBar,
Toggle, Slider, Button, CheckMark, Check, Cursor, Phone, Envelope, Keycap,
SearchGlyph, Magnifier, ChartAxes, Bar, CardStack, Arrow, Sparkle, Bubble,
Clock, CalendarGrid, Wrench, Pill, and Highlight. Add a part to the kit, with a
cell in the Diagram kit story, when two drawings need it.

## Checklist

- [ ] Copy follows the voice rules and the length limits.
- [ ] The action type fits; its target is a core route, a built-in plugin, or an `https://` link.
- [ ] The illustration uses kit parts, one accent, and one hover animation.
- [ ] `source`, `addedAt`, `reviewedAt`, and any `expiresAt` are set.
- [ ] `tier` is set; new tips are `"unranked"` unless the owner placed them.
- [ ] `eligible` and `retireWhen` have tests in `engine.test.ts` when they are new logic.
- [ ] The drawing reads at rest and on hover in light and dark, in the Illustrations story.
