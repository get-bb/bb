# Content script example

This frontend-only enhancement adds a theme-aware focus ring to editable bb
surfaces without rendering a React slot. Install it from this directory and
use `bb plugin dev` to exercise reloads.

The static rule lives in `app.css`, which is bb's preferred path for plugin
styles. The host keeps that imported stylesheet active for the content-script
generation, even though the plugin renders no React slot. The script owns only
listeners and class names: it observes the generation `AbortSignal`, returns
an idempotent disposer, and removes every class it installed. Reloading,
disabling, removing, or closing the app window therefore leaves no duplicate
listeners or stale DOM state.

Content scripts are trusted same-origin code, not a sandbox. This example only
touches the DOM, but a script has the same access to the app page and
authenticated browser state as ordinary code running in that page.
