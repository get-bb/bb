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
