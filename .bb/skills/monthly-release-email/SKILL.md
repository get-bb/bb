---
name: monthly-release-email
description: Build bb's monthly release email (What's new in bb) from a month of releases, covering copy, graphics, accuracy checks and the Resend broadcast. Use for "the monthly email", "the November email", "what's new email", or building, checking or sending it in Resend.
---

# Monthly release email

One email a month to everyone on the list: current bb users plus people who
signed up for Terragon. It shows what's new in bb so people come back to it.

The tools live in `scripts/monthly-email/`. Run commands from the repository
root.

- **Resend is the master copy.** The repo holds the process and tools, never an
  issue's copy or graphics. The first build of the send HTML and the broadcast
  comes from the issue spec; after that, edits happen in the Resend draft (step
  7).
- **Working files** go in `scripts/monthly-email/issues/` (gitignored): the
  issue spec `issues/<yyyy-mm>.json`, and `issues/<yyyy-mm>/` with the logo, the
  final PNGs, `hosted.json` (their Resend URLs) and `design/` (graphic sources
  and captures).
- **Browser scripts** go in `scripts/monthly-email/browser/` (gitignored),
  because they can hold private share links and paths.

`release-themes` writes the themes and items, and owns the voice and bb's UI
terms. This skill owns the template, subject, preview, opening, graphics,
verification, Resend and the shareable screenshot.

## Before you start

- **Resend.** A login to the Resend team that sends from mail.getbb.app, with
  access to broadcasts and contacts. Ask an admin of that team to invite you.
- **Browser Automation.** Install it from Plugins → Browse plugins, then turn it
  on in Settings → Installed plugins. The Resend steps drive the bb desktop
  app's browser while it's signed in to Resend.
- **Analytics.** Access to getbb.app's PostHog project, to confirm test links
  arrive with their UTM tags.
- **The reviewer** is whoever owns that month's email. They approve the copy and
  graphics, name the test recipients and the contact lists to send to, and give
  the go-ahead to schedule.

## Steps

1. **Range.** `git fetch -q origin`, then take every release dated in the month
   from `changelog-metadata.ts` on origin/main. Tags without a changelog section
   have nothing to cover; a later release's notes may say they cover them.
2. **Themes.** Run `release-themes` for the range. Then apply "Content rules"
   below. Record what was left out as `left_out`, and pull in strong user-facing
   items rather than repeat a point.
3. **Copy.** Write `issues/<yyyy-mm>.json` with the fields below, and copy
   `apps/app/public/icon-192.png` to `issues/<yyyy-mm>/bb-logo.png`. The logo is
   hosted with the graphics.
4. **Graphics.** One or two per theme, made as in
   [references/graphics.md](references/graphics.md).
5. **Verify.** Check every claim and every image against the source at the
   release tags (see "Accuracy"). This is the accuracy pass `release-themes`
   describes; run it once, on the final copy. Fix or cut anything not confirmed,
   and raise anything only the reviewer can settle.
6. **Build it in Resend** as in [references/resend.md](references/resend.md).
   The reviewer reviews the real email there. For your own checks first, write a
   local preview with local images:

   ```sh
   node scripts/monthly-email/render-email.mjs scripts/monthly-email/issues/<yyyy-mm>.json
   ```

   It refuses a spec whose `ym` or `month` doesn't match its file name, a
   subject over 70 characters or a preview line over 90 (most email clients cut
   longer ones), and HTML over 80 KB, because Gmail clips emails near 102 KB and
   hides the rest. It warns above 60 KB.

7. **Review rounds.** Share the draft's Resend link and ask for review. The
   reviewer edits the draft in Resend, and copy edits from a review round go
   straight into the draft too; reload and extract afterwards to confirm only
   the intended text changed. Rebuild only for changes the editor can't make,
   such as new graphics or layout. Before a rebuild, extract the draft and run
   `check-resend.mjs` against the last send HTML (see the Resend reference); if
   the visible text differs, carry the draft's edits into the JSON first. Then
   apply the change, re-verify changed claims, rebuild the draft (re-uploading
   only changed images), and delete the previous draft only once its edits are
   in the JSON.
8. **Screenshot for sharing**, if asked, as in the Resend reference.
9. **Test emails, then send**, only when the reviewer says, as in the Resend
   reference's "Sending".

## Issue JSON

| Field                                      | Used for                                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `month` ("October 2026"), `ym` ("2026_10") | Header, draft name, UTM campaign `monthly_releases_<ym>`                                                                                                                                          |
| `from`, `reply_to`                         | Resend header fields (checked by `check-resend.mjs`)                                                                                                                                              |
| `subject`, `preview`, `opening`            | Inbox lines and the opening paragraph                                                                                                                                                             |
| `themes[]`                                 | `title`; `image {src, alt}` or `images [{src, alt}, …]`; `items [{title, body, versions}]`; optional `try {label, prompt}`; optional `direction` (the VISION principle it advances, not rendered) |
| `cta`                                      | `text` (button), `download_prefix`, `download_text`                                                                                                                                               |
| `address`                                  | Footer                                                                                                                                                                                            |
| `left_out`                                 | `[{title, version, reason}]`, not rendered                                                                                                                                                        |

