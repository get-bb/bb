# The listing

Read this file before you write the listing fields, capture screenshots, or
write PLUGIN_OVERVIEW.md. Every field lives in the plugin itself and is read
from the release, never from the default branch.

| Listing field        | Where it comes from                                       |
| -------------------- | --------------------------------------------------------- |
| id                   | package.json `name`, through scripts/derive-plugin-id.mjs |
| display name         | `bb.name`                                                 |
| description          | `bb.description`                                          |
| icon                 | `bb.branding.icon`                                        |
| tags                 | `keywords`                                                |
| category             | `bbMarketplace.category` (recommended)                    |
| secondary categories | `bbMarketplace.secondaryCategories`                       |
| screenshots          | `bbMarketplace.screenshots`                               |
| overview             | PLUGIN_OVERVIEW.md beside package.json                    |
| author               | the GitHub owner (or, for npm, the owner of `repository`) |

`bbMarketplace` is a top-level package.json key, beside `bb`. BB ignores it
when it loads the plugin. An unknown key inside it is an error, so check the
spelling.

```json
{
  "name": "bb-plugin-notes",
  "keywords": ["bb-plugin", "notes", "markdown"],
  "bb": {
    "name": "Notes",
    "description": "Keep project notes beside each thread.",
    "branding": { "icon": "./icon.svg" }
  },
  "bbMarketplace": {
    "category": "thread-content",
    "secondaryCategories": ["memory-and-context"],
    "screenshots": ["./screenshots/notes-panel.png"]
  }
}
```

## The id

The id is the package name without its scope and a `bb-plugin-` prefix,
lowercased, with other characters replaced by hyphens. An id that starts with
`bb--`, or that belongs to a plugin bundled with BB, is reserved. An id
already listed from another source is claimed (`id-claimed`); rename the
package. `bb plugin publish --check` checks both against the live catalog.

## Write the display name

Use the product name. Keep it short enough to read in a card title. Do not add
the word plugin. Do not add the word BB unless the product name holds it.

## Write the description

`bb.description` is an App Store hook, not a README line. A user who never
heard of the plugin decides here.

BB clamps the description to two lines in a browse card and to one line in a
compact row, so it must stand alone there. State the outcome the user gets, not
the mechanism. Keep it under about 140 characters. Start with a verb. Do not
start with the display name or "A plugin that".

Use concrete nouns and verbs. Use a real number when you have one. Never let
an adjective carry the value. Do not use these words: powerful, seamless,
easy, simple, fast, best, modern, beautiful, robust, and intuitive. Do not
compare the plugin with another plugin or product.

This description is weak:

```text
A powerful plugin that makes code review seamless and easy.
```

This description is better:

```text
Put a second model on every code review, so a bug has to survive two reviewers.
```

## Choose the category

Set `bbMarketplace.category` to one category id. The category is optional, but
always set one: without it the plugin is listed uncategorized (or keeps the
category of the entry it replaces), and people browsing by category miss it.
An unknown id is an error that keeps the plugin out. `bb plugin publish --check`
lists the valid ids when the category is missing or unknown. Pick the category
for the surface a user gets, not for the code inside. Ask the user when two
categories fit equally well. Add up to three `secondaryCategories` only when
the plugin truly belongs there too.

## Choose the tags

`keywords` become tags. `bb-plugin`, `bb`, and `bb-plugins` are dropped. The
rest are lowercased, and only lowercase words joined by hyphens, of at most 32
characters, are kept, up to ten. The check names every keyword it drops. Use
words a user would search for. Do not repeat the display name or the category
id.

## Choose the icon

`bb.branding.icon` is either a BB icon name such as `NotebookPen`, or a
plugin-relative `.svg` file of at most 256 KiB that starts with `./`. BB masks
SVG icons with the surrounding text color, so use a single-color SVG. Do not
include scripts, remote resources, or private data in an SVG. If no suitable
artwork exists, use a BB icon name. Do not invent an icon name.

## Add screenshots

Add screenshots unless the plugin adds no visible surface. The detail page
shows them, and a user judges a plugin by them before an install. A listing
can have at most six; two or three good images beat six weak ones.

Lead with the surface a user gets first. Add one image for each further
surface a description cannot carry, such as a panel, a settings page, or a
command result. Do not show a splash screen or a logo.

Install the plugin in BB and capture the real surface. Do not draw a mockup.
Use a browser or computer automation tool from the current harness: a browser
control skill, a computer use tool, or a screenshot tool. If the harness has
none, ask the user for the images, name each surface to capture, state the
file rules below, and wait for the files.

Capture at a device pixel ratio of 2 when the tool permits it. Show real
content. Look at every image before you commit it, and remove private data
such as tokens, email addresses, home directory paths, and unrelated thread
text.

File rules (the check enforces each one):

- PNG, JPEG, or WebP, with an extension that matches the real format.
- At most 2 MiB and at least 1200 pixels wide.
- A relative path inside the plugin directory, such as
  `./screenshots/overview.png`.
- For npm, inside the published tarball: add the files to `files`.

## Write PLUGIN_OVERVIEW.md

PLUGIN_OVERVIEW.md beside package.json is the long-form description. The
detail page shows `bb.description` as a lead paragraph, then an Overview
section with this file. It is optional, but a listing without it looks
unfinished. It says the same thing as `bb.description` at length: the same
outcome, the same surfaces, no capability the short text does not imply.

When the plugin has none, draft one from the behavior you observed while
validating and screenshotting the plugin, show the full text to the user, and
get approval before you commit it. Never invent a capability.

Rules (the check reports each one). A file that breaks a rule does not block the
listing; the listing is published without the overview (or keeps the overview
of the entry it replaces) until a release fixes it.

- UTF-8, at most 4000 characters. Aim for 700 to 1800.
- Headings, paragraphs, emphasis, strong text, strikethrough, inline code,
  code blocks, blockquotes, lists, thematic breaks, and links only.
- No raw HTML, images, tables, footnotes, task lists, or control characters.
  Put images in screenshots.
- Every link is an absolute https URL.
- Use `##` headings for sections such as What you get, How it works, and
  Requirements. Do not start with a `#` title, and do not repeat
  `bb.description` as the first sentence.
- For npm, include the file in `files`.

Name every cost: an external service, a paid account, a separate install, or a
limited operating system.

## Check the listing quality

Read the finished listing as a user who has never seen the plugin. Confirm
each statement before you release.

- The description states the outcome the user gets and survives a two-line
  clamp.
- Every claim matches behavior you observed.
- The listing names each external service, account, and separate install.
- The category matches the surface the user gets.
- The tags hold words a user would search for.
- The icon reads clearly at 40 pixels.
- The first screenshot shows the main surface with real content.
- The overview says the same thing as the description, at greater length.
- No field holds private data, a local path, or an internal URL.

Fix the listing when one statement fails. Do not release a listing you cannot
defend.
