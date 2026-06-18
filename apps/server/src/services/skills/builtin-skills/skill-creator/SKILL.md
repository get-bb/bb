---
name: skill-creator
description: Create new bb skills and improve existing ones. Use this whenever the user wants to make, write, author, draft, edit, refine, or optimize a skill — including turning the current conversation or workflow into a reusable skill, fixing a skill that is not triggering, or sharpening a skill's description. Skills live in ~/.bb/skills/<name>/SKILL.md. Trigger on phrases like "create a skill", "make a skill for", "turn this into a skill", "write a SKILL.md", "my skill isn't triggering", or "improve this skill".
---

# Skill Creator

A skill for creating new bb skills and iteratively improving them.

At a high level the process looks like this:

- Decide what the skill should do and roughly how it should do it
- Write a draft of the skill into `~/.bb/skills/<name>/SKILL.md`
- Try it on a few realistic prompts by spawning bb threads, with and without the skill
- Evaluate the results with the user, both qualitatively and with a few objective checks
- Rewrite the skill based on what you learned
- Repeat until you are both satisfied
- Optionally tune the description so the skill triggers reliably

Your job is to figure out where the user is in this process and jump in. Maybe they say "I want a skill for X" — then help narrow the intent, write a draft, pick test prompts, run them, and iterate. Maybe they already have a draft — then go straight to the test/iterate loop. And if they say "I don't need a bunch of evals, just vibe with me," do that instead. Be flexible.

## How skills work in bb

- **Location.** A skill is a directory with a `SKILL.md` file. User skills live under `~/.bb/skills/<name>/`. The directory name must exactly match the `name` in the frontmatter.
- **Frontmatter.** `SKILL.md` must begin with a plain `---` delimiter on its own line, followed by `name` and `description`, then a closing `---`. `name` must be lowercase letters, numbers, and single hyphens (no double hyphens, no spaces, ≤64 chars). `description` must be non-empty and ≤1024 chars.
- **Discovery.** bb loads skills per thread at spawn time. A newly written or edited skill is picked up by the **next** thread you spawn, not by threads already running — including the one you are in. So you cannot test a skill in your current thread; spawn a fresh thread to see it take effect.
- **Bundled resources.** Anything else in the skill directory (e.g. `scripts/`, `references/`, `assets/`) ships with the skill and can be read or executed by the agent using the skill. Reference these files from `SKILL.md` with clear pointers about when to use them. This is the basis of progressive disclosure (below).

## Communicating with the user

Skill authors range widely in their comfort with jargon. Pay attention to context cues and match your language to the user. When in doubt, briefly explain a term rather than assume. Words like "evaluation" or "test case" are usually fine; only lean on things like "JSON" or "assertion" once the user signals they know them.

## Creating a skill

### Capture intent

Start by understanding what the user actually wants. The current conversation may already contain the workflow they want to capture (e.g. "turn this into a skill") — if so, mine the history first for the tools used, the sequence of steps, the corrections they made, and the input/output formats observed. Have them fill the gaps and confirm before moving on.

Get clear on:

1. What should this skill enable the agent to do?
2. When should it trigger — what user phrases and contexts?
3. What is the expected output or end state?
4. Is this skill worth setting up test cases for? Skills with objectively checkable outputs (file transforms, data extraction, code generation, a fixed sequence of steps) benefit from tests. Skills with subjective outputs (writing style, taste) often don't. Suggest a sensible default for the skill type, but let the user decide.

### Interview and research

Proactively ask about edge cases, input/output formats, example inputs, success criteria, and dependencies. Don't write test prompts until this is ironed out. If research would help (looking up an API, conventions, or a similar existing skill), do it — spawn bb threads to research in parallel when it's substantial, otherwise inline. Come prepared so you reduce the burden on the user.

### Write the SKILL.md

Create `~/.bb/skills/<name>/SKILL.md`. Based on the interview, fill in:

- **name** — the skill identifier. Must match the directory name and the naming rules above.
- **description** — the primary triggering mechanism. Include both *what* the skill does and *when* to use it; all "when to use" information goes here, not in the body. Agents tend to *under*-trigger skills, so make the description a little pushy: name concrete contexts and phrasings. For example, instead of "Build a dashboard of internal metrics," write "Build a dashboard of internal metrics. Use this whenever the user mentions dashboards, data visualization, internal metrics, or wants to display company data — even if they don't say 'dashboard'."
- **the body** — the instructions themselves (see the guide below).

### Skill writing guide

#### Anatomy of a skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description — required)
│   └── Markdown instructions
└── Bundled resources (optional)
    ├── scripts/    - code for deterministic/repetitive tasks
    ├── references/ - docs loaded into context as needed
    └── assets/     - files used in output (templates, icons, fonts)
```

#### Progressive disclosure

A skill is loaded in three levels, so keep cheap things cheap:

1. **Metadata** (name + description) — always in context (~100 words). This is what triggers the skill.
2. **SKILL.md body** — loaded when the skill triggers. Aim for under ~500 lines.
3. **Bundled resources** — read or executed only as needed (effectively unlimited; scripts can run without being loaded into context).

These counts are approximate; go longer when you genuinely need to. Key patterns:

- Keep `SKILL.md` focused. If it grows past ~500 lines, add a layer of hierarchy: move detail into `references/` and leave a clear pointer about when to read each file.
- For large reference files (>300 lines), include a table of contents.
- **Organize by variant** when a skill spans multiple domains or frameworks, so the agent reads only the relevant file:

```
cloud-deploy/
├── SKILL.md (workflow + how to pick a variant)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```

#### Principle of least surprise

Skills must not contain malware, exploit code, or anything that could compromise security, and their behavior should match what the description implies. Don't build misleading skills or skills meant to facilitate unauthorized access, data exfiltration, or other malicious activity. (Benign things like "roleplay as an X" are fine.)

#### Writing patterns

Prefer the imperative form in instructions.

**Defining an output format** — show the exact shape:

```markdown
## Report structure
Always use this template:
# [Title]
## Summary
## Findings
## Recommendations
```

**Examples** — concrete examples pull a lot of weight:

```markdown
## Commit message format
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

#### Writing style

Explain *why* things matter instead of piling on heavy-handed `MUST`s. Today's models have good theory of mind; given the reasoning behind an instruction, they generalize well beyond rote rules. If you catch yourself writing `ALWAYS` or `NEVER` in all caps, or reaching for a rigid structure, treat it as a yellow flag — reframe and explain the reasoning instead. Keep the skill general rather than overfit to a couple of examples. Write a draft, then reread it with fresh eyes and tighten it.

### Test cases

After drafting, come up with 2–3 realistic test prompts — the kind of thing a real user would actually type. Run them by the user: "Here are a few test cases I'd like to try. Do these look right, or do you want to add more?" Then run them.

A simple way to keep them is a JSON file in a scratch workspace (e.g. `/tmp/<name>-workspace/evals.json`):

```json
{
  "skill_name": "example-skill",
  "evals": [
    { "id": 1, "prompt": "User's task prompt", "expected": "What good output looks like" }
  ]
}
```

## Testing the skill in bb

The cleanest way to test a skill in bb is to spawn a fresh thread on a realistic prompt and observe what it does — remember, only newly spawned threads pick up the skill. See the **bb-cli** skill for the full mechanics of spawning and inspecting threads; the essentials:

- Spawn a run: `bb thread spawn --project "$BB_PROJECT_ID" --prompt "<test prompt>"` (add `--json` to capture the thread id for follow-up).
- Wait for it: `bb thread wait <thread-id>`.
- Read the result: `bb thread output <thread-id>`, the full transcript with `bb thread log <thread-id>`, and any file changes with `bb thread show <thread-id> --git-diff`.

**With-skill vs. baseline.** To see whether the skill actually helps, compare two runs of the same prompt:

- *With skill:* write the draft to `~/.bb/skills/<name>/`, then spawn the thread — it will be available.
- *Baseline:* temporarily move the skill aside so discovery skips it (e.g. `mv ~/.bb/skills/<name> ~/.bb/skills/<name>.off`), spawn the same prompt, then move it back. For a brand-new skill the baseline is "no skill"; for an existing skill, snapshot the old version and use that as the baseline.

