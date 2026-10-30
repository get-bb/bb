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

A bug isn't a docs gap. If people ask because something is broken or confusing,
fix the product. Document it only if no fix is planned.

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

- `sources`: globs of the code the page documents. CI flags the page when they
  change after `verified`.
- `since`: the first release with the behavior, or `unreleased`. Unreleased
  pages show an Unreleased badge until the release process swaps in the
  version.
- `owner`: the GitHub handle named on PRs that touch the page's sources.
- `verified`: the date someone last checked the page against the app. It is
  never shown on the page.

## Images

Read [references/images.md](references/images.md) before adding any image. While
drafting, use `<Shot todo="what to capture" />`; CI fails while any remain.

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
```

Then open the page on the dev server and check the sidebar, the Copy page menu,
search, and the `.md` copy at `/docs/<slug>.md`.
