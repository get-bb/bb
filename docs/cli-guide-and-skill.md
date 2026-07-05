# CLI, Guide, And Skill

Keep the discoverable surfaces in sync whenever you add or change a `bb` CLI command, flag, or a user-facing configuration knob (env var, `.bb/` workspace file, settings field):

- Update the in-CLI guide templates under `packages/templates/src/templates/bb-guide-*.md`, then regenerate with `node packages/templates/scripts/generate-templates.mjs` (the `@bb/templates` typecheck/test tasks also run it).
- Update the bb-cli skill at `apps/server/src/services/skills/builtin-skills/bb-cli/SKILL.md`. Configuration knobs also belong in `docs/configuration.md`.
- Match the existing chapter/section style; keep entries concise and accurate against the implementation.
