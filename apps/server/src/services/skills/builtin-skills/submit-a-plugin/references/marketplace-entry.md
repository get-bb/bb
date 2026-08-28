# Marketplace entry and icon

Read this file before you create a marketplace entry or icon. Confirm every
field against the current marketplace schema.

## Create the entry

Create entries/<plugin-id>.json. The filename, entry ID, and plugin manifest ID
must match. Do not add fields that the schema does not define.

The current required fields are id, displayName, description, icon, author, and
source. Use tags and engines when they add useful search or compatibility data.

Use the product name for displayName. Write one concrete description sentence
that states the feature and user value. Do not make subjective marketing claims.

Use no more than ten specific lowercase tags. Use hyphens inside multiword tags.
Copy honest engine ranges from the plugin manifest. An entry can narrow those
ranges but cannot widen them.

Set author.github to the account that opens the pull request. Get it with:

```sh
gh api user --jq .login
```

Do not publish an email address.

Use this shape only as a guide:

```json
{
  "id": "notes",
  "displayName": "Notes",
  "description": "Keeps project notes beside each BB thread.",
  "icon": { "url": "./icons/notes-1234abcd.svg" },
  "tags": ["notes", "interface"],
  "author": {
    "name": "Acme",
    "github": "acme",
    "url": "https://acme.example"
  },
  "engines": {
    "bb": ">=0.40.0",
    "bbPluginSdk": ">=0.5.0"
  },
  "source": {
    "git": {
      "url": "https://github.com/acme/bb-plugin-notes.git",
      "range": "^1.2.3"
    }
  }
}
```

## Add the icon

Vendor the icon in the marketplace icons/ directory. Do not use a remote URL,
a CDN, raw.githubusercontent.com, or a path in the plugin repository.

Use an existing brand icon when it meets the current marketplace rules. The
entry can also use a supported BB host icon name.

Use SVG, PNG, or WebP for a file icon. Keep it at or below 256 KB. Prefer a
simple square image with clear contrast at small sizes.

BB masks SVG icons with the surrounding text color. Use a single-color SVG for
theme-aware artwork. Use PNG or WebP for multicolor artwork. Do not include
scripts, remote resources, or private data in an SVG.

Use a content hash in the filename:

```sh
sha256sum path/to/icon.svg
shasum -a 256 path/to/icon.svg
```

Use the first available command. Name the file
<plugin-id>-<first-eight-sha256-characters>.<extension> and reference it as:

```json
"icon": { "url": "./icons/notes-1234abcd.svg" }
```

If no suitable artwork exists, select a host icon from the current supported
list. Do not invent a host icon name.
