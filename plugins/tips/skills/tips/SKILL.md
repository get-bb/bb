---
name: tips
description: "List, hide, dismiss, or reset the tips bb shows on the New thread page, or turn tips on or off."
---

# Tips

bb shows three tips as a small feed under the composer on the desktop and web
New thread page (never on phones or compact layouts). Each new visit adds one
tip at the top and drops the oldest, cycling through every eligible tip before
repeating. Tips are on by default for new installs and off for
existing ones until someone turns them on. Use the `bb tips` command to inspect
or change them.

```sh
bb tips [--all] [--json]
bb tips hide [--undo] [--json]
bb tips dismiss <id> [--json]
bb tips reset [--json]
```

- `bb tips` lists the tips eligible now, highest priority first, and marks the
  three in the feed. Tips limited to the desktop or web app are listed
  because the CLI cannot tell which app the person uses. `--all` adds every tip
  with its status: `dismissed`, `retired` (with `used`, `acted`, or `seen`),
  `held`, or `not-applicable`.
- `bb tips hide` hides tips until tomorrow; `--undo` shows them again.
- `bb tips dismiss <id>` retires a tip for good. Run `bb tips --all` for ids.
- `bb tips reset` clears dismissals, retirements, shown counts, and today's
  hiding. Features bb has already seen in use stay recorded, so their tips stay
  retired.

`bb tips` says when tips are off. Turn them on or off with
`bb plugin config bb--tips set enabled true|false`. Only
dismiss, hide, or reset tips when the person asks.
