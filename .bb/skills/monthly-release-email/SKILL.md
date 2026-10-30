---
name: monthly-release-email
description: 'Produce bb''s monthly release email ("What''s new in bb") from a month of release notes: themes and copy, subject and preview, real-product graphics, accuracy checks, the Resend broadcast, and a screenshot for sharing. Use for "the monthly email", "the November email", "release newsletter", "what''s new email", building or checking it in Resend, or any change to the email''s template, copy rules or graphics.'
---

# Monthly release email

One email a month to everyone on the list: current bb users plus people who signed up for Terragon. It shows what's new in bb so people come back to it.

Everything lives in `scripts/monthly-email/`. Run commands from the repository root.

- **The email lives only in Resend.** The repo holds the process and tools, never an issue's copy or graphics.
- **Working files** go in `scripts/monthly-email/issues/` (gitignored): the issue spec `issues/<yyyy-mm>.json`, and `issues/<yyyy-mm>/` with the final PNGs, `hosted.json` (their Resend URLs) and `design/` (graphic sources and captures). The send HTML and the broadcast are generated from the spec; applying feedback means editing the spec or a graphic and regenerating.
- **Browser scripts** go in `scripts/monthly-email/browser/` (gitignored), because they can hold private share links and paths.

`release-themes` writes the themes and items and owns the voice. This skill owns the template, subject, preview, opening, graphics, verification, Resend and the shareable screenshot.

## Steps

1. **Range.** `git fetch -q origin`, then take every release dated in the month from `changelog-metadata.ts` on origin/main. Tags without a changelog section have nothing to cover; a later release's notes may say they cover them.
2. **Themes.** Run `release-themes` for the range: two independent drafts, reconciled. Then apply "Content rules" below. Record what was left out as `left_out`, and pull in strong user-facing items rather than repeat a point.
3. **Copy.** Write `issues/<yyyy-mm>.json` with the fields below.
4. **Graphics.** One or two per theme, made as in `references/graphics.md`.
5. **Verify.** Two independent agents check every claim and every image against the source at the release tags (see "Accuracy"), from one neutral brief, then reconcile. This is the accuracy pass `release-themes` describes; run it once, on the final copy. Fix or cut anything not confirmed, and raise anything only the reviewer can settle.
6. **Build it in Resend** as in "Resend" below. The reviewer reviews the real email there. For your own checks first, `node scripts/monthly-email/render-email.mjs scripts/monthly-email/issues/<yyyy-mm>.json` writes a local preview with local images. It refuses a subject over 70 characters or a preview line over 90, which most email clients cut off. It also refuses HTML over 80 KB, because Gmail clips emails near 102 KB and hides the rest, and warns above 60 KB.
7. **Review rounds.** Share the draft's Resend link and ask for review. Resend is the master copy: the reviewer edits the draft there, and copy edits from a review round go straight into the draft too (reload and extract afterwards to confirm only the intended text changed). Rebuild only for changes the editor can't make, such as new graphics or layout. Before a rebuild, extract the current draft (`5-extract.js`, then `save-extract`) and run `check-resend.mjs` against the last send HTML; if the visible text differs, carry the draft's edits into the JSON first. Then apply the change, re-verify changed claims, rebuild the draft (re-uploading only changed images), and delete the previous draft only once its edits are in the JSON.
8. **Screenshot for sharing**, if asked (see below).
9. **Test emails, then send**, only when the reviewer says (see "Sending").

## Issue JSON

| Field                                      | Used for                                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `month` ("October 2026"), `ym` ("2026_10") | Header, draft name, UTM campaign `monthly_releases_<ym>`                                                                                                                                          |
| `from`, `reply_to`                         | Resend header fields (checked by `check-resend.mjs`)                                                                                                                                              |
| `subject`, `preview`, `opening`            | Inbox lines and the opening paragraph                                                                                                                                                             |
| `themes[]`                                 | `title`; `image {src, alt}` or `images [{src, alt}, …]`; `items [{title, body, versions}]`; optional `try {label, prompt}`; optional `direction` (the VISION principle it advances, not rendered) |
| `cta`                                      | `text` (button), `download_prefix`, `download_text`                                                                                                                                               |
| `address`                                  | Footer                                                                                                                                                                                            |
| `logo`                                     | URL of the 28 px bb logo for the header, hosted in Resend like the graphics                                                                                                                       |
| `left_out`                                 | `[{title, version, reason}]`, not rendered                                                                                                                                                        |

