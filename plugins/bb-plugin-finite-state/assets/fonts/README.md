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

## SIL Open Font License 1.1

The Instrument Sans and Space Grotesk copyright notices above apply to their
respective embedded font software. The complete common license text follows.

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE

The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS

"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS

Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created using
the Font Software.

TERMINATION

This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
