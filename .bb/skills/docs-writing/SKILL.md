---
name: docs-writing
description: "Write, change, or decide where to put a bb product docs page at getbb.app/docs: page or addition, page type and template, front-matter, images, and the checks a docs PR must pass."
---

# Write bb product docs

The product docs live at `getbb.app/docs`. Hand-written pages are MDX files in
`apps/web/content/docs/`. The sidebar is `apps/web/src/docs/nav.ts`. Reference
pages for the CLI, keyboard shortcuts and plugin surfaces are generated from
code in `apps/web/src/docs/reference.ts`; never write them by hand.

## Decide where a topic goes

Ask these in order and stop at the first yes:

1. Is it about the project, not the product (contributing, the PR gate,
   roadmap, funding, support routes)? Put it in `CONTRIBUTING.md` or a pinned
   Discord note. Docs may link to it.
2. Would someone who doesn't use bb search for this job in their own words,
   and does bb have a distinct answer? It is a guide on `getbb.app/guides`.
3. Does someone who has bb need steps, settings, commands or limits to do it?
   It is a docs page.
4. Both 2 and 3? Split by job. The guide has the outcome, a short how-it-works,
   a screenshot and the download button, then links to the exact docs section
   for the steps.

Rules for pages that come in pairs:

- Never copy steps from docs into a guide. The only exception is a one-line
  install command followed by a link.
- Each page has its own canonical URL. Copies compete in search.
- No near-identical variant pages, such as one per OS or agent. Use tabs on one
  page.
- `switch-from-*` guides keep the comparison. Migration steps go on the docs
  page "Switch from another tool", with a tab per tool.

## Decide page or addition

Look at the sidebar the way the asker would.

- **New page:** the question is a different job from every page, and someone
  reading the sidebar wouldn't click any existing page to find it.
- **Addition:** the question is a detail of a job a page already covers. An
  addition is small: a sentence, a table row or a step, not a new heading.

| Change | Every one of these must be true |
| --- | --- |
| New page | 3+ different people asked it in the last 90 days, in Discord or GitHub; no existing page's title would lead someone to it; the answer is stable and checked against the current app; it is about the product |
| Addition | 3+ different people asked it in the last 90 days; a reader of that page would expect it there; the answer is stable |
| Fix | The page is wrong or missing a step someone hit. Always done |

The 3-person and 90-day thresholds are provisional: a starting point, not
researched figures. Expect them to be tuned after the first quarter.

A bug isn't a docs gap. If people ask because something is broken or confusing,
fix the product. Document it only if no fix is planned.

There is no scheduled cleanup. Remove a page in the same PR that removes the
feature it documents. A page whose `sources` match no file fails the freshness
check.

## Place the page in the sidebar

- Four sections are fixed: Get started, Concepts, Reference, Troubleshooting.
- Every other section is one thing you can see in bb, named with its UI label.
- A how-to goes where you'd do it: the section of the thing whose control the
  page uses.
- Every symptom lives in Troubleshooting.
- Add the page to `DOCS_NAV` in `apps/web/src/docs/nav.ts` with the same title
  as its front-matter. The sidebar shows only pages that exist.

Naming:

| Kind | Pattern | Example |
| --- | --- | --- |
| Section | bb's UI noun | Threads, Child threads, Skills |
| How-to | Verb + the UI noun | Choose a permission mode |
| Tutorial | "Quickstart:" + the outcome | Quickstart: delegate work to child threads |
| One agent | Its name | Claude Code |
| Concept | The things it relates | Child threads, subagents and workflows |
| Reference | What you look up | CLI, Settings |
| Troubleshooting | The symptom, as people say it | A skill is missing from the / menu |

## Start from a template

Copy the template for the page type from `templates/` next to this file. CI
checks that each page has its type's required headings and ends with the right
one (`DOCS_PAGE_TEMPLATES` in `apps/web/src/docs/page-types.ts`).

| Type | Opens with | Body | Images | Ends with |
| --- | --- | --- | --- | --- |
| `tutorial` | What you'll have at the end, and how long it takes | Numbered steps, each with what you should see | One per step where a control must be found | `## Next steps` |
| `how-to` | "Use this when…", in one line | Steps, with tabs for desktop, CLI and phone when they differ; `## Check it worked` | Only where a control must be found | `## Related troubleshooting` |
| `concept` | What it is and why it matters | Short sections; a "when to use which" table if there are choices | One diagram, light and dark | `## Next steps` |
| `reference` | One line on what's listed | Tables | None | `## Where this list comes from` |
| `troubleshooting` | The symptom, in the user's words | Symptom → cause → fix table, then detail; headings use the exact error text | Only to show where an error appears | `## What to send when you ask for help` |

