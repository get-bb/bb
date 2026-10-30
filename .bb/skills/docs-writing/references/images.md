# Images in bb docs

Text comes first. Most pages need no image at all.

## Where images go

- A screenshot goes where a reader has to find a control.
- A diagram goes on a concept page.
- Reference pages have no images.
- Troubleshooting pages show an image only to point at where an error appears.

## Placeholders while drafting

Write the page first and mark each image you need:

```mdx
<Shot todo="Settings → Plugins, enable switches outlined" />
```

The placeholder shows as a dashed box in previews. CI fails while any `<Shot`
remains in `apps/web/content/docs/`, so every placeholder is filled before
merge.

## Filling a placeholder

The docs-images skill (`.bb/skills/docs-images/SKILL.md`) captures each image
by these rules and replaces the placeholder with a `<Screenshot>`:

```mdx
<Screenshot
  src="/docs-images/<page-slug>/<name>"
  alt="Settings → Plugins lists each plugin with an enable switch on the right."
  width={720}
  height={420}
/>
```

The files are `apps/web/public/docs-images/<page-slug>/<name>-light.png` and
`<name>-dark.png`, each exactly twice `width` by `height`. CI checks that both
exist at that size and that the alt text is a sentence.

## Capture rules

- Capture real bb UI only, from an isolated dev bb at current `main`. Never use
  a real user's bb or data.
- Replace private details before capture: paths, machine names, emails and
  thread IDs.
- Capture light and dark versions of each image, at 2×.
- Annotate only what the text talks about, in bb's file-link blue: 1 px
  outlines and small pill labels.
- Crop short. Nothing cut off, no title cards, and no illustrations of things
  that weren't measured.
- Write a full-sentence alt text that names the control.
