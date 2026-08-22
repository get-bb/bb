# gap-bb

Public GitHub fork of [get-bb/bb](https://github.com/get-bb/bb). Product name in this checkout: **gap-bb**.

## Remotes

| Remote | URL | Role |
| --- | --- | --- |
| `origin` | `https://github.com/kr3t3n/gap-bb.git` | Public fork (`kr3t3n/gap-bb`) |
| `upstream` | `https://github.com/get-bb/bb.git` | Upstream bb |

Keep package and CLI names as `bb` / `bb-app` so upstream merges stay clean. Brand as gap-bb in docs and companion apps only until a deliberate rename.

## Sync from upstream

```bash
git fetch upstream
git merge upstream/main
# or: git rebase upstream/main
git push origin main
```

## Companion iOS app

See [kr3t3n/gap-bb-ios](https://github.com/kr3t3n/gap-bb-ios) — Expo client against this server's HTTP API and bb connect.

## Local layout

- Checkout: `~/Developer/gap-bb`
- iOS app: `~/Developer/gap-bb-ios`
