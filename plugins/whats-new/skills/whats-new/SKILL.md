---
name: whats-new
description: "Explain or change bb's What's new card and Settings → Updates release notes, or turn What's new on or off."
---

# What's new

What's new is a built-in plugin (`bb--whats-new`), on by default.

- After bb updates, until this client sees the installed release, a card sits
  above the sidebar footer with the version, headline, and a small drawing.
  Opening it goes to Settings → Updates → What's new; opening it, dismissing
  it with ×, or visiting that section hides it until the next release. It is
  hidden while the sidebar is collapsed.
- A client with no seen record (a new install or a new browser) records its
  installed release as seen and shows no card until the next update. The seen
  record is per browser or app window, in local storage.
- Settings → Updates shows What's new below the update rows: a one-line
  summary of the installed release with its full notes behind Show all
  changes, releases skipped since this client last saw What's new, and an
  available update's notes.

## Turn it on or off

- `bb plugin config bb--whats-new set enabled false` hides the card and the
  Settings → Updates section; `... set enabled true` shows them again. This is
  the Show What's new switch in Settings → Plugins → What's new, and the
  Turn off What's new link shown after dismissing the card.
- `bb plugin disable bb--whats-new` turns the whole plugin off;
  `bb plugin enable bb--whats-new` turns it back on.

## Read release notes

Use `bb whats-new` (installed release), `bb whats-new --version <v>`, or
`bb whats-new --since <v>` (newest first), with `--json` for structured notes.
It is part of bb, works with this plugin off, and never marks a release seen,
so reading notes for the user does not hide their card.
