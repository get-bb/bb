# Finite State bb fork delta

This file records intentional changes outside `plugins/bb-plugin-finite-state/`.

| Commit | Path | Reason | Recovery |
|---|---|---|---|
| `7a8f7c5725b886c3b537c756f7e1aea7ba2c8dbb` | `.nvmrc`, `.bb-env-setup.sh` | Pin every autonomous worktree to Node 22.19.0 and a frozen-lockfile install; fail provisioning closed | Revert the commit after the upstream repository adopts an equivalent or newer compatible pin |

WP-01 may update `.nvmrc` only if the already-recorded pin is absent. WP-02 exclusively owns the builtin plugin registry change. Any other out-of-directory edit requires an amendment.
