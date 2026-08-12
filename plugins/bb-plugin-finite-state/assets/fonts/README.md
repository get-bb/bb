# Embedded font provenance

`themes/fsds-dark.css` embeds two unmodified, Latin-subset variable WOFF2 files.
They are data URLs, so selecting the theme makes no runtime font request. The
records below were verified on 2026-08-12 against the official Google Fonts CSS
service and the `google/fonts` source repository.

The CSS responses were requested with a Chrome 128 / Windows 10 user-agent to
make the served WOFF2 format and subset selection explicit. The immutable byte
hashes below remain the authoritative check if Google Fonts changes delivery.

This is a provisional G0 typography mapping. The authoritative FSDS export was
not available for this work package, and exact brand-token and type-system
signoff remains a G6 requirement.

## Instrument Sans

- Role: body and interface copy (`FSDS Instrument Sans`)
- Embedded source filename:
  `pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0SZe1Q.woff2`
- Google Fonts delivery version: `v4`, normal Latin variable subset, weight
  range 400–700, stretch 100%
- Bytes: 30,092
- SHA-256: `2ee17598a98d8a59e4df8152d015bec9ab8e4d5672cc0ab42bef806b568e3971`
- CSS API request:
  `https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400..700&display=swap`
- WOFF2 source:
  `https://fonts.gstatic.com/s/instrumentsans/v4/pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0SZe1Q.woff2`
- Google Fonts metadata:
  `https://github.com/google/fonts/blob/0b58fb370093f9a9f4ff785d94405710b79de67c/ofl/instrumentsans/METADATA.pb`
- Upstream source pinned by that metadata:
  `https://github.com/Instrument/instrument-sans/tree/7fa22308a3d0c94ee2b3cd537a1196b65db34a3e`
- Copyright: Copyright 2022 The Instrument Sans Project Authors
- License: SIL Open Font License 1.1 (`OFL.txt` in the Google Fonts family
  directory)

## Space Grotesk

- Role: heading stand-in (`FSDS Space Grotesk`). It replaces the unavailable
  licensed brand heading face for distributable builds until G6 confirms the
  authoritative FSDS typography tokens; no TWK Everett bytes are included.
- Embedded source filename: `V8mDoQDjQSkFtoMM3T6r8E7mPbF4Cw.woff2`
- Google Fonts delivery version: `v22`, normal Latin variable subset, requested
  weight range 400–700 (upstream variable axis 300–700)
- Bytes: 22,288
- SHA-256: `0640890476fc1198ab4de571fb658de443c4d85b66466ec09534a8737ab1ce9d`
- CSS API request:
  `https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400..700&display=swap`
- WOFF2 source:
  `https://fonts.gstatic.com/s/spacegrotesk/v22/V8mDoQDjQSkFtoMM3T6r8E7mPbF4Cw.woff2`
- Google Fonts metadata:
  `https://github.com/google/fonts/blob/00a38a53f92aef923b9353f40128e8f4552ddae4/ofl/spacegrotesk/METADATA.pb`
- Upstream source pinned by that metadata:
  `https://github.com/floriankarsten/space-grotesk/tree/03507d024a01282884232081fc6011c09ff4e849`
- Copyright: Copyright 2020 The Space Grotesk Project Authors
- License: SIL Open Font License 1.1 (`OFL.txt` in the Google Fonts family
  directory)

Both licenses permit redistribution and embedding subject to the OFL terms.
The embedded files are not modified or renamed internally; CSS-only family
aliases are used to keep the theme namespace isolated. System fallbacks remain
in each font stack for unsupported glyphs and environments.
