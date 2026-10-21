# Handshake theme

This folder is both the source of BB's built-in Handshake palette and a portable custom-theme package.

The theme supports light and dark modes. Light mode is the primary design.

## Install in another BB instance

1. Copy this `handshake` folder into the directory returned by:

   ```bash
   bb theme dir
   ```

2. Activate the theme:

   ```bash
   bb theme set handshake
   ```

You can also select `Handshake` from **Settings → Appearance → Palette** after you install it.

## Update

Replace the installed `handshake` folder. Then run:

```bash
bb theme set handshake
```

## Remove

Select another palette first:

```bash
bb theme reset
```

Then delete the installed `handshake` folder.

## Scope

The folder contains the global palette and compatible navigation and surface styles.

The custom Automations hero also needs the matching Operator source changes.
