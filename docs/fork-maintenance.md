# Fork Maintenance

This fork keeps bb's extension model as the default way to add product behavior.
The goal is not to avoid core changes at any cost; it is to keep each change in
the narrowest layer that can own it correctly.

## Extension decision order

Use this order for every feature or substantial behavior change:

1. **Plugin** — use the existing public plugin SDK when the behavior is
   optional, namespaced, and can fail or be disabled without compromising
   canonical bb state.
2. **Plugin framework extension** — add a general-purpose primitive only when
   a real plugin is blocked. Keep feature policy in the plugin, start the new
   public surface as `experimental_`, and add it to
   [`api_to_audit.md`](api_to_audit.md).
3. **Core change** — change core when it owns the invariant: canonical data or
   lifecycle semantics, authorization, cross-process contracts, plugin
   loading, required cross-client behavior, or host guarantees such as
   accessibility and performance.

This is a rebuttable presumption, not a reason to hide core policy behind a
plugin. A small, well-owned core change is better than a fork-specific public
API pretending to be general.

## Classifying a change

Before implementation, answer these questions in the issue, plan, or pull
request:

- Can an external plugin implement the behavior using only public
  `@get-bb/plugin-sdk` entry points?
- If not, which concrete primitive is missing?
- Is that primitive independently useful, with clear lifecycle, cleanup,
  collision, failure, and compatibility semantics?
- If core is required, which invariant or ownership boundary requires it?
- Does the change need matching app, mobile, CLI, SDK, server, or daemon
  behavior?

A plugin under [`plugins/`](../plugins) that imports private `@bb/*` packages is
builtin-only. It may still be the right modular boundary, but it is not proof
that an external plugin can use the same capability. Portable plugins and
examples must build against public SDK entry points.

## Extending the plugin framework

A framework extension should ship with:

- A real plugin consumer demonstrating the missing primitive.
- A feature-neutral contract; fork-specific nouns and policy stay in the
  plugin.
- An `experimental_` public name and an audit entry covering limits,
  arbitration, cleanup, fallback, security, and compatibility.
- Matching server/app/daemon implementation only where the primitive requires
  it.
- Updates to the external plugin test harness and authoring guidance.
- A plugin SDK version bump when published package contents change.

Stabilize an experimental API only after real use has answered its audit
questions. Prefer two independent consumers before stabilization.

## Fork-only core changes

Keep fork-only core changes narrow and separable from upstream syncs. Record
retained deltas below so each upstream update can reassess whether to keep,
upstream, or replace them with a plugin.

| ID     | Area | Why core owns it | Upstream status | Reassess when |
| ------ | ---- | ---------------- | --------------- | ------------- |
| _None_ |      |                  |                 |               |

When adding a row, use a stable `F-###` id and link the implementing pull
request. Remove the row when the delta is removed or accepted upstream.

## Automation boundaries

The protocol-version CI guard compares code under
`packages/host-daemon-contract/src/`. That package is the precise, low-noise
boundary CI can enforce. It does not replace review for server-only or
daemon-only changes that alter the meaning or default of an existing wire
field; those still require the protocol bump described in `AGENTS.md`.

## Syncing upstream

- Keep `origin` pointed at this fork and `upstream` pointed at the canonical bb
  repository.
- Sync upstream in a dedicated branch and pull request; do not mix an upstream
  merge with new fork behavior.
- After each sync, review every retained core delta for conflicts, changed
  assumptions, and a newly available plugin path.
- Prefer upstreamable framework primitives. Keep fork-specific product policy
  in this fork's plugins.
- Run the normal Turbo checks and package smoke tests after resolving sync
  conflicts, especially around plugin contracts and the server-daemon wire.
