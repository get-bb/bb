---
name: skill-creator
description: Create new bb skills and improve existing ones. Use whenever a user asks to create, write, edit, refine, test, or optimize a skill; turn a workflow into a reusable skill; fix skill triggering; or improve a SKILL.md file.
---

# Skill creator

Create skills that trigger for the correct requests and improve agent results.

## Workflow

1. Read the conversation and the existing skill before asking questions.
2. Confirm the trigger, expected result, inputs, edge cases, and dependencies.
3. Write or revise the skill and any required resources.
4. Test realistic prompts in fresh BB threads.
5. Compare the results with the previous skill or no-skill baseline.
6. Revise until further changes do not give a useful improvement.

Ask only for decisions that the available context cannot answer. Match the
amount of evaluation to the risk and the result quality that the user needs.

## Skill contract

A skill uses this structure:

```text
skill-name/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

Only `SKILL.md` is required. User skills live at
`~/.bb/skills/<name>/SKILL.md`.

The file starts with YAML frontmatter:

```yaml
---
name: skill-name
description: State what the skill does and when an agent must use it.
---
```

The directory and `name` value must match. A name uses lowercase letters,
numbers, and single hyphens. It cannot exceed 64 characters. The description
cannot exceed 1024 characters.

Put all trigger conditions in the description. Include concrete tasks and
nearby user phrases. Keep procedural instructions in the body.

BB discovers edits for newly spawned threads. An existing thread does not
receive a skill revision after it starts.

## Progressive disclosure

BB loads skill information in three levels:

1. BB always loads the name and description.
2. An agent reads `SKILL.md` after the skill triggers.
3. The agent reads or runs bundled resources only when the task needs them.

Keep `SKILL.md` focused on routing, the main workflow, safety, and success
criteria. Aim for fewer than 500 lines.

Move detailed variants, contracts, and examples into `references/`. Tell the
agent exactly when to read each reference. Add a table of contents to reference
files longer than 300 lines.

Put deterministic or repeated work in `scripts/`. Put output templates, icons,
fonts, and similar material in `assets/`.

## Writing guidance

- Use direct instructions and concrete examples.
- Explain the reason for a constraint when the reason helps generalization.
- Remove rules that repeat the system prompt or repository instructions.
- Avoid absolute language when a clear reason and condition work better.
- Keep shared workflow in `SKILL.md` and organize references by task variant.
- Do not add unsafe, misleading, or unauthorized behavior.

## Evaluation

Create two or three realistic prompts. State the expected result for each
prompt. Include near-miss prompts when you tune the description.

Spawn a fresh thread for every test:

```sh
bb thread spawn --project "$BB_PROJECT_ID" --prompt "<test prompt>" --json
bb thread wait <thread-id>
bb thread output <thread-id>
bb thread log <thread-id>
bb thread show <thread-id> --git-diff
```

Read the transcript, not only the final answer. Check whether the skill
triggered, whether the agent read only relevant resources, and whether the
instructions improved the result.

For an existing skill, compare the revision with the previous version. For a
new skill, compare it with a run that does not expose the skill. Use an
objective check when the result has a machine-verifiable contract.

## Improve the revision

- Generalize from evaluation failures instead of adding prompt-specific rules.
- Remove instructions that cause delay or do not change results.
- Add a reusable script when each run repeats the same setup.
- Update an existing resource instead of creating overlapping guidance.
- Keep the description broad enough for true matches and quiet for near misses.

## Completion check

- The directory matches the valid frontmatter name.
- The description says what the skill does and when to use it.
- The body stays focused and routes optional detail to bundled resources.
- Every referenced resource exists and has a clear read condition.
- Fresh-thread evaluations cover realistic matches and useful near misses.
- The final revision improves results without unnecessary instructions.
