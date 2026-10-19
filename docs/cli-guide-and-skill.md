# CLI, Guide, And Skill

Keep the discoverable surfaces in sync whenever you add or change a `bb` CLI command, flag, or a user-facing configuration knob (env var, `.bb/` workspace file, settings field):

- The in-CLI guide templates under `packages/templates/src/templates/bb-guide-*.md` are the core CLI manual. Document core commands, flags, and settings there; turbo regenerates `packages/templates/src/generated/templates.generated.ts` (not committed) before every build, typecheck, and test task.
- The bb-cli skill (`plugins/bb-guide/skills/bb-cli/SKILL.md`) only routes agents to guide chapters and states agent habits and safety rules. Do not copy command documentation into it. Add new core command paths to its `references/command-index.md`.
- For plugin commands and settings, update the owning plugin's `skills/<name>/SKILL.md` or supporting reference, including built-in plugins. Configuration knobs also belong in `docs/configuration.md`.
- Keep maintainer and repository-development instructions (source startup, release and publishing steps) in `docs/` and app READMEs, not in the guide or shipped skills.
- Match the existing chapter/section style; keep entries concise and accurate against the implementation.