Launch the runs you can in parallel so they finish around the same time. Read the **transcripts**, not just the final output — that's where you see whether the skill triggered, whether the agent followed it, and where it wasted effort.

**Grade against your expectations.** For objectively checkable outputs, write a small script or run a quick check rather than eyeballing it — it's faster and reusable. For subjective outputs, judge qualitatively and bring the concrete results to the user. Then show the user the actual outputs and ask what they'd change.

## Improving the skill

This is the heart of the loop: you've run the test cases, the user has reacted, now make the skill better.

How to think about improvements:

1. **Generalize from the feedback.** The point of a skill is to work across thousands of future prompts, not just the handful you're iterating on. Resist fiddly, overfit tweaks and oppressive `MUST`s. If an issue is stubborn, try a different framing, metaphor, or pattern of working — it's cheap to try and you may land somewhere much better.
2. **Keep it lean.** Remove instructions that aren't earning their place. If the transcripts show the skill pushing the agent into unproductive detours, cut the parts causing that and see what happens.
3. **Explain the why.** Even when feedback is terse or frustrated, dig into what the user actually needs and encode that understanding — the reasoning, not just the rule. Models given the *why* go beyond rote instructions.
4. **Bundle repeated work.** If every test run independently writes a similar helper script or repeats the same multi-step setup, that's a strong signal to write it once, drop it in `scripts/`, and have the skill point at it. This saves every future invocation from reinventing the wheel.

Take your time here — your thinking is not the bottleneck. Draft a revision, reread it fresh, and improve it.

### The iteration loop

1. Apply your improvements.
2. Rerun the test cases (and the baseline) in a fresh set of threads.
3. Compare against the previous results and show the user.
4. Read the feedback, improve again.

Keep going until the user is happy, the results look consistently good, or you've stopped making meaningful progress.

## Tuning the description for triggering

The description is the main thing that determines whether a skill triggers. After the skill works, offer to sharpen it.

**How triggering works.** A skill appears to the agent as its name + description in an available-skills list, and the agent decides whether to consult it based on that description. The agent only reaches for skills on tasks it can't trivially handle itself — a one-step "read this file" may not trigger a skill even with a perfect description, while complex, multi-step, or specialized tasks reliably do. So design your test prompts to be substantive enough that a skill would genuinely help.

**Write trigger evals.** Create a mix of should-trigger and should-not-trigger prompts:

```json
[
  { "query": "the user prompt", "should_trigger": true },
  { "query": "another prompt",  "should_trigger": false }
]
```

Make them realistic — concrete details, file paths, company names, casual phrasing, the occasional typo. Aim for edge cases rather than clear-cut ones:

- **Should-trigger:** vary the phrasing of the same intent (formal and casual), and include cases where the user never names the skill or file type but clearly needs it.
- **Should-not-trigger:** the valuable ones are near-misses — queries that share keywords with the skill but actually need something else. Avoid obviously irrelevant negatives (e.g. "write a fibonacci function" for a PDF skill tests nothing).

Bad: `"Format this data"`. Good: `"my boss sent an xlsx in my downloads ('Q4 sales final FINAL v2.xlsx') and wants a column for profit margin as a %. revenue is column C, costs column D i think"`.

**Test and apply.** Have the user sign off on the eval set, then check triggering by spawning threads on those prompts and seeing whether the skill is consulted (the transcript shows it). Revise the description toward the wording that triggers correctly on should-trigger prompts without firing on the near-misses, and show the user the before/after.

## Quick checklist

- `~/.bb/skills/<name>/SKILL.md` exists; directory name matches frontmatter `name`.
- Frontmatter starts with a plain `---`, has a valid lowercase-hyphen `name` and a pushy, specific `description` (≤1024 chars).
- Body is focused; large detail lives in `references/`, repeated code in `scripts/`.
- Tested in a freshly spawned bb thread (not the current one) on realistic prompts, ideally against a baseline.
- Description triggers on the right prompts and stays quiet on the near-misses.
