See what changed after each bb update. What's new shows a small card above the sidebar footer once per release, and the release notes in Settings → Updates.

## What you get

- After bb updates, a card above the sidebar footer names the new version and its headline beside a small drawing, with **See what's new** for the full notes. A brand-new install shows no card until its first update.
- **See what's new** opens Settings → Updates at What's new. Dismiss the card with × to hide it until the next release; the card confirms that in place. Opening Settings → Updates hides it too.
- Settings → Updates shows What's new below the update rows: a one-line summary of the installed release with **Show all changes** for the full notes, the releases you skipped since you last looked, and the notes for an available update.
- Each highlight in the full notes has a **Show me** link. It fills the new-thread composer with a prompt asking the agent to walk you through that feature one step at a time, as a playground when the Playgrounds plugin is installed or as numbered steps otherwise. Nothing is sent until you press Send.
- The card hides while the sidebar is collapsed and follows the sidebar into the drawer on phones.

## Turn it off

- From the card: dismiss it with ×, then choose **Turn off What's new** in the confirmation. It says where to turn it back on and offers **Undo**.
- In the app: switch off **Show What's new** in Settings → Plugins → What's new, or disable the plugin there.
- From a terminal: `bb plugin config bb--whats-new set enabled false`, or `bb plugin disable bb--whats-new` (`bb plugin enable bb--whats-new` turns it back on).

Turning it off hides both the card and the Settings → Updates section.

## How it works

The release notes come from bb itself: the changelog bundled with your bb server, read through `GET /api/v1/system/release-notes` (`system.experimental_releaseNotes` in the SDK). Notes for an update you haven't installed yet are read from bb's published changelog. Which release you last saw is remembered in this browser or app window, so each device gets its own card.

## For agents and scripts

`bb whats-new` prints the installed release's notes, `--version <v>` one release, `--since <v>` every release after `<v>`, and `--json` structured notes. It is part of bb, works with this plugin off, and never marks a release seen.