Item `body` is inserted as HTML so it can hold `<code>` and `<a href>` (links
get the link style automatically); escape any literal `<` or `&`. `versions` is
the text shown ("0.47.0, 0.48.0"); the renderer links each version to its
release-notes section. `try.label` is sentence case ("Try it in bb"); CSS
uppercases it. A theme with no honest graphic may go without one; say so to the
reviewer. Fixed strings live in `render-email.mjs`: the "What's new in bb"
title, the footer sentence and the UTM pattern.

## Template slots

| Slot         | Rule                                                                                                                                                                                                                                        | October 2026                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| From         | `bb <updates@mail.getbb.app>`, reply-to `support@terragonlabs.com`                                                                                                                                                                          |                                                                                                                                                                                                                   |
| Subject      | `New in bb in {Month}: {a theme} and {another theme}`, in short plain words; the month makes it easy to spot. Pick the two most readers care about. 70 characters or fewer, since most email clients cut longer subjects. No "MCP" or "ACP" | New in bb in October: more ways to customize and a faster app                                                                                                                                                     |
| Preview line | `Plus: {a third theme as what you can now do}.`, 90 characters or fewer, since most mobile email clients show 40–90, no status words. Set in Resend's Preview text field                                                                    | Plus: ChatGPT and Claude can now start agents in bb.                                                                                                                                                              |
| Title        | `What's new in bb`, with the logo and month above                                                                                                                                                                                           |                                                                                                                                                                                                                   |
| Opening      | No lead-in; the subject and title already say which month. One or two natural sentences grouping related themes, not one clause per theme                                                                                                   | bb is now more customizable, and faster when running a lot of agents. You can also start bb agents from other AI apps like ChatGPT or Claude, add any ACP agent as a provider, and run bb on Windows and Android. |
| Themes       | As many as the month supports: a title saying what you can now do, 2–3 items, one or two images                                                                                                                                             |                                                                                                                                                                                                                   |
| Try it       | Optional, at the end of a theme                                                                                                                                                                                                             |                                                                                                                                                                                                                   |
| CTA          | Centered button `Read the full release notes`, with no sign-off line above it, to getbb.app/changelog, then a small `New to bb? Download it` (to the getbb.app homepage, since `/download` alone is a 404)                                  |                                                                                                                                                                                                                   |
| Footer       | Why you're getting this, Unsubscribe (`{{{RESEND_UNSUBSCRIBE_URL}}}`), and the postal address                                                                                                                                               |                                                                                                                                                                                                                   |

## Content rules

Apply `release-themes`' "Voice" and "Checks before writing", plus these rules
for the email:

- **Audience.** One version for everyone, about what's new. No win-back wording
  and no versions per segment.
- **Structure.** Group by theme, never by release, and never add a catch-all
  list.
- **Titles end with a period** ("Use bb from any terminal.", "Add any ACP agent
  in one step.").
- **Order items as a narrative:** the core value, then what it means, then the
  detail.
- **Say "built into bb core"**, not just "built into bb".
- **Reviewer rewrites** apply everywhere: search the JSON and the designs for
  the old phrase.
- **Numbers.** State a multiple once, in the graphic's title. If the notes say
  "faster" with no number, look in the PRs. If there's still none, measure it
  (see the graphics reference) or describe the change without a number. Never
  present a "before" level as a reduction: a PR that reports 80–90% CPU before,
  with no "after", doesn't mean "80–90% less".
- **Try it prompts** work with default settings; a prompt that depends on
  something off by default fails for most readers. Layout: a small grey
  uppercase label naming where to try it, then a standalone centered
  composer-style box with a send button.
- **Links.** Every version links to its release-notes section (the renderer does
  this). Link inline anything a reader would want to get, since the release
  notes don't carry download links: a desktop platform to
  `https://getbb.app/download/<macos|windows|linux>?placement=direct` plus UTM
  parameters, and the Android APK to
  `https://github.com/get-bb/bb/releases/download/android-testing/bb-android.apk`.
- **No "Open bb" button**: the desktop app registers no URL scheme.

## Accuracy

Release notes can be wrong, so confirm each claim in the source at the release
tag: `git show desktop-v<ver>:<path>`.

- **Labels and paths:** core settings pages in
  `apps/app/src/components/settings/settings-sections.ts`; plugin settings pages
  by `bb.name` in `plugins/*/package.json`; default on or off in
  `apps/server/src/services/plugins/builtin-registry.ts`.
- **"Replace" and "fork" differ.** Only plugins in
  `scripts/forkable-plugins.json` at the tag can be forked on their own (at
  0.48.0, the composer, not Git or GitHub PR Status).
- **Numbers:** read the PR that measured them and note its conditions.
- **Platforms:** rebuild the list each issue from `apps/web/src/landing/site.ts`
  and `apps/app/src/components/settings/MobileAppSection.tsx` at the newest tag
  in the range.
- **Try it and integrations:** confirm at source that every step exists (for
  MCP, the `run` tool's own `thread spawn` example in
  `plugins/mcp/src/mcp-handler.ts`). Don't run prompts or connect real accounts
  to test them; the code is the evidence.
- **Images:** match the real UI at the tag, and name anything shown on that's
  off by default.
- **Published notes:** don't edit release notes as part of this work.
