## Shipping a theme in a plugin

A plugin can contribute themes via its manifest instead of the theme dir:

```json
"bb": { "themes": [{ "id": "mine", "name": "Mine", "css": "./themes/mine.css" }] }
```

bb lists it as `plugin:<pluginId>:mine`. Theme Preview resolves the CSS through
the manifest, so chips and live reload work the same way. Install with
`bb plugin install path:<dir> --yes`, reload with `bb plugin reload <pluginId>`
after CSS edits.

## Composer typography

Set `--bb-composer-editor-base-font-size` on the composer or an ancestor when
customizing the editor font size. Use the base size and the iOS Larger Text
multiplier in the editor's `font-size` declaration.

```css
.dark [data-promptbox] {
  --bb-composer-editor-base-font-size: 1rem;
}

.dark [data-promptbox] [data-promptbox-editor-content] .ProseMirror {
  font-size: calc(var(--bb-composer-editor-base-font-size) * var(--bb-ios-font-scale, 1));
}
```

`--bb-ios-font-scale` is a unitless multiplier from the native iOS app. Its
fallback is `1` in browsers. bb also uses the base size to fit a full line in
collapsed composers.
