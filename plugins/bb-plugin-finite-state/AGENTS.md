# Finite State implementation rules

Read `docs/Implementation/AGENTS.md` completely before changing this plugin. It is binding within this directory. Precedence is:

1. accepted ADRs and frozen interfaces
2. `docs/Implementation/api-reference/README.md` and its vendored authority set
3. `docs/Implementation/RECON — bb SDK & Forge Surface.md`, `docs/Implementation/IMPLEMENTATION PLAN — Master.md`, and `docs/Implementation/AGENTS.md`
4. `docs/Product Specs/SPEC 00–06`
5. supporting research

RECON is historical on transport ownership; the accepted direct-API ADR supersedes its prior Forge gateway assumptions.

## We do not modify bb

This is the first rule, and it is not negotiable. See
`docs/Implementation/ADR — bb Is Not Modified.md`.

Finite State ships as an ordinary bb plugin and installs the way any
third-party plugin installs. The fork is a **disposable development
container** — it exists for workspace resolution, the
`@bb/plugin-sdk/testing` harness, and `plugins/tasks` as a reference. It is
not a product artifact.

- Everything we build lives under `plugins/bb-plugin-finite-state/`.
- Changes outside it are limited to development-environment concerns already
  recorded in `FORK-DELTA.md` (Node pinning, CI configuration).
- **No work package may modify bb's source, its builtin plugins
  (`plugins/<name>/` other than ours), or `builtin-registry.ts`.**
- Builtin registration is a BB release decision, not part of authoring this
  product. Do not add one.

**If a capability appears to require a bb change, the design is wrong.** Stop
and report it as a design problem. Find the plugin-level solution or drop the
capability — do not open a task to change bb. An entire lane (FS-95) was
created and cancelled on 2026-08-12 because it modified `plugins/workflows`
to support tooling we had introduced ourselves, which the product never
required.

Work on exactly one WP per task. Obey its owned-files and forbidden-files lists. If a frozen contract or another lane must change, stop and file an amendment; do not create a shadow contract.

## Shared lessons ledger

Project memory is the shared state between parallel lanes. Its index is already in your system prompt; use it instead of re-deriving what another thread has proven.

**Before starting a WP**, search for prior findings about your surface:

```sh
bb memory search "<your WP key, cluster, or subsystem>" --scope project
```

Read anything tagged with your WP, cluster, or files. A `FAIL` entry is a constraint: do not retry the failed approach without new evidence.

**When you finish — and especially when you fail or get blocked** — write back what the next thread must know:

```sh
bb memory add --scope project \
  --name "FAIL-wp09-eslint-flat-config" --kind fact \
  --tag "wp:WP09" --tag "plugins/bb-plugin-finite-state/eslint.config.mjs" \
  --summary "One-claim gist of the finding (~100 tokens max)" \
  --details "Evidence: file:line, the exact command and its output, or a commit SHA" \
  --reason "Why this is durable"
```

Types: `FACT` (verified positive finding), `FAIL` (falsified approach — the most valuable type), `CONSTRAINT` (binding rule discovered mid-work), `PATCH` (compact summary of a landed change: files, idea, evidence). Name entries `<TYPE>-<scope>-<slug>`. The `--kind` flag takes the plugin's fixed vocabulary: use `fact` for FACT/FAIL, `decision` for CONSTRAINT, `episode` for PATCH.

Rules: evidence in `--details` is mandatory — an entry without it is not binding. One claim per entry. Supersede stale entries (`bb memory update`/`forget` with `--reason`) rather than leaving them to mislead the next lane. Never store secrets, transient status, guesses, or anything already guaranteed by this file.

The data plane is direct typed Platform REST plus direct typed Assurance Studio REST. Forge is optional compute only and cannot own CRUD. Frontend code uses bb-native typed RPC/navigation and never imports backend clients, secrets, SQLite, or raw SDK internals.

Implementation agents may commit, push, and open PRs. They do not merge their own work. A separate reviewer must verify acceptance criteria, frozen-contract compatibility, the safety boundary, and focused tests. The coordinator may merge a green independently reviewed PR.

Human-only product actions remain absent from agent tools and executable CLI mutation paths: upstream push, conflict resolution, HBOM acceptance/rejection, lifecycle approval, manual attestation, and non-restorable destructive confirmation. `lib/agentic/registry.ts` is the canonical registry seam, and its closed `ActionToolName` union is the compile-time authority for the exact eight agent actions.

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

Run the two repository tripwires directly, then run every package lifecycle
check through Turbo from the repository root:

```sh
node plugins/bb-plugin-finite-state/scripts/check-frozen-artifacts.mjs
node plugins/bb-plugin-finite-state/scripts/check-dependency-freeze.mjs
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

**Do not install the plugin until FS-23 has merged and FS-91 branch protection
is active.** Installing creates `<dataDir>/plugins/finite-state/data.db` and
applies the frozen migration array; WP-02 owns that first activation and its
fresh-database proof.

UI-surface review evidence is exempt when the plugin is installed into a
disposable data dir via `BB_DATA_DIR`. The prohibition covers only the shared
data dir, which WP-02 owns and which carries first-activation/fresh-database
proof. Consistent with the accepted no-bb-core/WP-02-deferred ADR, shared-data-dir
activation remains prohibited and WP-02 remains deferred; disposable evidence
installs are allowed and do not revive WP-02.
