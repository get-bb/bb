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

## Capturing an image

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
