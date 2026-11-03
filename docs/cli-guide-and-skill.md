# CLI, Guide, And Skill

Keep the discoverable surfaces in sync whenever you add or change a `bb` CLI command, flag, or a user-facing configuration knob (env var, `.bb/` workspace file, settings field):

- The in-CLI guide templates under `packages/templates/src/templates/bb-guide-*.md` are the core CLI manual. Document core commands, flags, and settings there; turbo regenerates `packages/templates/src/generated/templates.generated.ts` (not committed) before every build, typecheck, and test task.
- The bb-cli skill (`plugins/bb-guide/skills/bb-cli/SKILL.md`) only routes agents to guide chapters and states agent habits and safety rules. Do not copy command documentation into it. Add new core command paths to its `references/command-index.md`.
- For plugin commands and settings, update the owning plugin's `skills/<name>/SKILL.md` or supporting reference, including built-in plugins. Configuration knobs also belong in `docs/configuration.md`.
- The product docs at `getbb.app/docs` are a surface too. A user-visible change updates its docs page in `apps/web/content/docs/` in the same PR, or the PR says why not. Follow the docs-writing skill (`.bb/skills/docs-writing/SKILL.md`). The CLI, Keyboard shortcuts and Plugin SDK reference pages are generated from code, so they need no hand edits.
- Every `bb` command and flag written in docs pages, getbb.app guides, skills and `bb guide` chapters must exist; `apps/cli/src/__tests__/docs-command-references.test.ts` checks them in CI.
- Keep maintainer and repository-development instructions (source startup, release and publishing steps) in `docs/` and app READMEs, not in the guide or shipped skills.
- Match the existing chapter/section style; keep entries concise and accurate against the implementation.
