# Rotated symbol fixture

This fixture is original to the Finite State plugin test suite and is released
under the repository's license. It targets KiCad S-expression format version
20231120 (KiCad 8 generation).

Each symbol uses the same asymmetric library pin at `(-5.08, -2.54)`. The wire
endpoint is the ground truth produced by KiCad's `TRANSFORM(angle) * (x, -y)`
composition, including mirrors applied to the composed matrix's output row.