Item `body` is inserted as HTML so it can hold `<code>` and `<a href>` (links get the link style automatically); escape any literal `<` or `&`. `versions` is the text shown ("0.47.0, 0.48.0"); the renderer links each version to its release-notes section. `try.label` is sentence case ("Try it in bb"); CSS uppercases it. A theme with no honest graphic may go without one; say so to the reviewer. Fixed strings live in `render-email.mjs`: the "What's new in bb" title, the footer sentence and the UTM pattern.

## Template slots

| Slot         | Rule                                                                                                                                                                                                                                        | October 2026                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| From         | `bb <updates@mail.getbb.app>`, reply-to `support@terragonlabs.com`                                                                                                                                                                          |                                                                                                                                                                                                                   |
| Subject      | `New in bb in {Month}: {a theme} and {another theme}`, in short plain words; the month makes it easy to spot. Pick the two most readers care about. 70 characters or fewer, since most email clients cut longer subjects. No "MCP" or "ACP" | New in bb in October: more ways to customize and a faster app                                                                                                                                                     |
| Preview line | `Plus: {a third theme as what you can now do}.`, 90 characters or fewer, since most mobile email clients show 40–90, no status words. Set in Resend's Preview text field                                                                    | Plus: ChatGPT and Claude can now start agents in bb.                                                                                                                                                              |
| Title        | `What's new in bb`, with the logo and month above                                                                                                                                                                                           |                                                                                                                                                                                                                   |
| Opening      | No lead-in; the subject and title already say which month. One or two natural sentences grouping related themes, not one clause per theme                                                                                                   | bb is now more customizable, and faster when running a lot of agents. You can also start bb agents from other AI apps like ChatGPT or Claude, add any ACP agent as a provider, and run bb on Windows and Android. |
| Themes       | As many as the month supports (October had six): a title saying what you can now do, 2–3 items, one or two images                                                                                                                           |                                                                                                                                                                                                                   |
| Try it       | Optional, at the end of a theme                                                                                                                                                                                                             |                                                                                                                                                                                                                   |
| CTA          | Centered button `Read the full release notes`, with no sign-off line above it, to getbb.app/changelog, then a small `New to bb? Download it` (to the getbb.app homepage, since `/download` alone is a 404)                                  |                                                                                                                                                                                                                   |
| Footer       | Why you're getting this, Unsubscribe (`{{{RESEND_UNSUBSCRIBE_URL}}}`), and the postal address                                                                                                                                               |                                                                                                                                                                                                                   |

## Content rules

