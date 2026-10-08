Learn what bb can do from a small feed under the composer. Tips shows three short tips on the New thread page, picked for how you use bb right now and for the project you have selected.

## What you get

- A calm feed of three rows under the composer on the desktop and web New thread page. Each row has a small illustration, a title, and a sentence or two of explanation.
- Hover or focus a prompt tip to preview its prompt in the empty composer; click it to fill the composer and put the cursor at the end. Anything you had already typed moves into the prompt's "Task:" slot.
- Setup tips open the right page or command, such as Account Pooler's settings or the mobile app page.
- "Hide tips" turns tips off in one click, with Undo. Turn them back on with the Show tips switch in the plugin settings.
- No tips on phones or in compact layouts, and none until bb's setup checklist is finished or dismissed.

## How it works

Tips are on by default for new installs and off for existing ones. The first time Tips runs it counts an install as new when it has no threads or none older than two weeks, saves that to the Show tips switch, and never changes it again; your own choice in the switch always wins.

Each new visit to the New thread page brings one new tip in at the top and lets the oldest drop off, working through every tip that fits you before any repeats. A tip you click stays out of the next visit. Tips put first what matters now: threads waiting on you, Account Pooler right after a usage limit, and subthreads or automations in a project that has not used them yet. A tip appears only when it fits your setup: keyboard tips stay off touch devices, Browser Automation tips stay off Windows, and a tip for a plugin waits until that plugin is installed. A tip retires once bb sees you using the feature or when you dismiss it with `bb tips dismiss`. After an update, a What's new tip links to Settings → Updates once.

Tips keeps its state and its shown, dismissed, and acted counts in its own plugin storage on this bb server. With bb's anonymous usage data sharing on, it also reports two anonymous events: `tip_shown` once per tip per visit and `tip_used` when you click a tip. Each carries only the built-in tip id, its position in the feed (1–3), and its action type, never your prompts, drafts, or project. Turn this off with Settings → General → Share anonymous usage data, `bb settings general telemetryEnabled false`, or `BB_TELEMETRY=false`.

## For agents and scripts

Use the `bb tips` command:

- `bb tips` lists the tips that are eligible now and marks the three in the feed, newest first, and says how to turn tips on when they are off. Add `--all` to include dismissed, retired, held, and not-applicable tips.
- `bb tips hide` hides tips for the rest of today; `bb tips hide --undo` shows them again.
- `bb tips dismiss <id>` retires one tip.
- `bb tips reset` brings back every dismissed and retired tip.

Add `--json` for machine-readable output. Turn tips on or off with `bb plugin config bb--tips set enabled true|false`.
