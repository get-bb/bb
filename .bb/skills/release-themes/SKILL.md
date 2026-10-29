---
name: release-themes
description: Turn a range of bb releases (a month, or a version range) into narrative themes that summarize what shipped and show where bb is going, grounded in docs/VISION.md and the release notes. Use for the monthly release email, release roundups, team updates, or whenever someone asks to "theme", "group" or "summarize" several bb releases, or "what did bb ship this month". It writes plain summaries, not marketing copy.
---

# Release Themes

Group a period's bb releases by the product direction they advance, and summarize each group in the release notes' own plain voice. The reader should come away knowing what shipped and what bb is becoming. They should not feel sold to.

Run from the repository root.

## Sources (read fresh every run)

- The release notes: `git fetch -q origin && git show origin/main:CHANGELOG.md`. Take every section of each release in the range.
- Headlines and dates: `git show origin/main:changelog-metadata.ts`.
- The direction: `git show origin/main:docs/VISION.md`. Its principles are the candidate themes. If the person running the email has current positioning notes, ask for them; they decide order and emphasis.
- Release images: `apps/web/public/changelog/<version>/` on origin/main. Often there are none.

## Method

1. **Inventory.** List every Highlight as `title · version · the notes' sentence`. Many releases have no Highlights section; for those, the notable items are the bold-led bullets under "New features", "Built-in plugin updates" and topical sections ("Working with agents", "Browser tools"), plus the `changelog-metadata.ts` headline. Leave out Plugin API, CLI-only and Fixes sections unless a change is user-facing. A release's notes can also cover an earlier tag that shipped without notes ("These notes also cover 0.43.4"); credit those items to the release whose notes describe them. Note each item's status (Experimental, Alpha, off by default, "Enable it in …") so you don't overstate it, and keep the "Enable it in …" path.
2. **Cluster by direction.** For each item, ask which VISION principle it moves forward, for example "agents can operate bb", "more of bb is built from plugins", "works wherever you are", "fast and understandable", or "flexible defaults". Don't cluster by screen, by user benefit or by release. A theme needs at least two items from the range. Keep as many themes as the period supports; October 2026's five releases made six. Items that advance no theme are left out, never put in a catch-all list; the release notes link covers them.
3. **Order** by how much of the period's work each theme carries. Multi-agent features can appear inside a theme but never lead.
4. **Write each theme:**
   - **Title:** what the reader can now do or get, in plain words, and true to the notes. Approved examples: "You can customize more of bb", "Use bb on more devices", "Faster when running a lot of agents concurrently", "Review and answer your agents faster", "Your agents can run bb for you", "Every ACP agent now works in bb". Rejected: "bb has strong defaults, not one blessed way of working" (abstract), "bb stays fast and understandable" (dull), "Keep track of every agent" (a tagline about table stakes), "Keep up with your agents' work" (buries the value).
   - **Items:** written in the voice below, each citing its version.
   - **Image:** one or two images per theme, made from real product surfaces or measured numbers, as the `monthly-release-email` graphics reference describes. An off-by-default feature may be shown turned on, as a user who turned it on sees it; say so to the reviewer. Never use a screenshot of a real user's bb.
5. **Opening** (if the caller needs one): one or two sentences saying directly what you can now do. They should read naturally, grouping related themes rather than listing one clause per theme. No lead-in like "Here's what changed in October:", no release count on its own, and no "we shipped".

## Voice

Chosen from research on Supabase, Vercel, opencode and T3 Code.