Every page:

- Stands alone for someone arriving from search or an agent.
- Answers in the first two lines. The `description` is shown under the title.
- Shows the UI path and the CLI command together wherever both exist.
- Uses only `bb` commands and flags that exist. CI checks every command
  written in docs pages, guides, skills and `bb guide` chapters.
- Links only to "Next steps" at the bottom. No buttons, dates or prev/next.

## Fill in the front-matter

```yaml
title: Choose a permission mode
description: One or two sentences that answer the question.
type: how-to
sources:
  - apps/app/src/components/composer/**
since: unreleased
owner: github-handle
verified: 2026-10-30
```

- `sources`: globs of the code the page documents, relative to the repo root.
  Keep them narrow: every commit under them makes the page due for a check.
- `since`: the first release with the behavior, or `unreleased`. Unreleased
  pages show an Unreleased badge until the release process swaps in the
  version.
- `owner`: the GitHub handle the freshness check names.
- `verified`: the date someone last checked the page against the app. It is
  never shown on the page.

The freshness check (CI job "Docs pages are verified after their sources
change", `apps/web/scripts/docs-freshness.mjs`) runs on every PR. For each
page, it compares the date of the last commit touching its `sources` with
`verified`:

- A later commit adds a warning annotation on the page that names its `owner`.
  It doesn't fail the PR. Check the page against the app, fix it, and set
  `verified` to today.
- A `sources` glob that matches no tracked file fails the job.

## Use MDX components

- **Tabs** for desktop, CLI and phone, or one tab per tool, when the steps
  differ. Never make a variant page instead.

  ```mdx
  <Tabs items={["Desktop", "CLI"]}>
  <Tab value="Desktop">

  1. Open **Settings → Plugins**.

  </Tab>
  <Tab value="CLI">

  Run `bb plugin list`.

  </Tab>
  </Tabs>
  ```

  Consecutive code blocks with a `tab="…"` attribute become tabs too.
- **Code blocks** show their `title` in the header, otherwise their language:
  `bash`, `sh` and `shell` show "Terminal", `yaml` shows "YAML", and a block
  with no language shows "Text". Give file contents a title, such as
  ` ```bash title=".bb-env-setup.sh" `, and prompts ` ```text title="Prompt" `.
  Every block has a Copy button.
- **Images:** `<Shot todo="…" />` while drafting, `<Screenshot … />` once
  captured. See below.

## Images

Read [references/images.md](references/images.md) before adding any image. While
drafting, use `<Shot todo="what to capture" />`; CI fails while any remain.
The docs-images skill (`.bb/skills/docs-images/SKILL.md`) captures the images
and replaces each placeholder with a `<Screenshot>`.

## Keep it accurate

- A user-visible PR updates its docs page in the same PR, or says why not.
- Write each fact once. If code already lists something completely, generate
  the reference from it instead of copying it.
- Check every fact against the current app at `main`, not a Discord answer.
- Before a tutorial or how-to merges, follow it step by step on a fresh dev
  install. Setups one install can't cover (phones, several machines, sandboxes,
  Windows and Linux, several provider accounts) use a written QA checklist.

## Check your change

```sh
pnpm exec turbo run test typecheck build --filter=@bb/web
pnpm exec turbo run test --filter=@bb/cli
node apps/web/scripts/docs-freshness.mjs
```

The `@bb/web` tests check front-matter, required headings, `<Shot>`
placeholders, screenshots (light and dark files at 2×, sentence alt text),
and links: every `/docs/…` and `https://getbb.app/docs/…` link and every
`#anchor` in hand-written and generated pages must reach an existing page and
heading.

Then open the page on the dev server and check the sidebar, the Copy page menu,
search, and the `.md` copy at `/docs/<slug>.md`.

## Keep the home and landing pages unchanged

Docs ship in the same app as the home and landing pages. On every PR that
changes docs paths (`apps/web/content/docs/`, `apps/web/src/docs/`, the docs
and `llms` routes, `apps/web/public/docs-images/`, or the docs skills), the CI
job "Docs leave home and landing pages unchanged" builds the base and the PR
and fails if the markup, CSS or loaded JS of `/` or a landing page changed.
If the PR changes them on purpose, add the `allow-landing-change` label and
re-run the job.

## Roll back a bad deploy

A merge to `main` that changes the site deploys getbb.app. If a deploy breaks
it, roll back the production worker, `bb-web`, to its previous version:

```sh
pnpm --filter @bb/web exec wrangler rollback --name bb-web
```

Then revert or fix the change on `main`; the next deploy replaces the
rollback.