- **Audience.** One version for everyone, about what's new. No win-back wording and no versions per segment.
- **Structure.** Group by theme, never by release, and never add a catch-all list.
- **Lead with the value**, in the bold title and in the body's first clause; mechanism comes after. Titles end with a period ("Use bb from any terminal.", "Add any ACP agent in one step.").
- **Order items as a narrative:** the core value, then what it means, then the detail.
- **One cohesive sentence per feature, not a laundry list,** naming UI as the user sees it ("labeled rows above the thread list", not "Top list"). Say "built into bb core", not just "built into bb".
- **Say what's newly possible, and check it's actually new** in older changelog sections and earlier emails (the sent broadcasts in Resend).
- **bb's own words:** "composer", "model picker", "Info tab", "Git changes", "thread switch", "child threads banner", "thread actions", "thread details", "thread context", "left rail". A plugin's thread action shows in the thread actions menu (the "..." by the title) or, as a header thread action, as a button in the thread header. When the reviewer rewrites a phrase, use theirs exactly and everywhere, including graphics; search the JSON and designs for the old phrase.
- **No status sentences.** Give a setup path only, chosen by plugin state as in `release-themes`.
- **Numbers.** Only measured numbers that apply to everyone, with plain metric names ("Longest stutter", "Unresponsive time"). State a multiple once (the 6× headline sits in the graphic's title). If the notes say "faster" with no number, look in the PRs. If there's still none, measure it (see `references/graphics.md`) or describe the change without a number. Never present a "before" level as a reduction: October's PR reported file watching _at_ 80–90% CPU before, with no "after", so it isn't "80–90% less".
- **Try it prompts use the month's new capability and really work.** October: "Add a thread action that runs my tests and commits only if they pass", which uses 0.46.0's plugin thread actions. Build prompts on features that are on by default (the Commit button is off by default). Layout: a small grey uppercase label naming where to try it, then a standalone centered composer-style box with a send button.
- **Platforms.** When a theme adds platforms, end it by naming the ones bb already runs on (October: "These are in addition to using bb on the web, Mac, iOS, and Linux.").
- **Links.** Every version links to its release-notes section (the renderer does this). Link inline anything a reader would want to get, since the release notes don't carry download links: a desktop platform to `https://getbb.app/download/<macos|windows|linux>?placement=direct` plus UTM parameters, and the Android APK to `https://github.com/get-bb/bb/releases/download/android-testing/bb-android.apk`.
- **No "Open bb" button**: the desktop app registers no URL scheme.

## Accuracy

Release notes can be wrong, so confirm each claim in the source at the release tag: `git show desktop-v<ver>:<path>`.

- **Labels and paths:** core settings pages in `apps/app/src/components/settings/settings-sections.ts`; plugin settings pages by `bb.name` in `plugins/*/package.json`; default on or off in `apps/server/src/services/plugins/builtin-registry.ts`.
- **"Replace" and "fork" differ.** Only plugins in `scripts/forkable-plugins.json` at the tag can be forked on their own (at 0.48.0, the composer, not Git or GitHub PR Status).
- **Numbers:** read the PR that measured them and note its conditions.
- **Platforms:** rebuild the list each issue from `apps/web/src/landing/site.ts` and `MobileAppSection.tsx` at the newest tag in the range.
- **Try it and integrations:** confirm at source that every step exists (for MCP, the `run` tool's own `thread spawn` example in `plugins/mcp/src/mcp-handler.ts`). Don't run prompts or connect real accounts to test them; the code is the evidence.
- **Images:** match the real UI at the tag, and name anything shown on that's off by default (the Commit button is off by default in 0.48).
- **Published notes:** don't edit release notes as part of this work.

## Resend

Use a bb desktop browser that's signed in to bb's Resend account (sending domain mail.getbb.app); no API key is needed. Find it with `bb machine list` and `bb browser instances --host <host>`, then `bb browser-automation open --backend desktop --machine <host> --desktop <instance>`. Limits: a desktop session lasts 30 minutes; a run fails after about 30 seconds in practice, even with a longer `--timeout`, and a failed run ends the session; a script is at most 128,000 characters, and one browser message of about 2 MB drops the connection, so images go one at a time. Copy files back with `bb file read <path> --host <host> --json`.

Serve `scripts/monthly-email/issues/<yyyy-mm>/` through bb connect (`share-server-links`) so the browser can read the graphics. Then `node scripts/monthly-email/browser-scripts.mjs resend scripts/monthly-email/issues/<yyyy-mm>.json scripts/monthly-email/browser --preview-base <share URL>` writes the step scripts. Run each with `bb browser-automation run <session> --timeout 28s --script-file scripts/monthly-email/browser/<step>.js --script-host <this host> --json`, in order:

1. **Host the images** (`1-upload-images.js`): creates a broadcast and uploads every graphic. Pass the returned URLs to `node scripts/monthly-email/hosted-map.mjs scripts/monthly-email/issues/<yyyy-mm> <urls…>`, which writes `hosted.json` by checksum (Resend drops file names). Keep that draft, renamed "Image uploads · {Month} {Year} email (keep)": deleting it might delete the hosted images. After a review round, open that draft and run `1b-upload-changed-images-into-open-draft.js`, which uploads only the graphics whose hosted copy is out of date.
2. **Render the send HTML:** `node scripts/monthly-email/render-email.mjs scripts/monthly-email/issues/<yyyy-mm>.json --hosted scripts/monthly-email/issues/<yyyy-mm>/hosted.json --out scripts/monthly-email/issues/<yyyy-mm>.send.html`, then regenerate the step scripts so the upload carries it. Rendering with `--hosted` refuses any graphic whose hosted copy no longer matches the local file.
3. **Upload HTML** (`2-upload-html.js`): "Upload HTML" in an empty draft converts the email into editor blocks, keeping text, links, images and unsubscribe placeholder. If the run times out after creating the draft, run `2b-upload-html-into-open-draft.js`. Code → "Edit HTML" (raw mode) doesn't unlock through automation.
4. **Page style** (`3-page-style.js`): Body centered, Body width 592 px, page padding 0. The email's own 16 px side padding sits inside the body, so 592 gives the 560 px column.
5. **Header fields** (`4-fields.js`), after the upload, because uploading renames the draft: From, Reply-To (typed slowly; fast typing keeps one letter), Subject, Preview text, and the name "What's new in bb · {Month} {Year}". The body has no hidden preheader of its own: Resend builds one from the Preview text field, and a second would repeat the line.
6. **Check the build:** pipe `5-extract.js`'s run output into `node scripts/monthly-email/browser-scripts.mjs save-extract scripts/monthly-email/issues/<yyyy-mm>`, then run `node scripts/monthly-email/check-resend.mjs scripts/monthly-email/issues/<yyyy-mm>.send.html scripts/monthly-email/issues/<yyyy-mm>.resend.html scripts/monthly-email/issues/<yyyy-mm>.json scripts/monthly-email/issues/<yyyy-mm>.resend-fields.json`. All twelve lines must say ok, including "send HTML matches the spec", which catches a send HTML that wasn't re-rendered after an edit.
7. **Old drafts:** delete earlier drafts of the issue (More actions → Delete broadcast, then type its name), never the image-upload draft. Leave To empty until the send.

## Screenshot for sharing

Render Resend's built HTML full length in a Mac's bb browser, which has Inter and the system fonts (Linux headless Chrome falls back to DejaVu): `node scripts/monthly-email/browser-scripts.mjs slack-shot scripts/monthly-email/issues/<yyyy-mm>.resend.html /tmp/bb-email-<month>-<year>.png > scripts/monthly-email/browser/slack.js`, run it in a desktop session, and copy the PNG back. It's 680 px wide at 2×. Check every section before sharing it.

## Sending

- **Tracking first:** open and click tracking are on for mail.getbb.app in Resend, and the test email's links carry `utm_campaign=monthly_releases_<ym>` and show up in getbb.app's analytics.
- **Audience:** everyone subscribed, once each. A Resend broadcast goes to exactly one segment, and segments are fixed lists, so the To field is one segment that combines every list the reviewer names. Unsubscribes are honored.
- **Update the segment before every send.** The website signup list keeps growing, but the combined segment only changes when someone adds contacts to it. Right before scheduling (and again if the send slips by a day or more):
  1. In the dashboard's contact view, open each list in turn and add every contact to the combined segment: select the page, then bulk Edit → Add to segments. Re-adding a contact is harmless.
  2. The contact view's pages can skip contacts that share an import time, so afterwards re-check every row's segment tags and add any that were missed.
  3. Open the combined segment and check that its count equals the lists' union (each list's count, minus contacts on more than one list). Don't schedule until it does.
  4. Set the draft's To to the combined segment and confirm it's still set after a reload.

  Never re-import contacts by CSV, which can re-subscribe people who unsubscribed.

- **Test emails** go out only when the reviewer says, to the recipients they name. Test email takes addresses separated by commas or line breaks. Check every link in the received email.
- **Schedule** after the reviewer's go-ahead on the test email: the first Thursday after the month ends, 16:00 UTC, unless they pick otherwise.
- **Changes after scheduling** need the reviewer's go-ahead. Test email still works while scheduled, but editing needs "Unschedule to make changes". Edit, reload and extract to confirm only the intended text changed, then set When again, check Review (contacts, time, links) and slide to schedule. Confirm the broadcast list shows Scheduled.
