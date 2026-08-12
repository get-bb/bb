# Finite State implementation rules

Read `docs/Implementation/AGENTS.md` completely before changing this plugin. It is binding within this directory. Precedence is:

1. accepted ADRs and frozen interfaces
2. `docs/Implementation/api-reference/README.md` and its vendored authority set
3. `docs/Implementation/RECON — bb SDK & Forge Surface.md`, `docs/Implementation/IMPLEMENTATION PLAN — Master.md`, and `docs/Implementation/AGENTS.md`
4. `docs/Product Specs/SPEC 00–06`
5. supporting research

RECON is historical on transport ownership; the accepted direct-API ADR supersedes its prior Forge gateway assumptions.

Work on exactly one WP per task. Obey its owned-files and forbidden-files lists. If a frozen contract or another lane must change, stop and file an amendment; do not create a shadow contract.

The data plane is direct typed Platform REST plus direct typed Assurance Studio REST. Forge is optional compute only and cannot own CRUD. Frontend code uses bb-native typed RPC/navigation and never imports backend clients, secrets, SQLite, or raw SDK internals.

Implementation agents may commit, push, and open PRs. They do not merge their own work. A separate reviewer must verify acceptance criteria, frozen-contract compatibility, the safety boundary, and focused tests. The coordinator may merge a green independently reviewed PR.

Human-only product actions remain absent from agent tools and executable CLI mutation paths: upstream push, conflict resolution, HBOM acceptance/rejection, lifecycle approval, manual attestation, and non-restorable destructive confirmation. The exact three agent action tools remain the compile-time allowlist.

Every PR body ends with an agent-generation marker as required by the repository root `AGENTS.md`.

## Environment

The toolchain is Node `22.19.0` and pnpm `9.15.0`. The ambient shell on the
development machine resolves a **newer** Node, and nothing switches it for you:
there is no shell hook, and `.bb-env-setup.sh` re-execs only itself for the
provisioning install. Select the pinned version explicitly:

```sh
fnm exec --using=22.19.0 <command>
```

Do not spend turns probing for a version manager. `fnm` is the one installed on
this machine; `nvm`, `mise`, `asdf`, `volta`, and `n` are not.

## Verification — always through turbo

Run every check through turbo from the repository root:

```sh
pnpm exec turbo run typecheck test lint build --filter=bb-plugin-finite-state
```

This is not a style preference. Turbo's `test` task declares
`dependsOn: ["//#ensure-native-modules", ...]`, and
`scripts/ensure-native-modules.mjs` detects a `better-sqlite3` ABI mismatch and
installs a prebuilt binary for the running Node. **Bare `vitest`, and
`pnpm test` from inside the plugin directory, skip that repair.**

If you see:

```
NODE_MODULE_VERSION 127 ... requires NODE_MODULE_VERSION 141
```

you ran the wrong entrypoint. It is not a broken test and not a schema defect.
Re-run through turbo; the repair is automatic and works on any Node version.
Verified: on ambient Node 25.4.0 the turbo run logs
`[ensure-native-modules] Installing prebuilt better-sqlite3 for Node 25.4.0
(ABI 141)` and the suite passes. Pin to `22.19.0` anyway, so local results match
CI and the declared `engines.node`.

The plugin gate is fast — roughly fifteen seconds for all four tasks. A slow run
means you invoked bb's full monorepo suite instead of the plugin filter. Nothing
in this plugin requires building bb from source: `@bb/*` resolves to source
through the `source` export condition, and the plugin's own `build` does not
build the SDK.

## Tests

Use the SDK harness rather than hand-rolled fakes. `createFakePluginHost()` from
`@bb/plugin-sdk/testing` is host-faithful — real temporary better-sqlite3
storage, the kv 256 KB cap, RPC input/output validation, keyed-registration
failures, and atomic reload. **Never mock the database.** Drive host inputs
through `harness.behavior` (`callRpc`, `fetchHttp`, `runCli`, `runService`,
`runSchedule`, `emitThreadEvent`), assert against `harness.inspection`
(including `sdk.callsTo(...)`), and use `harness.lifecycle` for reload/dispose.
Frontend slots use `loadPluginApp` / `renderSlot` from
`@bb/plugin-sdk/testing/app`.

That harness covers the **bb** boundary only. Platform, Assurance Studio, and
optional Forge compute are a separate boundary with their own fixtures and mocks
(WP-10–WP-13). Do not conflate the two, and do not reach for a live service in a
unit test.

## Migrations

`bb.storage.migrate` keys applied statements **positionally**, by integer id in
`_bb_migrations`. Editing or reordering a statement that has already been
applied is silently ignored on that database. Append new statements only.

The one exception is pre-release: while no `data.db` exists anywhere, the base
migration may still be rewritten in place. That rewrite happens **only** through
an approved amendment, never as an incidental edit inside another WP.

## Live loop

The plugin does not need to be a bb builtin to run. A path install loads
TypeScript directly with no build step:

```sh
bb plugin install ./plugins/bb-plugin-finite-state
bb plugin dev            # save -> rebuild frontend -> reload
bb plugin logs finite-state -f
```

WP-02 (builtin registry) is about shipping, not about seeing the plugin work.

**Do not install the plugin until the base migration rewrite has landed.**
Installing creates `<dataDir>/plugins/finite-state/data.db` and applies the
current migration array, which closes the in-place rewrite window described
above.