- **Items:** each theme holds 2–3 items. Each item is a bold title of a few words, then one or two plain sentences in second person about what you can now do. Name the exact setting path or command, such as "Settings → Appearance → Navigation".
- **Lead with the value, then the mechanism.** The bold title states the gain ("Use bb from any terminal"), and the body's first clause says what you can now do, with the how after it: "bb now keeps responding to clicks and typing while a thread opens, because it no longer lays out the thread's whole history first."
- **Say what's newly possible.** "You can now …", or "Before, … Now …" when the notes or the PR state the old behavior. Never guess at the old behavior.
- **Use bb's own terms:** "composer", not "message box"; "Info tab", not "Info panel"; "model picker"; "child threads banner"; "Git changes" (the bar above the composer). Take UI names from the notes or the source labels. Stay close to the notes' wording and add specifics, not synonyms; paraphrases read strange and vague.
- **Name what users see, in one cohesive sentence.** "Navigation pages … show as icons in the left rail or as labeled rows above the thread list", not option names like "Top list". Name everything a change covers in one sentence (the composer and all its Git features), not a sentence plus a colon list.
- **Benefits are numbers or mechanisms**, never adjectives: "longest stutter 100 ms → 17 ms", not "much smoother". Use only numbers measured for everyone, not under an experiment flag. Never write "better", "seamless" or "powerful".
- **Personality stays in the opening only**, as in Supabase's monthly email. Feature copy stays plain.
- **The reviewer's wording wins.** When the reviewer rewrites a phrase, use it exactly everywhere, including titles, the opening and graphics (October: "a lot of agents", not "many agents").
- **Try it:** end a theme with one prompt a reader can use right now, in bb or in the app the feature connects to ("Try it in ChatGPT or Claude"). It must use the month's new capability and really work. Leave it out when there's no honest action.
- **Which tag.** Labels, settings paths and plugin state can change inside a month. Use the newest tag in the range, because that's what readers have when the email lands, and check older items still read true there.
- **Setup line by plugin state.** Look up the plugin in `apps/server/src/services/plugins/builtin-registry.ts` at the newest tag in the range. Take its display name from `bb.name` in `plugins/<name>/package.json`, without any bracketed status tag ("Account Pooler [Experimental]" becomes "Account Pooler"). If `defaultEnabled` is computed (an environment variable or experiment), treat it as off. For an action in the command palette, name the palette entry.
  - `BUILTIN_PLUGINS` with `defaultEnabled: true` (installed and on for everyone): no setup line.
  - `BUILTIN_PLUGINS` with `defaultEnabled: false` (installed but off): "Turn on {name} in Settings → Installed plugins."
  - `OFFICIAL_PLUGINS` (`autoInstall: false`) or only in a marketplace: "Install {name} from Plugins → Browse plugins." If its `defaultEnabled` is false, add "then turn it on in Settings → Installed plugins."
- **No status sentences.** Off-by-default features get the setup path and nothing more; don't write "It's Experimental and off by default". Never overstate, though: don't present an experimental feature as finished or on for everyone.
- Keep bb lowercase, even at the start of a sentence. No taglines, superlatives, exclamation marks or "we"-led openers.

## Checks before writing

- **Is it new?** Search older changelog sections and earlier emails (the sent broadcasts in Resend), and name what's actually new. Plugin thread tabs existed in 0.34.0, so 0.47.0's "plugins can add tabs" didn't count; glob filtering in the Diff tab shipped in 0.44.0, so 0.47.0's new part was the extension picker.
- **No duplicates.** Merge items that cover the same change.
- **Review what's left out.** List every item you dropped. When a theme feels thin or repetitive, pull in strong user-facing items rather than restate one point.
- **Say the concrete effect** a reader would otherwise ask about, for example "it no longer shows up in the model picker".

## Verify

Two independent agents draft the themes from the same neutral brief (range and sources, not your draft); compare and reconcile before anyone uses the result.

Then two more independent agents check the final copy against the shipped product, not just the notes, since the notes can be wrong (0.46.1's "Settings → Plugins" is labeled "Installed plugins" in the app). They confirm each claim at the release tag (`git show desktop-v<version>:<path>`, cited as path:line): settings paths against the exact labels a user sees, commands and flags, default-on or default-off state, plugin names, and that each Try it really works. Fix or cut every claim that isn't confirmed. Also check that every fact cites a version that contains it, no item appears in two themes, and nothing experimental reads as finished.

## Output

For the monthly email, write straight into the issue JSON that `scripts/monthly-email/render-email.mjs` reads (the `monthly-release-email` skill lists every field). Otherwise return Markdown, or JSON shaped `{period, opening, themes: [{title, direction, items: [{title, body, versions}], image}], left_out: [{title, version, reason}]}`.

## Example of the voice

- Wrong: "**Keep track of every agent.** See which threads need you, and answer them without opening each one." It's a benefit tagline, it leads with table stakes, and its claim is not in the notes.
- Right: "**Start bb agents from ChatGPT or Claude.** You can now hand off work from ChatGPT or Claude to agents in bb. Turn on the MCP server in Settings → Installed plugins, then ask an agent in bb to connect them. (0.46.1)"
